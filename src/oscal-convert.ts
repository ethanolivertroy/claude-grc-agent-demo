/**
 * OSCAL SSP conversion orchestrator.
 *
 * Reads an SSP document (markdown or DOCX) and converts it to OSCAL SSP JSON
 * using an agent-driven approach. The agent understands SSP structure through
 * the oscal_ssp_scaffold tool and OSCAL skill knowledge, then maps narratives
 * to OSCAL's implemented-requirements structure.
 *
 * DOCX input uses docling for structured table extraction — FedRAMP's
 * two-table-per-control pattern is parsed programmatically, and only
 * narrative text is sent to the agent.
 *
 * This is a separate workflow from the assessment pipeline — it produces an
 * OSCAL artifact, not assessment findings.
 */

import { execSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { oscalSspSchema } from "./schemas/oscal-ssp-schema.js";
import { CLAUDE_CODE_EXECUTABLE, GRC_ALLOWED_TOOLS, GRC_MCP_SERVERS } from "./grc-agent.js";

export type OscalSsp = Record<string, unknown>;

// ~200K chars ≈ ~50K tokens, leaving room for prompt + tool calls + output.
const MAX_CONTENT_CHARS = 200_000;

// ---------------------------------------------------------------------------
// Docling structured extraction types
// ---------------------------------------------------------------------------

// Matches "AC-2 Control Summary Information" (with optional enhancement number)
const CIS_HEADER_RE = /^([A-Z]{2}-\d+(?:\(\d+\))?)\s+Control Summary Information/;
// Matches "AC-2 What is the solution..."
const STATEMENT_HEADER_RE = /^([A-Z]{2}-\d+(?:\(\d+\))?)\s+What is the solution/;
// Matches "Part a:" or "Part (a):"
const PART_LABEL_RE = /^Part\s+\(?([a-z])\)?:/i;

type ExtractedControl = {
  controlId: string;
  status: string;
  origination: string;
  roles: string;
  params: Record<string, string>;
  parts: Record<string, string>;
  rawNarrative: string;
};

type DoclingCell = {
  text: string;
  start_row_offset_idx: number;
  end_row_offset_idx: number;
  start_col_offset_idx: number;
  end_col_offset_idx: number;
};

type DoclingTableData = {
  table_cells: DoclingCell[];
  num_rows: number;
  num_cols: number;
};

type DoclingTable = {
  data: DoclingTableData;
  label: string;
};

type DoclingDocument = {
  tables: DoclingTable[];
  name: string;
};

// ---------------------------------------------------------------------------
// CIS table parsing — single-column tables with inline metadata
//
// FedRAMP DOCX tables are Nx1 (single column). Metadata is embedded in each
// cell's text content, not across columns. The grid reconstruction from the
// original plan isn't needed — we iterate table_cells directly.
// ---------------------------------------------------------------------------

function getCellTexts(table: DoclingTable): string[] {
  return table.data.table_cells.map((c) => c.text);
}

function parseCisTable(cellTexts: string[]): {
  controlId: string;
  status: string;
  origination: string;
  roles: string;
  params: Record<string, string>;
} | null {
  if (cellTexts.length === 0) return null;

  const headerMatch = cellTexts[0].match(CIS_HEADER_RE);
  if (!headerMatch) return null;

  const controlId = headerMatch[1].toLowerCase();
  let status = "";
  let origination = "";
  let roles = "";
  const params: Record<string, string> = {};

  for (const text of cellTexts) {
    const trimmed = text.trim();

    if (trimmed.startsWith("Responsible Role:")) {
      roles = trimmed.replace("Responsible Role:", "").trim();
    } else if (trimmed.startsWith("Implementation Status")) {
      // Template has all options listed — no selection in blank templates.
      // When filled in, checked items may be marked differently.
      // Store the raw text for agent interpretation.
      status = trimmed;
    } else if (trimmed.startsWith("Control Origination")) {
      origination = trimmed;
    } else if (trimmed.startsWith("Parameter ")) {
      // "Parameter AC-2(c): <value>" — extract the parameter ID and value
      const paramMatch = trimmed.match(/^Parameter\s+(\S+?):\s*(.*)/);
      if (paramMatch) {
        params[paramMatch[1]] = paramMatch[2];
      }
    }
  }

  return { controlId, status, origination, roles, params };
}

// ---------------------------------------------------------------------------
// Statement table parsing — "What is the solution" tables
// ---------------------------------------------------------------------------

function parseStatementTable(cellTexts: string[]): {
  parts: Record<string, string>;
  rawNarrative: string;
} {
  const parts: Record<string, string> = {};
  const lines: string[] = [];

  // Skip the header row ("AC-2 What is the solution...")
  for (let i = 1; i < cellTexts.length; i++) {
    const text = cellTexts[i].trim();
    if (!text) continue;

    const match = text.match(PART_LABEL_RE);
    if (match) {
      const letter = match[1].toLowerCase();
      parts[letter] = text.replace(PART_LABEL_RE, "").trim();
    }
    lines.push(text);
  }

  return { parts, rawNarrative: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Docling DOCX extraction pipeline
// ---------------------------------------------------------------------------

async function extractDocxControls(inputPath: string): Promise<ExtractedControl[]> {
  const tmpDir = await mkdtemp(join(tmpdir(), "grc-docling-"));

  try {
    execSync(`docling --from docx --to json --output "${tmpDir}" "${inputPath}"`, {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Docling names the output after the input stem
    const stem = basename(inputPath, extname(inputPath));
    const jsonPath = join(tmpDir, `${stem}.json`);
    const raw = await readFile(jsonPath, "utf8");
    const doc: DoclingDocument = JSON.parse(raw);

    const controls: ExtractedControl[] = [];
    const tables = doc.tables;

    for (let i = 0; i < tables.length; i++) {
      const cellTexts = getCellTexts(tables[i]);
      const cis = parseCisTable(cellTexts);

      if (!cis) continue;

      // Pair with the next table if it's the matching statement table
      let parts: Record<string, string> = {};
      let rawNarrative = "";
      if (i + 1 < tables.length) {
        const nextTexts = getCellTexts(tables[i + 1]);
        if (nextTexts.length > 0 && STATEMENT_HEADER_RE.test(nextTexts[0])) {
          const narrative = parseStatementTable(nextTexts);
          parts = narrative.parts;
          rawNarrative = narrative.rawNarrative;
          i++; // skip statement table
        }
      }

      controls.push({
        controlId: cis.controlId,
        status: cis.status,
        origination: cis.origination,
        roles: cis.roles,
        params: cis.params,
        parts,
        rawNarrative,
      });
    }

    return controls;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Structured prompt for agent — pre-parsed control data
// ---------------------------------------------------------------------------

function buildStructuredPrompt(controls: ExtractedControl[], inputPath: string): string {
  const header = [
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
    `Source: ${basename(inputPath)}`,
    `Total controls: ${controls.length}`,
    "",
  ];

  const controlBlocks: string[] = [];
  for (const ctrl of controls) {
    const lines = [`### ${ctrl.controlId}`];
    if (ctrl.status) lines.push(`- Status: ${ctrl.status}`);
    if (ctrl.origination) lines.push(`- Origination: ${ctrl.origination}`);
    if (ctrl.roles) lines.push(`- Roles: ${ctrl.roles}`);

    const paramKeys = Object.keys(ctrl.params);
    if (paramKeys.length > 0) {
      for (const key of paramKeys.sort()) {
        const val = ctrl.params[key];
        if (val) lines.push(`- ${key}: ${val}`);
      }
    }

    const partKeys = Object.keys(ctrl.parts);
    if (partKeys.length > 0) {
      for (const letter of partKeys.sort()) {
        lines.push(`- Part (${letter}): ${ctrl.parts[letter]}`);
      }
    } else if (ctrl.rawNarrative) {
      lines.push(`- Narrative: ${ctrl.rawNarrative}`);
    }

    controlBlocks.push(lines.join("\n"));
  }

  return [
    ...header,
    ...controlBlocks,
    "",
    "## Output",
    "",
    "Return valid OSCAL SSP JSON matching the provided schema.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Markdown input — read directly (no conversion needed)
// ---------------------------------------------------------------------------

async function readMarkdownSsp(inputPath: string): Promise<string> {
  let content = await readFile(inputPath, "utf8");

  if (content.length > MAX_CONTENT_CHARS) {
    const originalKb = Math.round(content.length / 1024);
    const truncatedKb = Math.round(MAX_CONTENT_CHARS / 1024);
    console.error(
      `Warning: Input document is ${originalKb} KB — truncating to ${truncatedKb} KB ` +
        `to fit within context limits. Some controls near the end may be omitted.`
    );
    content = content.slice(0, MAX_CONTENT_CHARS);
  }

  return content;
}

function buildConversionPrompt(sspContent: string, inputPath: string): string {
  return [
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
    `File: ${basename(inputPath)}`,
    "",
    "```",
    sspContent,
    "```",
    "",
    "## Output",
    "",
    "Return valid OSCAL SSP JSON matching the provided schema.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main conversion entry point
// ---------------------------------------------------------------------------

export async function convertToOscalSsp(inputPath: string): Promise<OscalSsp> {
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";
  const ext = extname(inputPath).toLowerCase();

  let prompt: string;

  if (ext === ".docx") {
    const controls = await extractDocxControls(inputPath);
    if (controls.length === 0) {
      console.error(
        "Warning: No controls extracted from DOCX tables. " +
          "Falling back to plain text extraction."
      );
      // Fallback: use docling markdown export instead
      const tmpDir = await mkdtemp(join(tmpdir(), "grc-docling-"));
      try {
        execSync(`docling --from docx --to md --output "${tmpDir}" "${inputPath}"`, {
          encoding: "utf8",
          maxBuffer: 50 * 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const stem = basename(inputPath, extname(inputPath));
        let content = await readFile(join(tmpDir, `${stem}.md`), "utf8");
        if (content.length > MAX_CONTENT_CHARS) {
          content = content.slice(0, MAX_CONTENT_CHARS);
        }
        prompt = buildConversionPrompt(content, inputPath);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    } else {
      prompt = buildStructuredPrompt(controls, inputPath);
    }
  } else {
    const sspContent = await readMarkdownSsp(inputPath);
    prompt = buildConversionPrompt(sspContent, inputPath);
  }

  let oscalSsp: OscalSsp | null = null;

  for await (const message of query({
    prompt,
    options: {
      model,
      allowedTools: [...GRC_ALLOWED_TOOLS],
      permissionMode: "bypassPermissions",
      maxTurns: 30,
      pathToClaudeCodeExecutable: CLAUDE_CODE_EXECUTABLE,
      outputFormat: {
        type: "json_schema",
        schema: oscalSspSchema,
      },
      mcpServers: { ...GRC_MCP_SERVERS },
    },
  })) {
    if (message.type === "result" && message.subtype === "success") {
      oscalSsp = message.structured_output as OscalSsp;
    }
  }

  if (!oscalSsp) {
    throw new Error("OSCAL SSP conversion did not produce structured output.");
  }

  return oscalSsp;
}

// Derive the default output path: sample-ssp.md → sample-ssp-oscal.json
export function defaultOutputPath(inputPath: string): string {
  const ext = extname(inputPath);
  const stem = basename(inputPath, ext);
  const dir = inputPath.slice(0, inputPath.length - basename(inputPath).length);
  return `${dir}${stem}-oscal.json`;
}

export async function writeOscalSsp(
  oscalSsp: OscalSsp,
  outputPath: string
): Promise<void> {
  await writeFile(outputPath, JSON.stringify(oscalSsp, null, 2) + "\n", "utf8");
}
