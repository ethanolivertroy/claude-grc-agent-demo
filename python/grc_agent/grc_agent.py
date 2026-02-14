"""Core GRC agent orchestration — Python port of src/grc-agent.ts."""

from __future__ import annotations

import os
import re
import shutil
from datetime import datetime, timezone
from typing import Any, AsyncIterator, TypedDict

from claude_agent_sdk import AgentDefinition, ClaudeAgentOptions, ClaudeSDKClient, ResultMessage

from .mcp.grc_server import grc_mcp_server
from .schemas.grc_schema import grc_assessment_schema
from .subagents import SubagentConfig, subagents
from .tools.fs_tools import glob_files, read_file


def _get_env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default

    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on", "enabled"}:
        return True
    if normalized in {"0", "false", "no", "off", "disabled"}:
        return False
    return default


def _get_env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default

    try:
        parsed = int(value)
    except ValueError:
        return default

    if parsed <= 0:
        return default

    return parsed


USE_FEEDRAMP_DOCS_MCP = _get_env_bool("GRC_USE_FEDRAMP_DOCS_MCP", True)
GRC_MAX_TURNS = _get_env_int("GRC_MAX_TURNS", 50)


def _resolve_claude_code_executable() -> str | None:
    explicit = (
        (os.environ.get("CLAUDE_CODE_EXECUTABLE") or "").strip()
        or (os.environ.get("CLAUDE_CODE_PATH") or "").strip()
    )
    if explicit:
        return explicit

    candidates = [
        shutil.which("claude") or "",
        os.path.expanduser("~/.local/bin/claude"),
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
        "/usr/bin/claude",
    ]

    for candidate in candidates:
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


CLAUDE_CODE_EXECUTABLE = _resolve_claude_code_executable()

# ---------------------------------------------------------------------------
# Type definitions
# ---------------------------------------------------------------------------


class PoamEntry(TypedDict, total=False):
    weakness_description: str
    point_of_contact: str
    resources_required: str
    scheduled_completion_date: str
    milestones: list[dict[str, str]]
    source: str
    status: str
    deviation_request: bool
    original_detection_date: str
    vendor_dependency: bool
    false_positive: bool


class GrcFinding(TypedDict, total=False):
    control_id: str
    control_name: str
    framework: str
    status: str
    implementation_status: str
    control_origination: str
    inherited_from: str
    gap_description: str
    evidence_reviewed: list[str]
    recommendation: str
    risk_level: str
    poam_required: bool
    poam_entry: PoamEntry
    related_controls: list[dict[str, str]]
    last_assessed_date: str
    assessment_frequency: str
    ai_risk_category: str
    ai_rmf_function: str


class ConmonMetadata(TypedDict, total=False):
    last_full_assessment_date: str
    controls_assessed_this_period: int
    total_controls_in_baseline: int
    annual_assessment_coverage: float
    open_scan_findings: int
    significant_change_flag: bool
    next_annual_assessment_due: str


class AssessmentMetadata(TypedDict, total=False):
    framework: str
    framework_version: str
    baseline_or_level: str
    assessment_date: str
    scope: str
    conmon: ConmonMetadata


class GrcAssessment(TypedDict, total=False):
    assessment_metadata: AssessmentMetadata
    findings: list[GrcFinding]
    summary: str
    controls_assessed: int
    controls_satisfied: int
    controls_with_gaps: int
    overall_grc_percentage: float
    high_risk_findings: int
    cmmc_level_achievable: str
    cmmc_gaps_to_next_level: int
    ai_risk_tier: str
    ai_rmf_maturity: dict[str, Any]


class GrcAgentInput(TypedDict):
    framework: str
    baseline_or_level: str
    scope: str
    input_paths: list[str]


class EvidenceSummary(TypedDict):
    path: str
    excerpt: str


# ---------------------------------------------------------------------------
# Evidence helpers
# ---------------------------------------------------------------------------

_GLOB_RE = re.compile(r"[\*\?\[]")


def _looks_like_glob(pattern: str) -> bool:
    return bool(_GLOB_RE.search(pattern))


async def resolve_input_paths(inputs: list[str]) -> list[str]:
    resolved: list[str] = []
    for inp in inputs:
        if _looks_like_glob(inp):
            matches = await glob_files([inp])
            resolved.extend(matches)
        else:
            resolved.append(inp)
    return list(dict.fromkeys(resolved))  # deduplicate, preserving order


# Read errors are silently tolerated — the path is kept for traceability so
# the agent can still reference which files were attempted in findings.
async def load_evidence(paths: list[str]) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    for path in paths:
        try:
            content = await read_file(path)
            entries.append({"path": path, "content": content})
        except Exception:
            entries.append({"path": path, "content": "[ERROR: File could not be read]"})
    return entries


