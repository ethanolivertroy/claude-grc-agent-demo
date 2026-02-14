import { AgentDefinition, type McpServerConfig, query } from "@anthropic-ai/claude-agent-sdk";
import { grcAssessmentSchema } from "./schemas/grc-schema.js";
import { glob, readFile } from "./tools/fs-tools.js";
import { grcMcpServer } from "./mcp/grc-server.js";
import { subagents, SubagentConfig } from "./subagents/index.js";
import { createHash } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

type BunHashInput = string | ArrayBuffer | ArrayBufferView;

function installBunHashShim(): void {
  const globalScope = globalThis as {
    Bun?: {
      hash: (input: BunHashInput) => number;
    };
  };

  if (globalScope.Bun !== undefined) return;

  const toBuffer = (input: BunHashInput): Buffer => {
    if (typeof input === "string") {
      return Buffer.from(input, "utf8");
    }
    if (ArrayBuffer.isView(input)) {
      return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    }
    return Buffer.from(new Uint8Array(input));
  };

  globalScope.Bun = {
    hash(input: BunHashInput): number {
      const digest = createHash("sha256").update(toBuffer(input)).digest();
      return digest.readUInt32BE(0);
    },
  };
}

installBunHashShim();

const CANDIDATE_CLAUDE_CODE_PATHS = [
  process.env.HOME ? join(process.env.HOME, ".local", "bin", "claude") : "",
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
  "/usr/bin/claude",
];

export const CLAUDE_CODE_EXECUTABLE =
  process.env.CLAUDE_CODE_EXECUTABLE ??
  process.env.CLAUDE_CODE_PATH ??
  resolveLocalClaudeCodeBinary();

function resolveLocalClaudeCodeBinary(): string {
  const explicit = process.env.CLAUDE_CODE_EXECUTABLE ?? process.env.CLAUDE_CODE_PATH;
  if (explicit && explicit.trim()) return explicit.trim();

  for (const candidate of CANDIDATE_CLAUDE_CODE_PATHS) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // ignore and try next
    }
  }

  const pathDirs = (process.env.PATH ?? "").split(delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    try {
      const candidate = join(dir, "claude");
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // ignore and keep searching
    }
  }

  return "claude";
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export type GrcAgentInput = {
  framework: string;
  baselineOrLevel: string;
  scope: string;
  inputPaths: string[];
};

type PoamEntry = {
  weakness_description?: string;
  point_of_contact?: string;
  resources_required?: string;
  scheduled_completion_date?: string;
  milestones?: Array<{ description: string; due_date: string }>;
  source?: "assessment" | "scan" | "conmon" | "incident";
  status?: "open" | "closed" | "risk_accepted";
  deviation_request?: boolean;
  original_detection_date?: string;
  vendor_dependency?: boolean;
  false_positive?: boolean;
};

type GrcFinding = {
  control_id: string;
  control_name?: string;
  framework: string;
  status: "satisfied" | "partially_satisfied" | "not_satisfied" | "not_applicable";
  implementation_status?:
    | "implemented"
    | "partially_implemented"
    | "planned"
    | "alternative"
    | "not_applicable";
  control_origination?:
    | "service_provider_corporate"
    | "service_provider_system"
    | "customer_responsibility"
    | "shared"
    | "inherited";
  inherited_from?: string;
  gap_description?: string;
  evidence_reviewed?: string[];
  recommendation?: string;
  risk_level: "low" | "moderate" | "high" | "critical";
  poam_required?: boolean;
  poam_entry?: PoamEntry;
  related_controls?: Array<{ framework: string; control_id: string }>;
  last_assessed_date?: string;
  assessment_frequency?: string;
  ai_risk_category?: "minimal" | "limited" | "high" | "unacceptable";
  ai_rmf_function?: "govern" | "map" | "measure" | "manage";
};

type ConmonMetadata = {
  last_full_assessment_date?: string;
  controls_assessed_this_period?: number;
  total_controls_in_baseline?: number;
  annual_assessment_coverage?: number;
  open_scan_findings?: number;
  significant_change_flag?: boolean;
  next_annual_assessment_due?: string;
};

export type GrcAssessment = {
  assessment_metadata: {
    framework: string;
    framework_version?: string;
    baseline_or_level: string;
    assessment_date: string;
    scope: string;
    conmon?: ConmonMetadata;
  };
  findings: GrcFinding[];
  summary: string;
  controls_assessed?: number;
  controls_satisfied?: number;
  controls_with_gaps?: number;
  overall_grc_percentage: number;
  high_risk_findings?: number;
  cmmc_level_achievable?: "Level 1" | "Level 2" | "Level 3" | "None";
  cmmc_gaps_to_next_level?: number;
  ai_risk_tier?: string;
  ai_rmf_maturity?: Record<string, unknown>;
};

