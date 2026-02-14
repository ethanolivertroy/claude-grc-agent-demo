import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  aiRiskClassifier,
  baselineSelector,
  cmmcLevelChecker,
  controlLookup,
  evidenceValidator,
  findingGenerator,
  frameworkMapper,
  gapAnalyzer,
  oscalMappingScaffold,
  oscalSspScaffold,
} from "./grc-tools.js";

// 10 domain tools registered as an in-process MCP server (data-provider pattern).
// All framework knowledge lives in data/*.json — tools query it at runtime
// rather than hardcoding compliance logic. Available to the main agent and all subagents.
export const grcMcpServer = createSdkMcpServer({
  name: "grc-tools",
  version: "0.1.0",
  tools: [
    // Retrieve control requirements and assessment objectives from framework data
    tool(
      "control_lookup",
      "Look up a control by ID and return requirements and assessment objectives.",
      {
        framework: z.string().describe("Framework name"),
        control_id: z.string().describe("Control identifier"),
      },
      async (args) => {
        const result = await controlLookup(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }
    ),
    // Find equivalent controls across frameworks (e.g., NIST 800-53 ↔ ISO 27001)
    tool(
      "framework_mapper",
      "Map control IDs between frameworks.",
      {
        source_framework: z.string(),
        control_ids: z.array(z.string()),
      },
      async (args) => {
        const result = await frameworkMapper(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }
    ),
    // Compare implementation description against requirements; heuristic first-pass
    tool(
      "gap_analyzer",
      "Return control requirements alongside the implementation description and heuristic gap hints. The agent should compare semantically.",
      {
        framework: z.string(),
        control_id: z.string(),
        implementation_description: z.string(),
      },
      async (args) => {
        const result = await gapAnalyzer(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }
    ),
    // Read evidence files and check whether they mention the control ID
    tool(
      "evidence_validator",
      "Read evidence files and return excerpts with a heuristic match hint. The agent determines actual sufficiency.",
      {
        framework: z.string(),
        control_id: z.string(),
        evidence_paths: z.array(z.string()),
      },
      async (args) => {
        const result = await evidenceValidator(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }
    ),
    // Produce POA&M entries with federal-standard fields and risk-based timelines
    tool(
      "finding_generator",
      "Create structured POA&M / finding entries with federal-standard fields including milestones, source, deviation tracking, and risk-based remediation timelines.",
      {
        framework: z.string(),
        control_id: z.string(),
        gap_summary: z.string(),
        risk_level: z.enum(["low", "moderate", "high", "critical"]).optional(),
      },
      async (args) => {
        const result = await findingGenerator(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }
    ),
    // Determine highest achievable CMMC level from practice implementation status
    tool(
      "cmmc_level_checker",
      "Assess achievable CMMC level and gaps to next level.",
      {
        implementations: z.array(
          z.object({
            control_id: z.string(),
            status: z.string(),
          })
        ),
      },
      async (args) => {
        const result = await cmmcLevelChecker(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }
    ),
    // Classify AI system under EU AI Act risk tiers and NIST AI RMF functions
    tool(
      "ai_risk_classifier",
      "Classify EU AI Act risk tier and assess against NIST AI RMF.",
      {
        system_description: z.string(),
      },
      async (args) => {
        const result = await aiRiskClassifier(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }
    ),
    // Return OSCAL SSP skeleton structure for agent-driven SSP conversion
    tool(
      "oscal_ssp_scaffold",
      "Return the OSCAL SSP skeleton with required sections, field descriptions, and an implemented-requirement template. Used during SSP-to-OSCAL conversion.",
      {
        security_sensitivity_level: z.string().describe("Impact level (low, moderate, high)"),
        control_count_hint: z.number().optional().describe("Approximate number of controls to convert"),
      },
      async (args) => {
        const result = await oscalSspScaffold(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }
    ),
    // Return OSCAL mapping-collection skeleton for agent-driven mapping conversion
    tool(
      "oscal_mapping_scaffold",
      "Return the OSCAL mapping-collection skeleton with required sections, relationship types, and a map entry template. Used during framework-mapping-to-OSCAL conversion.",
      {
        source_framework: z.string().describe("Source framework name (e.g., 'NIST 800-53')"),
        target_framework: z.string().describe("Target framework name (e.g., 'ISO 27001')"),
        mapping_count_hint: z.number().optional().describe("Approximate number of control pairs to convert"),
      },
      async (args) => {
        const result = await oscalMappingScaffold(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }
    ),
    // Recommend FedRAMP baseline + DoD IL from FIPS 199 impact categorization
    tool(
      "baseline_selector",
      "Recommend FedRAMP baseline and DoD Impact Level using FIPS 199 high-water mark categorization. Accepts C/I/A impact levels and data types.",
      {
        confidentiality_impact: z.enum(["low", "moderate", "high"]).describe("FIPS 199 confidentiality impact level"),
        integrity_impact: z.enum(["low", "moderate", "high"]).describe("FIPS 199 integrity impact level"),
        availability_impact: z.enum(["low", "moderate", "high"]).describe("FIPS 199 availability impact level"),
        data_types: z.array(z.string()).describe("Data types processed (e.g., CUI, PII, PHI, classified)"),
        mission: z.string().describe("Mission description for DoD IL determination"),
        regulatory_requirements: z.array(z.string()),
      },
      async (args) => {
        const result = await baselineSelector(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }
    ),
  ],
});