# Truncate to 2000 chars per file to stay within context-window budget while
# still giving the agent enough text for heuristic control matching.
def build_evidence_summaries(evidence: list[dict[str, str]]) -> list[EvidenceSummary]:
    return [
        EvidenceSummary(path=entry["path"], excerpt=entry["content"][:2000])
        for entry in evidence
    ]


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------


# Assemble the orchestrator prompt with four instruction sections:
# workflow (delegation strategy), verification (completeness checks),
# decision logic (when to delegate vs. work directly), and evidence.
def build_prompt(inp: GrcAgentInput, evidence: list[EvidenceSummary]) -> str:
    if evidence:
        evidence_block = "\n".join(
            f"- {e['path']}\n{e['excerpt'] or '(empty or unreadable)'}\n"
            for e in evidence
        )
    else:
        evidence_block = "No evidence files provided."

    evidence_paths = "\n".join(f"  - {e['path']}" for e in evidence)
    subagent_list = "\n".join(f"  - {a.name}: {a.purpose}" for a in subagents)

    return "\n".join([
        "You are a multi-framework GRC assessment orchestrator.",
        "",
        f"Framework: {inp['framework']}",
        f"Baseline/Level: {inp['baseline_or_level']}",
        f"Scope: {inp['scope']}",
        "",
        "## Available subagents",
        "",
        "You can delegate specialist work to these subagents using the Task tool:",
        subagent_list,
        "",
        "## Workflow",
        "",
        "1. **Understand scope** — review the framework, baseline, and evidence to determine assessment complexity.",
        "2. **Delegate specialist work** — for complex assessments, dispatch subagents using `Task` with `run_in_background: true` for independent tasks. Pass relevant evidence paths so subagents can read and analyze them.",
        "3. **Collect results** — use `TaskOutput` to retrieve completed subagent reports.",
        "4. **Synthesize** — combine subagent findings with your own analysis into the final JSON assessment.",
        "5. **Save working notes** — write subagent reports to `working/subagent-reports/`, evidence analysis to `working/evidence-analysis.md`, and the control checklist to `working/control-checklist.md`. These persist across turns and are inspectable by human auditors.",
        "",
        "## Verification",
        "",
        "Before producing the final assessment, verify:",
        "- **Control count** — the number of findings matches the expected baseline control count (use `baseline_selector` or framework data to confirm).",
        "- **Evidence paths** — every `evidence_reviewed` path actually exists. Use Bash (`test -f <path>`) or Read to confirm.",
        "- **POA&M completeness** — every finding with `poam_required: true` has a `poam_entry` with `weakness_description`, `scheduled_completion_date`, `milestones`, `source`, and `status`.",
        "- **Risk-timeline alignment** — critical findings have ≤30-day remediation, high ≤90, moderate ≤180.",
        "- Use Bash for file verification: `ls evidence/`, `wc -l`, `grep -c` to count and confirm artifacts.",
        "",
        "## Decision logic",
        "",
        "- **Delegate** when: baselines have 20+ controls, CMMC assessments need level determination, AI governance frameworks require risk classification, or multiple evidence files need cross-referencing.",
        "- **Work directly** when: simple assessments (FedRAMP Low with few controls), single evidence files, or straightforward gap identification.",
        "- You can mix both approaches — delegate some work while handling other parts directly.",
        "",
        "## Evidence",
        "",
        "Evidence file paths (pass these to subagents as needed):",
        evidence_paths,
        "",
        "Evidence excerpts:",
        evidence_block,
        "",
        "## Output",
        "",
        "Use MCP tools for control lookup, mapping, gaps, and findings where helpful.",
        "Return only valid JSON that matches the provided schema.",
    ])


# ---------------------------------------------------------------------------
# Subagent wiring
# ---------------------------------------------------------------------------


