# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A multi-framework GRC (Governance, Risk, and Compliance) assessment agent built with the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). It analyzes SSPs, policies, AI system cards, and evidence artifacts against federal and industry security frameworks (NIST 800-53, FedRAMP, CMMC, EU AI Act, etc.). Dual implementation in TypeScript and Python.

## Build & Run Commands

### TypeScript
```bash
npm install
npm run dev -- --framework "NIST 800-53" --baseline "FedRAMP Moderate" --scope "demo" examples/sample-ssp.md
npm run build            # compile to dist/
npm run typecheck        # type-check without emit
npm run start -- <args>  # run compiled version
```

### Python
```bash
cd python && pip install -e .
grc-agent --framework "NIST 800-53" --baseline "FedRAMP Moderate" --scope "demo" ../examples/sample-ssp.md
```

### OSCAL Conversion
```bash
# SSP → OSCAL SSP (TypeScript)
npm run start -- convert --to oscal-ssp examples/sample-ssp.md
npm run start -- convert --to oscal-ssp --output out.json input.docx

# Framework mappings → OSCAL mapping-collection (TypeScript)
npm run start -- convert --to oscal-mapping data/framework-mappings.json

# Python equivalents
cd python && grc-agent convert --to oscal-ssp ../examples/sample-ssp.md
cd python && grc-agent convert --to oscal-mapping ../data/framework-mappings.json
```

### Dependencies
- `pip install docling` (v2.53.0+) — required for DOCX input. Loads ML models on first run.

## Architecture Overview

```
CLI (src/agent.ts)
  ├─ assess → Orchestrator → MCP Tools + Subagents → Structured JSON
  └─ convert → OSCAL Converter → MCP Tools → OSCAL JSON
```

The agent reads input artifacts, queries framework data via MCP tools, delegates specialist analysis to subagents, and produces schema-validated JSON output. All framework knowledge lives in `data/` as JSON files — tools query this data at runtime rather than hardcoding compliance logic.

### Key File Locations

| Path | Purpose |
|------|---------|
| `src/agent.ts` | CLI entrypoint (assess + convert subcommands) |
| `src/grc-agent.ts` | Assessment orchestration |
| `src/oscal-convert.ts` | OSCAL SSP conversion orchestrator |
| `src/mapping-convert.ts` | OSCAL mapping-collection conversion |
| `src/repl.ts` | Interactive REPL for follow-up questions |
| `src/mcp/grc-tools.ts` | 10 MCP domain tools |
| `src/mcp/grc-server.ts` | MCP server registration |
| `src/subagents/index.ts` | 6 specialist subagents |
| `src/schemas/` | JSON schemas for assessment and OSCAL output |
| `data/` | Framework datasets and crosswalks (JSON) |
| `examples/` | Sample SSPs, policies, AI system cards |

### How to Extend

- **Add framework data**: Drop JSON files into `data/` — tools discover them at runtime.
- **Add MCP tools**: Define new tools in `src/mcp/grc-tools.ts` and register them in `grc-server.ts`.
- **Add subagents**: Register new specialist roles in `src/subagents/index.ts`.

## Troubleshooting

### `CLAUDE_CODE_EXECUTABLE` not found
The SDK needs the Claude CLI path. Find it and export:
```bash
export CLAUDE_CODE_EXECUTABLE="$(command -v claude)"
```
Common paths: `~/.local/bin/claude`, `/usr/local/bin/claude`, `/opt/homebrew/bin/claude`.

### `fedramp-docs-mcp` startup failures
The external FedRAMP docs MCP server (`npx fedramp-docs-mcp`) may fail if the package isn't cached. Disable it:
```bash
export GRC_USE_FEDRAMP_DOCS_MCP=false
```

### Nested Claude Code sessions
If you see errors about nested sessions when the agent spawns subagents:
```bash
unset CLAUDECODE
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | API key for Claude |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-5-20250929` | Model to use |
| `CLAUDE_CODE_EXECUTABLE` | No | auto-detected | Path to Claude CLI binary |
| `GRC_MAX_TURNS` | No | `50` | Cap autonomous turns for faster/cheaper runs |
| `GRC_USE_FEDRAMP_DOCS_MCP` | No | `true` | Set `false` to disable external FedRAMP MCP server |
