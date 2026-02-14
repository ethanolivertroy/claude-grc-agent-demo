"""OSCAL SSP conversion orchestrator — Python port of src/oscal-convert.ts.

Reads an SSP document (markdown or DOCX) and converts it to OSCAL SSP JSON
using an agent-driven approach. The agent understands SSP structure through
the oscal_ssp_scaffold tool and OSCAL skill knowledge, then maps narratives
to OSCAL's implemented-requirements structure.

DOCX input uses docling for structured table extraction — FedRAMP's
two-table-per-control pattern is parsed programmatically, and only
narrative text is sent to the agent.

This is a separate workflow from the assessment pipeline — it produces an
OSCAL artifact, not assessment findings.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, TypedDict

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

from .grc_agent import ALLOWED_TOOLS, CLAUDE_CODE_EXECUTABLE, MCP_SERVERS
from .schemas.oscal_ssp_schema import oscal_ssp_schema

OscalSsp = dict[str, Any]

# ~200K chars ≈ ~50K tokens, leaving room for prompt + tool calls + output.
MAX_CONTENT_CHARS = 200_000

# Matches "AC-2 Control Summary Information" (with optional enhancement number)
_CIS_HEADER_RE = re.compile(r"^([A-Z]{2}-\d+(?:\(\d+\))?)\s+Control Summary Information")
# Matches "AC-2 What is the solution..."
_STATEMENT_HEADER_RE = re.compile(r"^([A-Z]{2}-\d+(?:\(\d+\))?)\s+What is the solution")
# Matches "Part a:" or "Part (a):"
_PART_LABEL_RE = re.compile(r"^Part\s+\(?([a-z])\)?:", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Docling structured extraction types
# ---------------------------------------------------------------------------


class ExtractedControl(TypedDict):
    control_id: str
    status: str
    origination: str
    roles: str
    params: dict[str, str]
    parts: dict[str, str]
    raw_narrative: str


# ---------------------------------------------------------------------------
# CIS table parsing — single-column tables with inline metadata
#
# FedRAMP DOCX tables are Nx1 (single column). Metadata is embedded in each
# cell's text content, not across columns.
# ---------------------------------------------------------------------------


def _get_cell_texts(table: Any) -> list[str]:
    """Extract text from each cell in a docling table."""
    return [c.text for c in table.data.table_cells]


def _parse_cis_table(cell_texts: list[str]) -> dict[str, Any] | None:
    """Parse a Control Information Summary table. Returns None if not a CIS."""
    if not cell_texts:
        return None

    match = _CIS_HEADER_RE.match(cell_texts[0])
    if not match:
        return None

    control_id = match.group(1).lower()
    status = ""
    origination = ""
    roles = ""
    params: dict[str, str] = {}

    for text in cell_texts:
        trimmed = text.strip()

        if trimmed.startswith("Responsible Role:"):
            roles = trimmed.replace("Responsible Role:", "").strip()
        elif trimmed.startswith("Implementation Status"):
            status = trimmed
        elif trimmed.startswith("Control Origination"):
            origination = trimmed
        elif trimmed.startswith("Parameter "):
            param_match = re.match(r"^Parameter\s+(\S+?):\s*(.*)", trimmed)
            if param_match:
                params[param_match.group(1)] = param_match.group(2)

    return {
        "control_id": control_id,
        "status": status,
        "origination": origination,
        "roles": roles,
        "params": params,
    }


# ---------------------------------------------------------------------------
# Statement table parsing — "What is the solution" tables
# ---------------------------------------------------------------------------


def _parse_statement_table(cell_texts: list[str]) -> tuple[dict[str, str], str]:
    """Parse an implementation statement table into parts and raw narrative."""
    parts: dict[str, str] = {}
    lines: list[str] = []

    # Skip header row ("AC-2 What is the solution...")
    for text in cell_texts[1:]:
        text = text.strip()
        if not text:
            continue

        match = _PART_LABEL_RE.match(text)
        if match:
            letter = match.group(1).lower()
            parts[letter] = _PART_LABEL_RE.sub("", text).strip()
        lines.append(text)

    return parts, "\n".join(lines)


# ---------------------------------------------------------------------------
# Docling DOCX extraction pipeline
# ---------------------------------------------------------------------------


def _extract_docx_controls(input_path: str) -> list[ExtractedControl]:
    """Extract controls from a FedRAMP DOCX SSP using docling's Python API."""
    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    result = converter.convert(input_path)
    doc = result.document

    controls: list[ExtractedControl] = []
    tables = doc.tables
    i = 0

    while i < len(tables):
        cell_texts = _get_cell_texts(tables[i])
        cis = _parse_cis_table(cell_texts)

        if not cis:
            i += 1
            continue

        # Pair with the next table if it's the matching statement table
        parts: dict[str, str] = {}
        raw_narrative = ""
        if i + 1 < len(tables):
            next_texts = _get_cell_texts(tables[i + 1])
            if next_texts and _STATEMENT_HEADER_RE.match(next_texts[0]):
                parts, raw_narrative = _parse_statement_table(next_texts)
                i += 2  # skip statement table
            else:
                i += 1
        else:
            i += 1

        controls.append(ExtractedControl(
            control_id=cis["control_id"],
            status=cis["status"],
            origination=cis["origination"],
            roles=cis["roles"],
            params=cis["params"],
            parts=parts,
            raw_narrative=raw_narrative,
        ))

    return controls