# Each subagent gets only the MCP tools relevant to its role — a control-
# assessor doesn't need the AI risk classifier, and the framework-mapper
# doesn't need the evidence validator.
def _get_subagent_mcp_tools(name: str) -> list[str]:
    tool_map: dict[str, list[str]] = {
        "control-assessor": [
            "mcp__grc-tools__control_lookup",
            "mcp__grc-tools__gap_analyzer",
            "mcp__grc-tools__evidence_validator",
            "mcp__fedramp-docs__get_control_requirements",
            "mcp__fedramp-docs__analyze_control_coverage",
        ],
        "evidence-reviewer": [
            "mcp__grc-tools__control_lookup",
            "mcp__grc-tools__evidence_validator",
            "mcp__fedramp-docs__get_evidence_examples",
            "mcp__fedramp-docs__get_ksi",
        ],
        "gap-reporter": [
            "mcp__grc-tools__control_lookup",
            "mcp__grc-tools__gap_analyzer",
            "mcp__grc-tools__finding_generator",
            "mcp__fedramp-docs__get_control_requirements",
            "mcp__fedramp-docs__search_markdown",
        ],
        "cmmc-specialist": [
            "mcp__grc-tools__control_lookup",
            "mcp__grc-tools__cmmc_level_checker",
            "mcp__grc-tools__gap_analyzer",
        ],
        "ai-governance-specialist": [
            "mcp__grc-tools__control_lookup",
            "mcp__grc-tools__ai_risk_classifier",
            "mcp__grc-tools__baseline_selector",
            "mcp__grc-tools__gap_analyzer",
        ],
        "framework-mapper": [
            "mcp__grc-tools__control_lookup",
            "mcp__grc-tools__framework_mapper",
            "mcp__fedramp-docs__list_controls",
            "mcp__fedramp-docs__get_control_requirements",
        ],
    }
    return tool_map.get(name, [])


def _get_role_guidance(name: str) -> str:
    guidance: dict[str, str] = {
        "control-assessor": (
            "Use control_lookup to retrieve control requirements and enhancement details. "
            "Use gap_analyzer to compare evidence against requirements. Use evidence_validator "
            "to check evidence sufficiency. Assess each control's implementation_status and "
            "control_origination. Focus on enhancement-level depth."
        ),
        "evidence-reviewer": (
            "Use control_lookup to understand what each control requires. Use evidence_validator "
            "to check whether evidence artifacts substantiate SSP claims. Look for currency "
            "(dates), completeness (all parts addressed), and relevance (evidence matches control). "
            "Flag insufficient or stale evidence."
        ),
        "gap-reporter": (
            "Use control_lookup for requirement details. Use gap_analyzer to identify missing "
            "or partial implementations. Use finding_generator to produce structured findings "
            "with risk levels and POA&M recommendations. Rank gaps by risk severity."
        ),
        "cmmc-specialist": (
            "Use control_lookup for NIST 800-171 practice requirements. Use cmmc_level_checker "
            "to determine achievable CMMC level. Use gap_analyzer to identify gaps preventing "
            "level achievement. Focus on practice-to-level mapping and DIBCAC readiness."
        ),
        "ai-governance-specialist": (
            "Use control_lookup for AI framework requirements. Use ai_risk_classifier to determine "
            "AI system risk tiers. Use baseline_selector for applicable control baselines. Use "
            "gap_analyzer for compliance gaps. Map findings to AI RMF functions (Govern/Map/Measure/Manage)."
        ),
        "framework-mapper": (
            "Use control_lookup to retrieve controls from multiple frameworks. Use framework_mapper "
            "to identify cross-framework mappings and overlapping requirements. Focus on reducing "
            "duplicate assessment effort by highlighting shared controls."
        ),
    }
    return guidance.get(name, "")


def _build_subagent_prompt(agent: SubagentConfig) -> str:
    return "\n".join([
        f"You are the {agent.name} subagent, part of a GRC assessment team.",
        "",
        agent.purpose,
        "",
        "## Instructions",
        "",
        "- Use Read, Glob, and Grep to examine evidence files provided by the orchestrator.",
        "- Use Bash for composable operations: grep for control IDs across files, count evidence artifacts, extract JSON fields with jq.",
        "- Use your MCP tools to perform structured analysis (control lookups, gap analysis, validation).",
        "- Produce a text report — the orchestrator will synthesize your findings into the final JSON.",
        "",
        "## Role-specific guidance",
        "",
        _get_role_guidance(agent.name),
        "",
        "## Output format",
        "",
        "Return a structured text report with these sections:",
        "",
        "### Summary",
        "Brief overview of what you assessed and key conclusions.",
        "",
        "### Findings",
        "Detailed findings, one per control or evidence artifact reviewed.",
        "",
        "### Recommendations",
        "Prioritized remediation actions or next steps.",
        "",
        "### Evidence Reviewed",
        "List of evidence files examined and their relevance.",
    ])