export type EvidenceSummary = {
  path: string;
  excerpt: string;
};

function getBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function getIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
}

const USE_FEEDRAMP_DOCS_MCP = getBooleanEnv("GRC_USE_FEDRAMP_DOCS_MCP", true);
const GRC_MAX_TURNS = getIntEnv("GRC_MAX_TURNS", 50);

// ---------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------

function looksLikeGlob(pattern: string): boolean {
  return /[\*\?\[]/.test(pattern);
}

export async function resolveInputPaths(inputs: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const input of inputs) {
    if (looksLikeGlob(input)) {
      const matches = await glob([input], { absolute: true });
      resolved.push(...matches);
    } else {
      resolved.push(input);
    }
  }
  return Array.from(new Set(resolved));
}

// Read errors are silently tolerated — the path is kept for traceability so
// the agent can still reference which files were attempted in findings.
export async function loadEvidence(paths: string[]): Promise<{ path: string; content: string }[]> {
  const entries: { path: string; content: string }[] = [];
  for (const path of paths) {
    try {
      const content = await readFile(path);
      entries.push({ path, content });
    } catch (error) {
      // Skip unreadable files, but keep the path noted for traceability.
      entries.push({ path, content: "[ERROR: File could not be read]" });
      void error;
    }
  }
  return entries;
}