# ---------------------------------------------------------------------------
# Structured prompt — pre-parsed control data
# ---------------------------------------------------------------------------


def _build_structured_prompt(controls: list[ExtractedControl], input_path: str) -> str:
    header = [
        "You are an OSCAL SSP conversion specialist. Convert the following pre-extracted control data",
        "into OSCAL SSP JSON format.",
        "",
        "## Instructions",
        "",
        "1. Use the `oscal_ssp_scaffold` tool to get the target OSCAL SSP structure with required fields.",
        "2. Use `control_lookup` to validate control IDs against framework data.",
        "3. Include `import-profile` with the baseline profile URI, `system-implementation` with at least",
        "   one component (type 'this-system'), and all required `system-characteristics` fields.",
        "4. Map each control to `implemented-requirements` with `by-components` entries.",
        "5. The metadata below (status, origination, roles) was extracted programmatically from",
        "   DOCX table structure and is reliable. Focus on mapping narratives to OSCAL `statements`.",
        "6. Generate valid UUID v4 (random) or v5 (name-based) values for all uuid fields.",
        "   Prefer v5 for document and component UUIDs (deterministic), v4 for instance-specific UUIDs.",
        "7. Use lowercase control IDs (e.g., 'ac-2', not 'AC-2').",
        "8. Set oscal-version to '1.2.0'.",
        "",
        "## Pre-extracted Controls (from DOCX table structure)",
        "",
        f"Source: {Path(input_path).name}",
        f"Total controls: {len(controls)}",
        "",
    ]

    control_blocks: list[str] = []
    for ctrl in controls:
        lines = [f"### {ctrl['control_id']}"]
        if ctrl["status"]:
            lines.append(f"- Status: {ctrl['status']}")
        if ctrl["origination"]:
            lines.append(f"- Origination: {ctrl['origination']}")
        if ctrl["roles"]:
            lines.append(f"- Roles: {ctrl['roles']}")

        if ctrl["params"]:
            for key in sorted(ctrl["params"]):
                val = ctrl["params"][key]
                if val:
                    lines.append(f"- {key}: {val}")

        if ctrl["parts"]:
            for letter in sorted(ctrl["parts"]):
                lines.append(f"- Part ({letter}): {ctrl['parts'][letter]}")
        elif ctrl["raw_narrative"]:
            lines.append(f"- Narrative: {ctrl['raw_narrative']}")

        control_blocks.append("\n".join(lines))

    return "\n".join([
        *header,
        *control_blocks,
        "",
        "## Output",
        "",
        "Return valid OSCAL SSP JSON matching the provided schema.",
    ])


# ---------------------------------------------------------------------------
# Markdown input
# ---------------------------------------------------------------------------


def _read_markdown_ssp(input_path: str) -> str:
    """Read a markdown SSP, truncating if needed."""
    content = Path(input_path).read_text(encoding="utf-8")

    if len(content) > MAX_CONTENT_CHARS:
        original_kb = round(len(content) / 1024)
        truncated_kb = round(MAX_CONTENT_CHARS / 1024)
        print(
            f"Warning: Input document is {original_kb} KB — truncating to {truncated_kb} KB "
            "to fit within context limits. Some controls near the end may be omitted.",
            file=sys.stderr,
        )
        content = content[:MAX_CONTENT_CHARS]

    return content


