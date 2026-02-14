"""OSCAL mapping-collection conversion orchestrator — Python port of src/mapping-convert.ts.

Reads a framework-mappings JSON file and converts it to an OSCAL
mapping-collection JSON document using an agent-driven approach. The agent
understands mapping structure through the oscal_mapping_scaffold tool and
infers relationship types (equivalent-to, subset-of, etc.) from context.

This parallels the OSCAL SSP conversion workflow but targets the Control
Mapping model introduced in OSCAL 1.2.0.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

from .grc_agent import ALLOWED_TOOLS, CLAUDE_CODE_EXECUTABLE, MCP_SERVERS
from .schemas.oscal_mapping_schema import oscal_mapping_schema

OscalMapping = dict[str, Any]


def _build_mapping_prompt(data: dict[str, Any], input_path: str) -> str:
    total_maps = sum(len(g["mappings"]) for g in data["mappings"])

    header = [
        "You are an OSCAL conversion specialist. Convert the following cross-framework control mapping data",
        "into OSCAL mapping-collection JSON format (OSCAL 1.2.0).",
        "",
        "## Instructions",
        "",
        "1. Use the `oscal_mapping_scaffold` tool to get the OSCAL mapping-collection structure.",
        "2. Use `control_lookup` to validate control IDs against framework data when helpful.",
        "3. Each mapping group below becomes one entry in the `mappings` array, with `source-resource`",
        "   and `target-resource` identifying the frameworks.",
        "4. Each control pair becomes a `maps[]` entry with `source`, `target`, and `relationship`.",
        "5. Infer the relationship type from control context:",
        "   - `equivalent-to` — controls address the same requirement",
        "   - `subset-of` — source is a narrower requirement than target",
        "   - `superset-of` — source is a broader requirement than target",
        "   - `intersects-with` — controls partially overlap",
        "   When unsure, default to `equivalent-to` for direct mappings.",
        "6. Generate valid UUID v4 (random) or v5 (name-based) values for all uuid fields.",
        "   Prefer v5 for document and component UUIDs (deterministic), v4 for instance-specific UUIDs.",
        "7. Use lowercase control IDs (e.g., 'ac-2', not 'AC-2').",
        "8. Set oscal-version to '1.2.0'.",
        "",
        "## Source Mapping Data",
        "",
        f"File: {Path(input_path).name}",
        f"Total mapping groups: {len(data['mappings'])}",
        f"Total control pairs: {total_maps}",
        "",
    ]

    group_blocks: list[str] = []
    for group in data["mappings"]:
        lines = [f"### {group['source']} → {group['target']}"]
        for pair in group["mappings"]:
            lines.append(f"- {pair['source_control_id']} → {pair['target_control_id']}")
        group_blocks.append("\n".join(lines))

    return "\n".join([
        *header,
        *group_blocks,
        "",
        "## Output",
        "",
        "Return valid OSCAL mapping-collection JSON matching the provided schema.",
    ])


async def convert_to_oscal_mapping(input_path: str) -> OscalMapping:
    """Convert a framework-mappings JSON file to OSCAL mapping-collection."""
    model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5-20250929")

    raw = Path(input_path).read_text(encoding="utf-8")
    data = json.loads(raw)
    prompt = _build_mapping_prompt(data, input_path)

    oscal_mapping: OscalMapping | None = None

    options = ClaudeAgentOptions(
        model=model,
        cli_path=CLAUDE_CODE_EXECUTABLE,
        allowed_tools=list(ALLOWED_TOOLS),
        permission_mode="bypassPermissions",
        max_turns=15,
        output_format={"type": "json_schema", "schema": oscal_mapping_schema},
        mcp_servers=dict(MCP_SERVERS),
    )

    async for message in query(prompt=prompt, options=options):
        if isinstance(message, ResultMessage) and message.subtype == "success":
            oscal_mapping = message.structured_output

    if not oscal_mapping:
        raise RuntimeError("OSCAL mapping conversion did not produce structured output.")

    return oscal_mapping


def default_mapping_output_path(input_path: str) -> str:
    """Derive the default output path: framework-mappings.json → framework-mappings-oscal.json"""
    p = Path(input_path)
    return str(p.with_name(f"{p.stem}-oscal.json"))


async def write_oscal_mapping(oscal_mapping: OscalMapping, output_path: str) -> None:
    """Write OSCAL mapping-collection JSON to a file."""
    Path(output_path).write_text(
        json.dumps(oscal_mapping, indent=2) + "\n", encoding="utf-8"
    )
