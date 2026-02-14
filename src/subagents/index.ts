export type SubagentConfig = {
  name: string;
  model: string;
  purpose: string;
};

// Six specialist subagents, each with a focused role and tool set.
// Five use Sonnet for complex analytical work (control assessment, evidence review,
// gap analysis, CMMC level determination, AI governance classification).
// Framework-mapper uses Haiku — it performs structured lookups, not deep analysis.
export const subagents: SubagentConfig[] = [
  {
    name: "control-assessor",
    model: "sonnet",
    purpose:
      "Specialist in control implementation review. Assesses individual controls at the " +
      "enhancement level, determines implementation status and control origination, validates " +
      "evidence sufficiency. Use for detailed control-by-control analysis when baselines have " +
      "20+ controls or when enhancement-level depth is needed.",
  },
  {
    name: "evidence-reviewer",
    model: "sonnet",
    purpose:
      "Analyzes evidence artifacts for sufficiency, validity, and currency. Reviews policy " +
      "documents, SSP narratives, scan results, and configuration exports against control " +
      "requirements. Use when multiple evidence files need cross-referencing or when evidence " +
      "quality is uncertain.",
  },
  {
    name: "gap-reporter",
    model: "sonnet",
    purpose:
      "Generates detailed gap analysis with remediation guidance and POA&M entries. Identifies " +
      "missing controls, partial implementations, and evidence gaps. Produces risk-ranked " +
      "findings with actionable recommendations. Use after control assessment to synthesize " +
      "gaps into a remediation roadmap.",
  },
  {
    name: "cmmc-specialist",
    model: "sonnet",
    purpose:
      "CMMC-specific assessment logic including level determination, practice-to-control " +
      "mapping, and DIBCAC readiness evaluation. Handles CMMC 2.0 Level 1 (self-assessment), " +
      "Level 2 (C3PAO), and Level 3 (DIBCAC) requirements. Use for any CMMC assessment or " +
      "when CMMC level achievability needs determination.",
  },
  {
    name: "ai-governance-specialist",
    model: "sonnet",
    purpose:
      "Specialist in AI governance frameworks: NIST AI RMF, EU AI Act, and ISO 42001. " +
      "Classifies AI system risk tiers, maps to regulatory obligations, assesses AI RMF " +
      "function maturity (Govern/Map/Measure/Manage). Use for any assessment involving AI " +
      "systems or when ai_risk_category fields need determination.",
  },
  {
    name: "framework-mapper",
    model: "haiku",
    purpose:
      "Cross-framework control mapping and harmonization analysis. Maps controls between " +
      "NIST 800-53, FedRAMP, CMMC, ISO 27001, and AI governance frameworks. Identifies " +
      "overlapping requirements to reduce duplicate assessment effort. Use when assessments " +
      "span multiple frameworks or when related_controls fields need population.",
  },
];