def _build_conversion_prompt(ssp_content: str, input_path: str) -> str:
    return "\n".join([
        "You are an OSCAL SSP conversion specialist. Convert the following System Security Plan",
        "document into OSCAL SSP JSON format.",
        "",
        "## Instructions",
        "",
        "1. Use the `oscal_ssp_scaffold` tool to get the target OSCAL SSP structure with required fields.",
        "2. Use `control_lookup` to validate any control IDs found in the SSP against framework data.",
        "3. Include `import-profile` with the baseline profile URI, `system-implementation` with at least",
        "   one component (type 'this-system'), and all required `system-characteristics` fields",
        "   (system-ids, description, status, authorization-boundary, etc.).",
        "4. Map each control narrative to `implemented-requirements` with `by-components` entries.",
        "5. Preserve:",
        "   - Implementation status (implemented, partial, planned, alternative, not-applicable)",
        "   - Control origination (service provider vs. inherited vs. shared)",
        "   - Authorization boundary details",
        "   - Security sensitivity level and FIPS 199 impact levels",
        "6. Generate valid UUID v4 (random) or v5 (name-based) values for all uuid fields.",
        "   Prefer v5 for document and component UUIDs (deterministic), v4 for instance-specific UUIDs.",
        "7. Use lowercase control IDs (e.g., 'ac-2', not 'AC-2').",
        "8. Set oscal-version to '1.2.0'.",
        "9. If the document appears truncated, convert all controls present — do not halt.",
        "",
        "## Source SSP Document",
        "",
        f"File: {Path(input_path).name}",
        "",
        "```",
        ssp_content,
        "```",
        "",
        "## Output",
        "",
        "Return valid OSCAL SSP JSON matching the provided schema.",
    ])


# ---------------------------------------------------------------------------
# Main conversion entry point
# ---------------------------------------------------------------------------


async def convert_to_oscal_ssp(input_path: str) -> OscalSsp:
    """Convert an SSP document to OSCAL SSP JSON."""
    model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5-20250929")
    ext = Path(input_path).suffix.lower()

    if ext == ".docx":
        controls = _extract_docx_controls(input_path)
        if controls:
            prompt = _build_structured_prompt(controls, input_path)
        else:
            print(
                "Warning: No controls extracted from DOCX tables. "
                "Falling back to plain text extraction.",
                file=sys.stderr,
            )
            from docling.document_converter import DocumentConverter

            converter = DocumentConverter()
            result = converter.convert(input_path)
            content = result.document.export_to_markdown()
            if len(content) > MAX_CONTENT_CHARS:
                content = content[:MAX_CONTENT_CHARS]
            prompt = _build_conversion_prompt(content, input_path)
    else:
        ssp_content = _read_markdown_ssp(input_path)
        prompt = _build_conversion_prompt(ssp_content, input_path)

    oscal_ssp: OscalSsp | None = None

    options = ClaudeAgentOptions(
        model=model,
        cli_path=CLAUDE_CODE_EXECUTABLE,
        allowed_tools=list(ALLOWED_TOOLS),
        permission_mode="bypassPermissions",
        max_turns=30,
        output_format={"type": "json_schema", "schema": oscal_ssp_schema},
        mcp_servers=dict(MCP_SERVERS),
    )

    async for message in query(prompt=prompt, options=options):
        if isinstance(message, ResultMessage) and message.subtype == "success":
            oscal_ssp = message.structured_output

    if not oscal_ssp:
        raise RuntimeError("OSCAL SSP conversion did not produce structured output.")

    return oscal_ssp


def default_output_path(input_path: str) -> str:
    """Derive the default output path: sample-ssp.md → sample-ssp-oscal.json"""
    p = Path(input_path)
    return str(p.with_name(f"{p.stem}-oscal.json"))


async def write_oscal_ssp(oscal_ssp: OscalSsp, output_path: str) -> None:
    """Write OSCAL SSP JSON to a file."""
    Path(output_path).write_text(
        json.dumps(oscal_ssp, indent=2) + "\n", encoding="utf-8"
    )
