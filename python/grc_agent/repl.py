"""Interactive REPL for GRC assessments — Python port of src/repl.ts.

Two-phase architecture:
  Phase 1 — Run the full assessment with schema-validated JSON output.
  Phase 2 — Enter an input loop where follow-up questions go through a
            new query() call with no output_format constraint (free-form text),
            resuming the same session so the agent retains conversation context.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query
from claude_agent_sdk.types import StreamEvent

from .grc_agent import (
    ALLOWED_TOOLS,
    MCP_SERVERS,
    CLAUDE_CODE_EXECUTABLE,
    AssessmentMetadata,
    EvidenceSummary,
    GrcAgentInput,
    GrcAssessment,
    build_evidence_summaries,
    build_prompt,
    build_subagent_definitions,
    load_evidence,
    resolve_input_paths,
)
from .schemas.grc_schema import grc_assessment_schema


# ---------------------------------------------------------------------------
# Assessment phase — identical pipeline to run_grc_agent, but captures the
# session_id so we can resume it for follow-up queries.
# ---------------------------------------------------------------------------


async def _run_assessment_phase(
    inp: GrcAgentInput,
    evidence_summaries: list[EvidenceSummary],
) -> tuple[GrcAssessment, str]:
    """Run the structured assessment and return (assessment, session_id)."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5-20250929")
    agents = build_subagent_definitions()
    prompt = build_prompt(inp, evidence_summaries)

    assessment: GrcAssessment | None = None
    session_id = ""

    options = ClaudeAgentOptions(
        model=model,
        cli_path=CLAUDE_CODE_EXECUTABLE,
        allowed_tools=list(ALLOWED_TOOLS),
        permission_mode="bypassPermissions",
        max_turns=50,
        output_format={"type": "json_schema", "schema": grc_assessment_schema},
        mcp_servers=dict(MCP_SERVERS),
        agents=agents,
    )

    async for message in query(prompt=prompt, options=options):
        if not session_id and hasattr(message, "session_id") and message.session_id:
            session_id = message.session_id
        if isinstance(message, ResultMessage) and message.subtype == "success":
            assessment = message.structured_output

    if not assessment:
        assessment = GrcAssessment(
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

    return assessment, session_id


# ---------------------------------------------------------------------------
# Follow-up prompt — gives the agent full assessment context and instructs
# it to answer in plain text using the same MCP tools.
# ---------------------------------------------------------------------------


def _build_follow_up_prompt(inp: GrcAgentInput, assessment: GrcAssessment) -> str:
    return "\n".join([
        "You are a GRC assessment assistant. You completed the following assessment:",
        "",
        "```json",
        json.dumps(assessment, indent=2),
        "```",
        "",
        f"Framework: {inp['framework']}",
        f"Baseline/Level: {inp['baseline_or_level']}",
        f"Scope: {inp['scope']}",
        "",
        "Answer follow-up questions about this assessment using your MCP tools",
        "(control_lookup, gap_analyzer, evidence_validator, etc.) when helpful.",
        "Respond in clear, readable plain text unless the user explicitly requests JSON.",
    ])


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------


def _display_assessment_summary(assessment: GrcAssessment) -> None:
    meta = assessment["assessment_metadata"]
    pct = assessment.get("overall_grc_percentage", 0)

    print("\n╔══════════════════════════════════════════╗")
    print("║         GRC Assessment Complete          ║")
    print("╚══════════════════════════════════════════╝\n")
    print(f"  Framework:          {meta['framework']}")
    print(f"  Baseline/Level:     {meta['baseline_or_level']}")
    print(f"  Scope:              {meta['scope']}")
    print(f"  Compliance:         {pct}%")

    if "controls_assessed" in assessment:
        print(f"  Controls assessed:  {assessment['controls_assessed']}")
    if "controls_satisfied" in assessment:
        print(f"  Controls satisfied: {assessment['controls_satisfied']}")
    if "controls_with_gaps" in assessment:
        print(f"  Controls with gaps: {assessment['controls_with_gaps']}")
    if "high_risk_findings" in assessment:
        print(f"  High-risk findings: {assessment['high_risk_findings']}")

    print(f"\n  {assessment.get('summary', '')}\n")


def _handle_stream_event(message: Any) -> None:
    """Extract text content from streaming events."""
    if not isinstance(message, StreamEvent):
        return
    event = message.event
    if (
        event.get("type") == "content_block_delta"
        and event.get("delta", {}).get("type") == "text_delta"
        and event.get("delta", {}).get("text")
    ):
        sys.stdout.write(event["delta"]["text"])
        sys.stdout.flush()


# ---------------------------------------------------------------------------
# REPL loop
# ---------------------------------------------------------------------------


async def _async_input(prompt: str) -> str:
    """Non-blocking input using a thread executor."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: input(prompt))


async def run_interactive_session(inp: GrcAgentInput) -> None:
    print("Running GRC assessment...\n")

    resolved_paths = await resolve_input_paths(inp["input_paths"])
    evidence = await load_evidence(resolved_paths)
    evidence_summaries = build_evidence_summaries(evidence)

    assessment, _assessment_session_id = await _run_assessment_phase(inp, evidence_summaries)
    _display_assessment_summary(assessment)

    print('Type a question, "json" to dump the assessment, "convert oscal-ssp <path>" to convert an SSP, or "exit" to quit.\n')

    model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5-20250929")
    follow_up_prompt = _build_follow_up_prompt(inp, assessment)

    # Track the session ID for the follow-up conversation. The first follow-up
    # starts a new session (with context injected via prompt); subsequent ones
    # resume it so the agent remembers prior Q&A.
    follow_up_session_id = ""

    while True:
        try:
            line = await _async_input("grc> ")
        except (EOFError, KeyboardInterrupt):
            break

        trimmed = line.strip()
        if not trimmed:
            continue
        if trimmed in ("exit", "quit"):
            break

        if trimmed == "json":
            print(json.dumps(assessment, indent=2))
            continue

        # Handle "convert oscal-ssp <path>" as a special command
        if trimmed.startswith("convert "):
            parts = trimmed.split()
            if len(parts) >= 3 and parts[1] == "oscal-ssp":
                from .oscal_convert import convert_to_oscal_ssp, default_output_path, write_oscal_ssp

                convert_path = parts[2]
                output_path = default_output_path(convert_path)
                print(f"Converting {convert_path} to OSCAL SSP format...")
                try:
                    oscal_ssp_result = await convert_to_oscal_ssp(convert_path)
                    await write_oscal_ssp(oscal_ssp_result, output_path)
                    print(f"OSCAL SSP written to {output_path}")
                except Exception as exc:
                    print(f"Conversion failed: {exc}")
            else:
                print("Usage: convert oscal-ssp <path>")
            continue

        # Build the prompt for this follow-up turn. On the first follow-up we
        # include the full assessment context; on subsequent turns we resume the
        # session which already has that context.
        if follow_up_session_id:
            prompt_text = trimmed
        else:
            prompt_text = f"{follow_up_prompt}\n\nUser question: {trimmed}"

        options = ClaudeAgentOptions(
            model=model,
            cli_path=CLAUDE_CODE_EXECUTABLE,
            allowed_tools=list(ALLOWED_TOOLS),
            permission_mode="bypassPermissions",
            max_turns=10,
            mcp_servers=dict(MCP_SERVERS),
            include_partial_messages=True,
            **({"resume": follow_up_session_id} if follow_up_session_id else {}),
        )

        got_text = False
        async for message in query(prompt=prompt_text, options=options):
            # Capture the session ID from the first follow-up for subsequent resumes.
            if (
                not follow_up_session_id
                and hasattr(message, "session_id")
                and message.session_id
            ):
                follow_up_session_id = message.session_id

            _handle_stream_event(message)

            # Also handle the final result text for non-streaming fallback.
            if isinstance(message, ResultMessage) and message.subtype == "success":
                if not got_text and message.result:
                    sys.stdout.write(message.result)
                    sys.stdout.flush()

            if isinstance(message, StreamEvent):
                got_text = True

        # Ensure a newline after streamed output.
        print()

    print("Goodbye.")