def build_subagent_definitions() -> dict[str, AgentDefinition]:
    definitions: dict[str, AgentDefinition] = {}
    for agent in subagents:
        base_tools = ["Bash", "Read", "Glob", "Grep"]
        mcp_tools = (
            _get_subagent_mcp_tools(agent.name)
            if USE_FEEDRAMP_DOCS_MCP
            else [
                tool
                for tool in _get_subagent_mcp_tools(agent.name)
                if not tool.startswith("mcp__fedramp-docs__")
            ]
        )
        definitions[agent.name] = AgentDefinition(
            description=agent.purpose,
            prompt=_build_subagent_prompt(agent),
            tools=[*base_tools, *mcp_tools],
            model=agent.model,
        )
    return definitions


# ---------------------------------------------------------------------------
# Shared constants — reused by both run_grc_agent (assessment) and the REPL
# (follow-up queries). Extracted here so tool/server lists stay in sync.
# ---------------------------------------------------------------------------

ALLOWED_TOOLS: list[str] = [
    "Bash",
    "Read",
    "Glob",
    "Grep",
    "Task",
    "TaskOutput",
    "mcp__grc-tools__control_lookup",
    "mcp__grc-tools__framework_mapper",
    "mcp__grc-tools__gap_analyzer",
    "mcp__grc-tools__evidence_validator",
    "mcp__grc-tools__finding_generator",
    "mcp__grc-tools__cmmc_level_checker",
    "mcp__grc-tools__ai_risk_classifier",
    "mcp__grc-tools__baseline_selector",
    "mcp__grc-tools__oscal_ssp_scaffold",
    "mcp__fedramp-docs__list_ksi",
    "mcp__fedramp-docs__get_ksi",
    "mcp__fedramp-docs__filter_by_impact",
    "mcp__fedramp-docs__get_evidence_examples",
    "mcp__fedramp-docs__list_controls",
    "mcp__fedramp-docs__get_control_requirements",
    "mcp__fedramp-docs__analyze_control_coverage",
    "mcp__fedramp-docs__search_markdown",
    "mcp__fedramp-docs__search_definitions",
    "mcp__fedramp-docs__get_requirement_by_id",
]

# grc-tools runs in-process (SDK MCP server); fedramp-docs is an external
# stdio server spawned as a child process via npx.
MCP_SERVERS: dict[str, Any] = {
    "grc-tools": grc_mcp_server,
}
if USE_FEEDRAMP_DOCS_MCP:
    MCP_SERVERS["fedramp-docs"] = {
        "command": "npx",
        "args": ["fedramp-docs-mcp"],
    }


def _get_allowed_tools() -> list[str]:
    if USE_FEEDRAMP_DOCS_MCP:
        return list(ALLOWED_TOOLS)
    return [
        tool
        for tool in ALLOWED_TOOLS
        if not tool.startswith("mcp__fedramp-docs__")
    ]


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


# Three-stage pipeline: evidence loading → query execution → result extraction.
# The agent runs autonomously, using MCP tools and subagents as needed.
async def run_grc_agent(inp: GrcAgentInput) -> GrcAssessment:
    now = datetime.now(timezone.utc).isoformat()
    model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5-20250929")
    resolved_paths = await resolve_input_paths(inp["input_paths"])
    evidence = await load_evidence(resolved_paths)
    evidence_summaries = build_evidence_summaries(evidence)
    agents = build_subagent_definitions()

    prompt = build_prompt(inp, evidence_summaries)
    assessment: GrcAssessment | None = None

    options = ClaudeAgentOptions(
        model=model,
        allowed_tools=_get_allowed_tools(),
        permission_mode="bypassPermissions",
        max_turns=GRC_MAX_TURNS,
        output_format={"type": "json_schema", "schema": grc_assessment_schema},
        mcp_servers=dict(MCP_SERVERS),
        agents=agents,
        cli_path=CLAUDE_CODE_EXECUTABLE,
    )

    async def _prompt_stream() -> AsyncIterator[dict[str, Any]]:
        yield {
            "type": "user",
            "message": {"role": "user", "content": prompt},
            "parent_tool_use_id": None,
            "session_id": "default",
        }

    client = ClaudeSDKClient(options=options)
    await client.connect(prompt=_prompt_stream())
    try:
        # Drain all messages so MCP control responses can complete before disconnecting.
        async for message in client.receive_messages():
            if isinstance(message, ResultMessage) and message.subtype == "success" and message.structured_output:
                assessment = message.structured_output
    finally:
        await client.disconnect()

    if not assessment:
        return GrcAssessment(
            assessment_metadata=AssessmentMetadata(
                framework=inp["framework"],
                baseline_or_level=inp["baseline_or_level"],
                assessment_date=now,
                scope=inp["scope"],
            ),
            findings=[],
            summary="Assessment did not return structured output.",
            overall_grc_percentage=0,
        )

    return assessment
