/**
 * Interactive REPL for GRC assessments.
 *
 * Two-phase architecture:
 *   Phase 1 — Run the full assessment with schema-validated JSON output.
 *   Phase 2 — Enter a readline loop where follow-up questions go through a
 *             new query() call with no outputFormat constraint (free-form text),
 *             resuming the same session so the agent retains conversation context.
 */

import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  type GrcAgentInput,
  type GrcAssessment,
  type EvidenceSummary,
  CLAUDE_CODE_EXECUTABLE,
  resolveInputPaths,
  loadEvidence,
  buildEvidenceSummaries,
  buildPrompt,
  buildSubagentDefinitions,
  GRC_ALLOWED_TOOLS,
  GRC_MCP_SERVERS,
} from "./grc-agent.js";
import { grcAssessmentSchema } from "./schemas/grc-schema.js";

// ---------------------------------------------------------------------------
// Assessment phase — identical pipeline to runGrcAgent, but captures the
// session_id so we can resume it for follow-up queries.
// ---------------------------------------------------------------------------

type AssessmentResult = {
  assessment: GrcAssessment;
  sessionId: string;
};

async function runAssessmentPhase(
  input: GrcAgentInput,
  evidenceSummaries: EvidenceSummary[]
): Promise<AssessmentResult> {
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";
  const agents = buildSubagentDefinitions();
  const prompt = buildPrompt(input, evidenceSummaries);
  const now = new Date().toISOString();

  let assessment: GrcAssessment | null = null;
  let sessionId = "";

  for await (const message of query({
    prompt,
    options: {
      model,
      allowedTools: [...GRC_ALLOWED_TOOLS],
      permissionMode: "bypassPermissions",
      maxTurns: 50,
      pathToClaudeCodeExecutable: CLAUDE_CODE_EXECUTABLE,
      outputFormat: {
        type: "json_schema",
        schema: grcAssessmentSchema,
      },
      mcpServers: { ...GRC_MCP_SERVERS },
      agents,
    },
  })) {
    // Capture session_id from the first message that carries one.
    if (!sessionId && "session_id" in message && message.session_id) {
      sessionId = message.session_id;
    }
    if (message.type === "result" && message.subtype === "success") {
      assessment = message.structured_output as GrcAssessment;
    }
  }

  if (!assessment) {
    assessment = {
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

  return { assessment, sessionId };
}

// ---------------------------------------------------------------------------
// Follow-up prompt — gives the agent full assessment context and instructs
// it to answer in plain text using the same MCP tools.
// ---------------------------------------------------------------------------

function buildFollowUpPrompt(
  input: GrcAgentInput,
  assessment: GrcAssessment
): string {
  return [
    "You are a GRC assessment assistant. You completed the following assessment:",
    "",
    "```json",
    JSON.stringify(assessment, null, 2),
    "```",
    "",
    `Framework: ${input.framework}`,
    `Baseline/Level: ${input.baselineOrLevel}`,
    `Scope: ${input.scope}`,
    "",
    "Answer follow-up questions about this assessment using your MCP tools",
    "(control_lookup, gap_analyzer, evidence_validator, etc.) when helpful.",
    "Respond in clear, readable plain text unless the user explicitly requests JSON.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function displayAssessmentSummary(assessment: GrcAssessment): void {
  const meta = assessment.assessment_metadata;
  const pct = assessment.overall_grc_percentage;

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║         GRC Assessment Complete          ║");
  console.log("╚══════════════════════════════════════════╝\n");
  console.log(`  Framework:          ${meta.framework}`);
  console.log(`  Baseline/Level:     ${meta.baseline_or_level}`);
  console.log(`  Scope:              ${meta.scope}`);
  console.log(`  Compliance:         ${pct}%`);

  if (assessment.controls_assessed != null) {
    console.log(`  Controls assessed:  ${assessment.controls_assessed}`);
  }
  if (assessment.controls_satisfied != null) {
    console.log(`  Controls satisfied: ${assessment.controls_satisfied}`);
  }
  if (assessment.controls_with_gaps != null) {
    console.log(`  Controls with gaps: ${assessment.controls_with_gaps}`);
  }
  if (assessment.high_risk_findings != null) {
    console.log(`  High-risk findings: ${assessment.high_risk_findings}`);
  }

  console.log(`\n  ${assessment.summary}\n`);
}

// Extract text content from streaming events. Only writes actual text deltas
// to avoid cluttering output with tool-use or thinking events.
function handleStreamEvent(message: SDKMessage): void {
  if (message.type !== "stream_event") return;
  const event = (message as { event: { type: string; delta?: { type: string; text?: string } } }).event;
  if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
    process.stdout.write(event.delta.text);
  }
}

// ---------------------------------------------------------------------------
// REPL loop
// ---------------------------------------------------------------------------

export async function runInteractiveSession(
  input: GrcAgentInput
): Promise<void> {
  console.log("Running GRC assessment...\n");

  const resolvedPaths = await resolveInputPaths(input.inputPaths);
  const evidence = await loadEvidence(resolvedPaths);
  const evidenceSummaries = buildEvidenceSummaries(evidence);

  const { assessment, sessionId } = await runAssessmentPhase(input, evidenceSummaries);
  displayAssessmentSummary(assessment);

  console.log('Type a question, "json" to dump the assessment, "convert oscal-ssp <path>" to convert an SSP, or "exit" to quit.\n');

  const rl: Interface = createInterface({ input: stdin, output: stdout });
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";
  const followUpPrompt = buildFollowUpPrompt(input, assessment);

  // Track the session ID for the follow-up conversation. The first follow-up
  // starts a new session (with context injected via prompt); subsequent ones
  // resume it so the agent remembers prior Q&A.
  let followUpSessionId = "";

  try {
    while (true) {
      let line: string;
      try {
        line = await rl.question("grc> ");
      } catch {
        // readline closed (Ctrl-D)
        break;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "exit" || trimmed === "quit") break;

      if (trimmed === "json") {
        console.log(JSON.stringify(assessment, null, 2));
        continue;
      }

      // Handle "convert oscal-ssp <path>" as a special command
      if (trimmed.startsWith("convert ")) {
        const parts = trimmed.split(/\s+/);
        if (parts[1] === "oscal-ssp" && parts[2]) {
          const { convertToOscalSsp, defaultOutputPath, writeOscalSsp } = await import(
            "./oscal-convert.js"
          );
          const convertPath = parts[2];
          const outputPath = defaultOutputPath(convertPath);
          console.log(`Converting ${convertPath} to OSCAL SSP format...`);
          try {
            const oscalSsp = await convertToOscalSsp(convertPath);
            await writeOscalSsp(oscalSsp, outputPath);
            console.log(`OSCAL SSP written to ${outputPath}`);
          } catch (err) {
            console.error(`Conversion failed: ${err instanceof Error ? err.message : err}`);
          }
        } else {
          console.log('Usage: convert oscal-ssp <path>');
        }
        continue;
      }

      // Build the prompt for this follow-up turn. On the first follow-up we
      // include the full assessment context; on subsequent turns we resume the
      // session which already has that context.
      const prompt = followUpSessionId
        ? trimmed
        : `${followUpPrompt}\n\nUser question: ${trimmed}`;

      const resumeOptions: Record<string, unknown> = followUpSessionId
        ? { resume: followUpSessionId }
        : {};

      let gotText = false;
      for await (const message of query({
        prompt,
        options: {
        model,
        allowedTools: [...GRC_ALLOWED_TOOLS],
        permissionMode: "bypassPermissions",
        maxTurns: 10,
        pathToClaudeCodeExecutable: CLAUDE_CODE_EXECUTABLE,
        mcpServers: { ...GRC_MCP_SERVERS },
        includePartialMessages: true,
          ...resumeOptions,
        },
      })) {
        // Capture the session ID from the first follow-up for subsequent resumes.
        if (!followUpSessionId && "session_id" in message && message.session_id) {
          followUpSessionId = message.session_id;
        }

        handleStreamEvent(message);

        // Also handle the final result text for non-streaming fallback.
        if (message.type === "result" && message.subtype === "success") {
          if (!gotText && message.result) {
            process.stdout.write(message.result);
          }
        }

        if (message.type === "stream_event") {
          gotText = true;
        }
      }

      // Ensure a newline after streamed output.
      console.log();
    }
  } finally {
    rl.close();
  }

  console.log("Goodbye.");
}
