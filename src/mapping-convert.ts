/**
 * OSCAL mapping-collection conversion orchestrator.
 *
 * Reads a framework-mappings JSON file and converts it to an OSCAL
 * mapping-collection JSON document using an agent-driven approach. The agent
 * understands mapping structure through the oscal_mapping_scaffold tool and
 * infers relationship types (equivalent-to, subset-of, etc.) from context.
 *
 * This parallels the OSCAL SSP conversion workflow but targets the Control
 * Mapping model introduced in OSCAL 1.2.0.
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { oscalMappingSchema } from "./schemas/oscal-mapping-schema.js";
import { CLAUDE_CODE_EXECUTABLE, GRC_ALLOWED_TOOLS, GRC_MCP_SERVERS } from "./grc-agent.js";

export type OscalMapping = Record<string, unknown>;

// Framework mapping file structure (matches data/framework-mappings.json)
type MappingEntry = {
  source: string;
  target: string;
  mappings: Array<{ source_control_id: string; target_control_id: string }>;
};

type MappingFile = {
  mappings: MappingEntry[];
};

function buildMappingPrompt(data: MappingFile, inputPath: string): string {
  const totalMaps = data.mappings.reduce((n, g) => n + g.mappings.length, 0);

  const header = [
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
    `File: ${basename(inputPath)}`,
    `Total mapping groups: ${data.mappings.length}`,
    `Total control pairs: ${totalMaps}`,
    "",
  ];

  const groupBlocks: string[] = [];
  for (const group of data.mappings) {
    const lines = [`### ${group.source} → ${group.target}`];
    for (const pair of group.mappings) {
      lines.push(`- ${pair.source_control_id} → ${pair.target_control_id}`);
    }
    groupBlocks.push(lines.join("\n"));
  }

  return [
    ...header,
    ...groupBlocks,
    "",
    "## Output",
    "",
    "Return valid OSCAL mapping-collection JSON matching the provided schema.",
  ].join("\n");
}

export async function convertToOscalMapping(inputPath: string): Promise<OscalMapping> {
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";

  const raw = await readFile(inputPath, "utf8");
  const data: MappingFile = JSON.parse(raw);
  const prompt = buildMappingPrompt(data, inputPath);

  let oscalMapping: OscalMapping | null = null;

  for await (const message of query({
    prompt,
    options: {
      model,
      allowedTools: [...GRC_ALLOWED_TOOLS],
      permissionMode: "bypassPermissions",
      maxTurns: 15,
      pathToClaudeCodeExecutable: CLAUDE_CODE_EXECUTABLE,
      outputFormat: {
        type: "json_schema",
        schema: oscalMappingSchema,
      },
      mcpServers: { ...GRC_MCP_SERVERS },
    },
  })) {
    if (message.type === "result" && message.subtype === "success") {
      oscalMapping = message.structured_output as OscalMapping;
    }
  }

  if (!oscalMapping) {
    throw new Error("OSCAL mapping conversion did not produce structured output.");
  }

  return oscalMapping;
}

// Derive the default output path: framework-mappings.json → framework-mappings-oscal.json
export function defaultMappingOutputPath(inputPath: string): string {
  const ext = extname(inputPath);
  const stem = basename(inputPath, ext);
  const dir = inputPath.slice(0, inputPath.length - basename(inputPath).length);
  return `${dir}${stem}-oscal.json`;
}

export async function writeOscalMapping(
  oscalMapping: OscalMapping,
  outputPath: string
): Promise<void> {
  await writeFile(outputPath, JSON.stringify(oscalMapping, null, 2) + "\n", "utf8");
}