// Truncate to 2000 chars per file to stay within context-window budget while
// still giving the agent enough text for heuristic control matching.
export function buildEvidenceSummaries(evidence: { path: string; content: string }[]): EvidenceSummary[] {
  return evidence.map((entry) => ({
    path: entry.path,
    excerpt: entry.content.slice(0, 2000),
  }));
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

// Assemble the orchestrator prompt with four instruction sections:
// workflow (delegation strategy), verification (completeness checks),
// decision logic (when to delegate vs. work directly), and evidence.
export function buildPrompt(
  input: GrcAgentInput,
  evidence: EvidenceSummary[]
): string {
  const evidenceBlock = evidence.length
    ? evidence
        .map(
          (entry) =>
            `- ${entry.path}\n${entry.excerpt || "(empty or unreadable)"}\n`
        )
        .join("\n")
    : "No evidence files provided.";

  const evidencePaths = evidence.map((e) => e.path);

  const subagentList = subagents
    .map((a) => `  - ${a.name}: ${a.purpose}`)
    .join("\n");

  return [
    "You are a multi-framework GRC assessment orchestrator.",
    "",
    `Framework: ${input.framework}`,
    `Baseline/Level: ${input.baselineOrLevel}`,
    `Scope: ${input.scope}`,
    "",
    "## Available subagents",
    "",
    "You can delegate specialist work to these subagents using the Task tool:",
    subagentList,
    "",
    "## Workflow",
    "",
    "1. **Understand scope** — review the framework, baseline, and evidence to determine assessment complexity.",
    "2. **Delegate specialist work** — for complex assessments, dispatch subagents using `Task` with `run_in_background: true` for independent tasks. Pass relevant evidence paths so subagents can read and analyze them.",
    "3. **Collect results** — use `TaskOutput` to retrieve completed subagent reports.",
    "4. **Synthesize** — combine subagent findings with your own analysis into the final JSON assessment.",
    "5. **Track working notes** — capture subagent and evidence analysis in your chosen external audit workflow (for example, an external logging tool or your incident tracker).",
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
    evidencePaths.map((p) => `  - ${p}`).join("\n"),
    "",
    "Evidence excerpts:",
    evidenceBlock,
    "",
    "## Output",
    "",
    "Use MCP tools for control lookup, mapping, gaps, and findings where helpful.",
    "Return only valid JSON that matches the provided schema.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Subagent wiring
// ---------------------------------------------------------------------------

// Each subagent gets only the MCP tools relevant to its role — a control-
// assessor doesn't need the AI risk classifier, and the framework-mapper
// doesn't need the evidence validator.
function getSubagentMcpTools(name: string): string[] {
  const toolMap: Record<string, string[]> = {
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
  };
  return toolMap[name] ?? [];
}

function getRoleGuidance(name: string): string {
  const guidance: Record<string, string> = {
    "control-assessor":
      "Use control_lookup to retrieve control requirements and enhancement details. " +
      "Use gap_analyzer to compare evidence against requirements. Use evidence_validator " +
      "to check evidence sufficiency. Assess each control's implementation_status and " +
      "control_origination. Focus on enhancement-level depth.",
    "evidence-reviewer":
      "Use control_lookup to understand what each control requires. Use evidence_validator " +
      "to check whether evidence artifacts substantiate SSP claims. Look for currency " +
      "(dates), completeness (all parts addressed), and relevance (evidence matches control). " +
      "Flag insufficient or stale evidence.",
    "gap-reporter":
      "Use control_lookup for requirement details. Use gap_analyzer to identify missing " +
      "or partial implementations. Use finding_generator to produce structured findings " +
      "with risk levels and POA&M recommendations. Rank gaps by risk severity.",
    "cmmc-specialist":
      "Use control_lookup for NIST 800-171 practice requirements. Use cmmc_level_checker " +
      "to determine achievable CMMC level. Use gap_analyzer to identify gaps preventing " +
      "level achievement. Focus on practice-to-level mapping and DIBCAC readiness.",
    "ai-governance-specialist":
      "Use control_lookup for AI framework requirements. Use ai_risk_classifier to determine " +
      "AI system risk tiers. Use baseline_selector for applicable control baselines. Use " +
      "gap_analyzer for compliance gaps. Map findings to AI RMF functions (Govern/Map/Measure/Manage).",
    "framework-mapper":
      "Use control_lookup to retrieve controls from multiple frameworks. Use framework_mapper " +
      "to identify cross-framework mappings and overlapping requirements. Focus on reducing " +
      "duplicate assessment effort by highlighting shared controls.",
  };
  return guidance[name] ?? "";
}

function buildSubagentPrompt(agent: SubagentConfig): string {
  return [
    `You are the ${agent.name} subagent, part of a GRC assessment team.`,
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
    getRoleGuidance(agent.name),
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
  ].join("\n");
}

export function buildSubagentDefinitions(): Record<string, AgentDefinition> {
  return subagents.reduce<Record<string, AgentDefinition>>((acc, agent) => {
    const baseTools = ["Bash", "Read", "Glob", "Grep"];
    const mcpTools = USE_FEEDRAMP_DOCS_MCP
      ? getSubagentMcpTools(agent.name)
      : getSubagentMcpTools(agent.name).filter((tool) => !tool.startsWith("mcp__fedramp-docs__"));
    acc[agent.name] = {
      description: agent.purpose,
      prompt: buildSubagentPrompt(agent),
      tools: [...baseTools, ...mcpTools],
      model: agent.model,
    } as AgentDefinition;
    return acc;
  }, {});
}

// ---------------------------------------------------------------------------
// Shared constants — reused by both runGrcAgent (assessment) and the REPL
// (follow-up queries). Extracted here so tool/server lists stay in sync.
// ---------------------------------------------------------------------------

const BASE_ALLOWED_TOOLS = [
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
] as const;

// grc-tools runs in-process (SDK MCP server); fedramp-docs is an external
// stdio server spawned as a child process via npx.
export const GRC_MCP_SERVERS: Record<string, McpServerConfig> = {
  "grc-tools": grcMcpServer as McpServerConfig,
};

if (USE_FEEDRAMP_DOCS_MCP) {
  GRC_MCP_SERVERS["fedramp-docs"] = {
    command: "npx" as const,
    args: ["fedramp-docs-mcp"],
  };
}

export const GRC_ALLOWED_TOOLS = USE_FEEDRAMP_DOCS_MCP
  ? [...BASE_ALLOWED_TOOLS]
  : BASE_ALLOWED_TOOLS.filter((tool) => !tool.startsWith("mcp__fedramp-docs__"));

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

// Three-stage pipeline: evidence loading → query execution → result extraction.
// The agent runs autonomously, using MCP tools and subagents as needed.
export async function runGrcAgent(
  input: GrcAgentInput
): Promise<GrcAssessment> {
  const now = new Date().toISOString();
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";
  const resolvedPaths = await resolveInputPaths(input.inputPaths);
  const evidence = await loadEvidence(resolvedPaths);
  const evidenceSummaries = buildEvidenceSummaries(evidence);
  const agents = buildSubagentDefinitions();

  const prompt = buildPrompt(input, evidenceSummaries);
  let assessment: GrcAssessment | null = null;

  for await (const message of query({
    prompt,
      options: {
      model,
      allowedTools: [...GRC_ALLOWED_TOOLS],
      permissionMode: "bypassPermissions",
      maxTurns: GRC_MAX_TURNS,
      pathToClaudeCodeExecutable: CLAUDE_CODE_EXECUTABLE,
      outputFormat: {
        type: "json_schema",
        schema: grcAssessmentSchema,
      },
      mcpServers: { ...GRC_MCP_SERVERS },
      agents,
    },
  })) {
    if (message.type === "result" && message.subtype === "success" && message.structured_output) {
      assessment = message.structured_output as GrcAssessment;
    }
  }

  if (!assessment) {
    return {
      assessment_metadata: {
        framework: input.framework,
        baseline_or_level: input.baselineOrLevel,
        assessment_date: now,
        scope: input.scope,
      },
      findings: [],
      summary: "Assessment did not return structured output.",
      overall_grc_percentage: 0,
    };
  }

  return assessment;
}
