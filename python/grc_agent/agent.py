#!/usr/bin/env python3
"""CLI entry point for the GRC agent — Python port of src/agent.ts."""

from __future__ import annotations

import argparse
import json
import sys

import asyncio

from .grc_agent import GrcAgentInput, run_grc_agent


# Uses argparse subparsers to route between assessment and convert workflows.
def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    args = list(argv or sys.argv[1:])

    if args and args[0] == "convert":
        convert_parser = argparse.ArgumentParser(description="Convert SSP to OSCAL format")
        convert_parser.add_argument(
            "--to",
            required=True,
            choices=["oscal-ssp", "oscal-mapping"],
            help="Target format (oscal-ssp or oscal-mapping)",
        )
        convert_parser.add_argument(
            "--output",
            help="Output file path (default: <input-stem>-oscal.json)",
        )
        convert_parser.add_argument("path", help="Input SSP file path")
        parsed = convert_parser.parse_args(args[1:])
        parsed.command = "convert"  # type: ignore[attr-defined]
        return parsed

    parser = argparse.ArgumentParser(
        description="Multi-framework GRC compliance assessment agent"
    )
    parser.add_argument("--framework", help="Framework name (e.g. 'NIST 800-53')")
    parser.add_argument("--baseline", help="Baseline or level (e.g. 'FedRAMP Moderate')")
    parser.add_argument("--scope", help="Assessment scope description")
    parser.add_argument(
        "-i",
        "--interactive",
        action="store_true",
        help="Run assessment then enter interactive follow-up mode",
    )
    parser.add_argument(
        "paths",
        nargs="*",
        default=[],
        help="Evidence file paths or glob patterns",
    )

    parsed = parser.parse_args(args)
    parsed.command = None  # type: ignore[attr-defined]
    return parsed


async def _run_convert(args: argparse.Namespace) -> None:
    target = getattr(args, "to")

    if target == "oscal-mapping":
        from .mapping_convert import (
            convert_to_oscal_mapping,
            default_mapping_output_path,
            write_oscal_mapping,
        )

        output_path = args.output or default_mapping_output_path(args.path)
        print(f"Converting {args.path} to OSCAL mapping-collection format...")
        oscal_mapping = await convert_to_oscal_mapping(args.path)
        await write_oscal_mapping(oscal_mapping, output_path)
        print(f"OSCAL mapping-collection written to {output_path}")
        return

    from .oscal_convert import convert_to_oscal_ssp, default_output_path, write_oscal_ssp

    output_path = args.output or default_output_path(args.path)
    print(f"Converting {args.path} to OSCAL SSP format...")

    oscal_ssp = await convert_to_oscal_ssp(args.path)
    await write_oscal_ssp(oscal_ssp, output_path)

    print(f"OSCAL SSP written to {output_path}")


async def _async_main(args: argparse.Namespace) -> None:
    # Route to convert subcommand
    if args.command == "convert":
        await _run_convert(args)
        return

    # Assessment mode — framework, baseline, and scope are required
    if not args.framework or not args.baseline or not args.scope:
        print(
            "Error: --framework, --baseline, and --scope are required for assessment mode.",
            file=sys.stderr,
        )
        sys.exit(1)

    inp = GrcAgentInput(
        framework=args.framework,
        baseline_or_level=args.baseline,
        scope=args.scope,
        input_paths=args.paths,
    )

    if args.interactive:
        from .repl import run_interactive_session
        await run_interactive_session(inp)
    else:
        result = await run_grc_agent(inp)
        print(json.dumps(result, indent=2))


def main() -> None:
    args = _parse_args()
    try:
        asyncio.run(_async_main(args))
    except Exception as exc:
        print(f"Agent failed: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
