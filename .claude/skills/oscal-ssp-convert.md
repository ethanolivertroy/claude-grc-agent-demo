---
description: Convert SSP documents (DOCX or markdown) to OSCAL SSP JSON. Triggers on "OSCAL", "SSP", "convert", "DOCX to OSCAL", "oscal-ssp-convert".
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
---

# OSCAL SSP Conversion Skill

Convert a System Security Plan document into OSCAL SSP JSON format using the GRC agent's conversion pipeline.

## Workflow

1. **Identify the input file.** If the user did not provide a path, ask them. Verify the file exists with `ls`.

2. **Run the conversion.**
   ```bash
   # TypeScript (primary)
   npm run start -- convert --to oscal-ssp [--output <path>] <input-file>

   # Python alternative
   cd python && grc-agent convert --to oscal-ssp [--output <path>] <input-file>
   ```
   The `--output` flag is optional — defaults to `<stem>-oscal.json` alongside the input.

3. **Validate the output.**
   ```bash
   # Check top-level OSCAL structure
   jq 'keys' <output-file>
   # Verify oscal-version
   jq '."system-security-plan"."metadata"."oscal-version"' <output-file>
   # Count converted controls
   jq '."system-security-plan"."control-implementation"."implemented-requirements" | length' <output-file>
   # List control IDs
   jq '[."system-security-plan"."control-implementation"."implemented-requirements"[]."control-id"] | sort' <output-file>
   ```

4. **Report results** to the user:
   - Input format (DOCX or markdown)
   - Output file path
   - Number of controls converted
   - Any warnings from the conversion (truncation, missing controls)

## Supported Input Formats

- **DOCX** (FedRAMP SSP templates): Uses docling for structured table extraction. Docling parses the two-table-per-control pattern (Control Information Summary + Implementation Statement) and extracts control metadata programmatically. The agent then maps narratives to OSCAL `by-components`/`statements`.
- **Markdown**: Passed directly to the agent for conversion.

## Architecture: Docling Hybrid Extraction (DOCX)

FedRAMP DOCX SSPs use a formulaic two-table pattern per control:

1. **CIS Table** (Nx1, single-column) — header cell contains `"AC-2 Control Summary Information"`, followed by cells for responsible roles, parameters, implementation status (inline checkbox text), and control origination.
2. **Statement Table** (Nx1, single-column) — header cell contains `"AC-2 What is the solution..."`, followed by cells for each control part (`Part a:`, `Part b:`, etc.).

**Hybrid approach**: Docling extracts the table grid and control metadata (ID, status, origination) programmatically from cell positions. The agent handles narrative-to-OSCAL mapping — interpreting shared responsibility, partial implementations, and gap analysis that require judgment.

This is far more token-efficient than raw pandoc markdown conversion, which dumps table borders and checkbox formatting that the agent must parse.

## Notes

- The conversion is agent-driven: it calls `oscal_ssp_scaffold` and `control_lookup` MCP tools internally.
- `ANTHROPIC_API_KEY` must be set.
- Docling loads ML models on first run — expect a one-time startup delay.
- Large documents are truncated at ~200K chars to fit context limits.
