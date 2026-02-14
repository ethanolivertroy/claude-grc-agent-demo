// JSON Schema for structured assessment output. The agent's final response must
// conform to this schema. Structure: assessment_metadata + findings[] + summary.
//
// Required fields: assessment_metadata, findings, summary, overall_grc_percentage.
// Optional fields: CMMC level/gaps (CMMC only), AI risk tier/maturity (AI frameworks only).
// POA&M entries follow FedRAMP POA&M template standards (weakness, milestones, source, status).
export const grcAssessmentSchema = {
  type: "object",
  properties: {
    assessment_metadata: {
      type: "object",
      properties: {
        framework: { type: "string" },
        framework_version: { type: "string" },
        baseline_or_level: { type: "string" },
        assessment_date: { type: "string" },
        scope: { type: "string" },
        conmon: {
          type: "object",
          properties: {
            last_full_assessment_date: { type: "string" },
            controls_assessed_this_period: { type: "number" },
            total_controls_in_baseline: { type: "number" },
            annual_assessment_coverage: { type: "number" },
            open_scan_findings: { type: "number" },
            significant_change_flag: { type: "boolean" },
            next_annual_assessment_due: { type: "string" },
          },
        },
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          control_id: { type: "string" },
          control_name: { type: "string" },
          framework: { type: "string" },
          status: {
            type: "string",
            enum: ["satisfied", "partially_satisfied", "not_satisfied", "not_applicable"],
          },
          implementation_status: {
            type: "string",
            enum: [
              "implemented",
              "partially_implemented",
              "planned",
              "alternative",
              "not_applicable",
            ],
          },
          control_origination: {
            type: "string",
            enum: [
              "service_provider_corporate",
              "service_provider_system",
              "customer_responsibility",
              "shared",
              "inherited",
            ],
          },
          inherited_from: { type: "string" },
          gap_description: { type: "string" },
          evidence_reviewed: { type: "array", items: { type: "string" } },
          recommendation: { type: "string" },
          risk_level: { type: "string", enum: ["low", "moderate", "high", "critical"] },
          poam_required: { type: "boolean" },
          poam_entry: {
            type: "object",
            properties: {
              weakness_description: { type: "string" },
              point_of_contact: { type: "string" },
              resources_required: { type: "string" },
              scheduled_completion_date: { type: "string" },
              milestones: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    description: { type: "string" },
                    due_date: { type: "string" },
                  },
                },
              },
              source: {
                type: "string",
                enum: ["assessment", "scan", "conmon", "incident"],
              },
              status: {
                type: "string",
                enum: ["open", "closed", "risk_accepted"],
              },
              deviation_request: { type: "boolean" },
              original_detection_date: { type: "string" },
              vendor_dependency: { type: "boolean" },
              false_positive: { type: "boolean" },
            },
          },
          related_controls: {
            type: "array",
            items: {
              type: "object",
              properties: {
                framework: { type: "string" },
                control_id: { type: "string" },
              },
            },
          },
          last_assessed_date: { type: "string" },
          assessment_frequency: { type: "string" },
          ai_risk_category: {
            type: "string",
            enum: ["minimal", "limited", "high", "unacceptable"],
          },
          ai_rmf_function: {
            type: "string",
            enum: ["govern", "map", "measure", "manage"],
          },
        },
        required: ["control_id", "framework", "status", "risk_level"],
      },
    },
    summary: { type: "string" },
    controls_assessed: { type: "number" },
    controls_satisfied: { type: "number" },
    controls_with_gaps: { type: "number" },
    overall_grc_percentage: { type: "number" },
    high_risk_findings: { type: "number" },
    cmmc_level_achievable: { type: "string", enum: ["Level 1", "Level 2", "Level 3", "None"] },
    cmmc_gaps_to_next_level: { type: "number" },
    ai_risk_tier: { type: "string" },
    ai_rmf_maturity: { type: "object" },
  },
  required: ["assessment_metadata", "findings", "summary", "overall_grc_percentage"],
} as const;
