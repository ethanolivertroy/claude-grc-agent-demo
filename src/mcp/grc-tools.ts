import { readFile } from "node:fs/promises";
import { loadFrameworkData } from "../data/framework-data.js";
import { loadFrameworkMappings } from "../mappings/framework-mapper.js";

export type ControlLookupRequest = {
  framework: string;
  control_id: string;
};

export type ControlLookupResponse = {
  framework: string;
  control_id: string;
  control_name?: string;
  requirements?: string[];
  assessment_objectives?: string[];
};

export type FrameworkMapperRequest = {
  source_framework: string;
  control_ids: string[];
};

export type FrameworkMapperResponse = {
  source_framework: string;
  mappings: Array<{
    source_control_id: string;
    related: Array<{ framework: string; control_id: string }>;
  }>;
};

export type GapAnalyzerRequest = {
  framework: string;
  control_id: string;
  implementation_description: string;
};

export type GapAnalyzerResponse = {
  control_id: string;
  requirements: string[];
  implementation_description: string;
  heuristic_gaps: string[];
};

export type EvidenceValidatorRequest = {
  framework: string;
  control_id: string;
  evidence_paths: string[];
};

export type EvidenceFileResult = {
  path: string;
  readable: boolean;
  excerpt: string;
  heuristic_match: boolean;
};

export type EvidenceValidatorResponse = {
  control_id: string;
  file_results: EvidenceFileResult[];
};

export type FindingGeneratorRequest = {
  framework: string;
  control_id: string;
  gap_summary: string;
  risk_level?: "low" | "moderate" | "high" | "critical";
};

export type PoamEntryOutput = {
  weakness_description: string;
  point_of_contact: string;
  resources_required: string;
  scheduled_completion_date: string;
  milestones: Array<{ description: string; due_date: string }>;
  source: "assessment" | "scan" | "conmon" | "incident";
  status: "open" | "closed" | "risk_accepted";
  deviation_request: boolean;
  original_detection_date: string;
  vendor_dependency: boolean;
  false_positive: boolean;
};

export type FindingGeneratorResponse = {
  finding_id: string;
  poam_required: boolean;
  poam_entry: PoamEntryOutput;
  remediation_steps: string[];
};

export type CmmcLevelCheckerRequest = {
  implementations: Array<{ control_id: string; status: string }>;
};

export type CmmcLevelCheckerResponse = {
  level: "Level 1" | "Level 2" | "Level 3" | "None";
  gaps_to_next_level: number;
};

export type AiRiskClassifierRequest = {
  system_description: string;
};

export type AiRiskClassifierResponse = {
  eu_ai_act_risk_tier: "minimal" | "limited" | "high" | "unacceptable";
  nist_ai_rmf_function?: "govern" | "map" | "measure" | "manage";
};

export type BaselineSelectorRequest = {
  confidentiality_impact: "low" | "moderate" | "high";
  integrity_impact: "low" | "moderate" | "high";
  availability_impact: "low" | "moderate" | "high";
  data_types: string[];
  mission: string;
  regulatory_requirements: string[];
};

export type BaselineSelectorResponse = {
  fedramp_baseline: string;
  dod_impact_level?: string;
  fips_199_categorization: {
    confidentiality: string;
    integrity: string;
    availability: string;
    overall: string;
  };
  rationale: string[];
};

const frameworkFiles: Record<string, string> = {
  "NIST 800-53": "nist-800-53-r5.json",
  "NIST 800-171": "nist-800-171-r2.json",
  CMMC: "cmmc-2.0-practices.json",
  "NIST AI RMF": "nist-ai-rmf.json",
  "ISO 42001": "iso-42001.json",
  "EU AI Act": "eu-ai-act.json",
  "ISO 27001": "iso-27001.json",
  "SOC 2": "soc2.json",
  "CSA CCM": "csa-ccm.json",
  "NIST Privacy Framework": "nist-privacy-framework.json",
  GDPR: "gdpr.json",
  CCPA: "ccpa.json",
  "OECD AI Principles": "oecd-ai-principles.json",
  "White House EO 14110": "white-house-eo-14110.json",
  "DFARS 252.204-7012": "dfars-252.204-7012.json",
  FISMA: "fisma.json",
  FedRAMP: "fedramp-baselines.json",
};

// Case-insensitive matching lets users pass "ac-1" or "AC-1" interchangeably
function normalize(text: string): string {
  return text.trim().toLowerCase();
}

// Framework-specific search: most frameworks use a flat controls array, but
// CMMC nests practices under levels, AI RMF nests categories under functions,
// and FedRAMP uses a baselines array. Each branch handles one structure.
async function findControl(framework: string, controlId: string) {
  const fileName = frameworkFiles[framework];
  if (!fileName) return null;
  const data = await loadFrameworkData(fileName);
  const target = normalize(controlId);

  if (Array.isArray(data.controls)) {
    return data.controls.find(
      (control: any) => normalize(control.id) === target
    );
  }

  if (framework === "CMMC" && Array.isArray(data.levels)) {
    for (const level of data.levels as any[]) {
      const practice = (level.practices ?? []).find(
        (item: any) => normalize(item.id) === target
      );
      if (practice) {
        return { ...practice, level: level.level };
      }
    }
  }

  if (framework === "NIST AI RMF" && Array.isArray(data.functions)) {
    for (const func of data.functions as any[]) {
      const category = (func.categories ?? []).find(
        (item: any) => normalize(item.id) === target
      );
      if (category) {
        return { ...category, function: func.id };
      }
    }
  }

  if (framework === "FedRAMP" && Array.isArray((data as any).baselines)) {
    const baseline = (data as any).baselines.find(
      (item: any) => normalize(item.baseline) === target
    );
    if (baseline) {
      return {
        id: baseline.baseline,
        name: `FedRAMP ${baseline.baseline} baseline`,
        requirements: [baseline.description],
      };
    }
  }

  return null;
}

export async function controlLookup(
  request: ControlLookupRequest
): Promise<ControlLookupResponse> {
  const control = await findControl(request.framework, request.control_id);
  if (!control) {
    return {
      framework: request.framework,
      control_id: request.control_id,
      control_name: undefined,
      requirements: [],
      assessment_objectives: [],
    };
  }
  return {
    framework: request.framework,
    control_id: control.id,
    control_name: control.name,
    requirements: control.requirements ?? [],
    assessment_objectives: control.assessment_objectives ?? [],
  };
}

export async function frameworkMapper(
  request: FrameworkMapperRequest
): Promise<FrameworkMapperResponse> {
  const mappingsFile = await loadFrameworkMappings();
  const related = mappingsFile.mappings.filter(
    (entry) => entry.source === request.source_framework
  );

  return {
    source_framework: request.source_framework,
    mappings: request.control_ids.map((control_id) => {
      const normalized = normalize(control_id);
      const mapped: Array<{ framework: string; control_id: string }> = [];
      for (const entry of related) {
        for (const map of entry.mappings) {
          if (normalize(map.source_control_id) === normalized) {
            mapped.push({ framework: entry.target, control_id: map.target_control_id });
          }
        }
      }
      return {
        source_control_id: control_id,
        related: mapped,
      };
    }),
  };
}

// Heuristic gap detection via substring matching — not semantic analysis.
// The agent is expected to compare requirements semantically; this just
// provides a fast first-pass signal.
export async function gapAnalyzer(
  request: GapAnalyzerRequest
): Promise<GapAnalyzerResponse> {
  const control = await findControl(request.framework, request.control_id);
  if (!control) {
    return {
      control_id: request.control_id,
      requirements: [],
      implementation_description: request.implementation_description,
      heuristic_gaps: ["Control not found in data set."],
    };
  }

  const description = normalize(request.implementation_description);
  const requirements: string[] = control.requirements ?? [];
  const heuristicGaps = requirements.filter((req: string) => !description.includes(normalize(req)));

  return {
    control_id: request.control_id,
    requirements,
    implementation_description: request.implementation_description,
    heuristic_gaps: heuristicGaps,
  };
}

// heuristic_match is a hint, not definitive — it checks whether the control
// ID appears in the file. The agent determines actual evidence sufficiency.
export async function evidenceValidator(
  request: EvidenceValidatorRequest
): Promise<EvidenceValidatorResponse> {
  const controlToken = normalize(request.control_id);
  const fileResults: EvidenceFileResult[] = [];
  for (const path of request.evidence_paths) {
    try {
      const content = await readFile(path, "utf8");
      fileResults.push({
        path,
        readable: true,
        excerpt: content.slice(0, 2000),
        heuristic_match: normalize(content).includes(controlToken),
      });
    } catch {
      fileResults.push({
        path,
        readable: false,
        excerpt: "",
        heuristic_match: false,
      });
    }
  }

  return {
    control_id: request.control_id,
    file_results: fileResults,
  };
}

// Generates a structured POA&M entry following federal standards (FedRAMP
// POA&M template). Milestones use a two-phase structure: plan then implement.
export async function findingGenerator(
  request: FindingGeneratorRequest
): Promise<FindingGeneratorResponse> {
  const now = new Date();
  const timestamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const dateStr = now.toISOString().slice(0, 10);
  const risk = request.risk_level ?? "moderate";

  // Remediation timeline based on risk: critical=30d, high=90d, moderate=180d, low=365d
  const remediationDays = risk === "critical" ? 30 : risk === "high" ? 90 : risk === "moderate" ? 180 : 365;
  const completionDate = new Date(now.getTime() + remediationDays * 86400000)
    .toISOString()
    .slice(0, 10);
  const midpointDate = new Date(now.getTime() + (remediationDays / 2) * 86400000)
    .toISOString()
    .slice(0, 10);

  return {
    finding_id: `F-${timestamp}-${Math.floor(Math.random() * 900 + 100)}`,
    poam_required: true,
    poam_entry: {
      weakness_description: request.gap_summary,
      point_of_contact: "ISSO — to be assigned",
      resources_required: "Engineering and security team remediation effort",
      scheduled_completion_date: completionDate,
      milestones: [
        {
          description: "Develop remediation plan and assign resources",
          due_date: midpointDate,
        },
        {
          description: "Implement remediation and validate effectiveness",
          due_date: completionDate,
        },
      ],
      source: "assessment",
      status: "open",
      deviation_request: false,
      original_detection_date: dateStr,
      vendor_dependency: false,
      false_positive: false,
    },
    remediation_steps: [request.gap_summary, `Remediation target: ${completionDate} (${remediationDays} days based on ${risk} risk level).`],
  };
}

// Walk levels in order (L1 → L2 → L3); a level is achieved only when ALL
// its practices are implemented. First level with gaps stops progression.
export async function cmmcLevelChecker(
  request: CmmcLevelCheckerRequest
): Promise<CmmcLevelCheckerResponse> {
  const data = await loadFrameworkData(frameworkFiles.CMMC);
  const implemented = new Set(
    request.implementations
      .filter((item) => {
        const status = normalize(item.status);
        return status === "implemented" || status === "satisfied";
      })
      .map((item) => normalize(item.control_id))
  );

  const levels = (data.levels ?? []) as any[];
  let achieved: CmmcLevelCheckerResponse["level"] = "None";
  let gapsToNext = 0;

  for (const level of levels) {
    const practices = level.practices ?? [];
    const missing = practices.filter(
      (practice: any) => !implemented.has(normalize(practice.id))
    );
    if (missing.length === 0) {
      achieved = level.level;
    } else {
      gapsToNext = missing.length;
      break;
    }
  }

  return {
    level: achieved,
    gaps_to_next_level: gapsToNext,
  };
}

// Keyword-based EU AI Act risk classification — maps prohibited uses to
// "unacceptable", safety-critical domains to "high", interactive systems
// to "limited", and everything else to "minimal".
export async function aiRiskClassifier(
  request: AiRiskClassifierRequest
): Promise<AiRiskClassifierResponse> {
  const text = normalize(request.system_description);
  if (text.includes("social scoring") || text.includes("subliminal")) {
    return { eu_ai_act_risk_tier: "unacceptable", nist_ai_rmf_function: "govern" };
  }
  if (
    text.includes("biometric") ||
    text.includes("critical infrastructure") ||
    text.includes("employment") ||
    text.includes("law enforcement")
  ) {
    return { eu_ai_act_risk_tier: "high", nist_ai_rmf_function: "map" };
  }
  if (text.includes("chatbot") || text.includes("recommendation")) {
    return { eu_ai_act_risk_tier: "limited", nist_ai_rmf_function: "measure" };
  }
  return { eu_ai_act_risk_tier: "minimal", nist_ai_rmf_function: "manage" };
}

// FIPS 199 high-water mark: the overall system impact level equals the
// highest of Confidentiality, Integrity, and Availability. This drives
// both FedRAMP baseline selection and DoD Impact Level determination.
// Returns the OSCAL SSP skeleton with required sections and field descriptions.
// The agent uses this as a structural reference when converting SSP documents
// to OSCAL JSON — it knows what to fill in without the prompt hardcoding the schema.
export type OscalSspScaffoldRequest = {
  security_sensitivity_level: string;
  control_count_hint?: number;
};

export type OscalSspScaffoldResponse = {
  oscal_version: string;
  required_sections: Array<{
    section: string;
    required_fields: Array<{ field: string; type: string; description: string }>;
  }>;
  implemented_requirement_template: {
    fields: Array<{ field: string; type: string; description: string }>;
  };
  notes: string[];
};

export async function oscalSspScaffold(
  request: OscalSspScaffoldRequest
): Promise<OscalSspScaffoldResponse> {
  const level = request.security_sensitivity_level.toLowerCase();
  return {
    oscal_version: "1.2.0",
    required_sections: [
      {
        section: "metadata",
        required_fields: [
          { field: "title", type: "string", description: "SSP document title" },
          { field: "last-modified", type: "string", description: "ISO 8601 datetime of last modification" },
          { field: "version", type: "string", description: "Document version (e.g., '1.0')" },
          { field: "oscal-version", type: "string", description: "OSCAL specification version (use '1.2.0')" },
          { field: "roles", type: "array", description: "Organizational roles (id, title) referenced by parties" },
          { field: "parties", type: "array", description: "Organizations and individuals (uuid, type, name)" },
        ],
      },
      {
        section: "import-profile",
        required_fields: [
          { field: "href", type: "string", description: "URI of the baseline profile this SSP is based on (e.g., FedRAMP Moderate profile URL)" },
        ],
      },
      {
        section: "system-characteristics",
        required_fields: [
          { field: "system-ids", type: "array", description: "Array of system identifier objects, each with identifier-type and id" },
          { field: "system-name", type: "string", description: "Official system name" },
          { field: "description", type: "string", description: "Narrative description of the system's purpose and function" },
          { field: "security-sensitivity-level", type: "string", description: `Impact level: '${level}'` },
          {
            field: "system-information",
            type: "object",
            description: "information-types array with NIST SP 800-60 categorizations and C/I/A impacts",
          },
          {
            field: "security-impact-level",
            type: "object",
            description: "security-objective-confidentiality, security-objective-integrity, security-objective-availability",
          },
          {
            field: "status",
            type: "object",
            description: "System status with 'state' field (operational, under-development, under-major-modification, disposition, other)",
          },
          {
            field: "authorization-boundary",
            type: "object",
            description: "Narrative description of what is inside and outside the authorization boundary",
          },
        ],
      },
      {
        section: "system-implementation",
        required_fields: [
          { field: "users", type: "array", description: "System users with uuid, role-ids, and title (optional but recommended)" },
          {
            field: "components",
            type: "array",
            description: "System components (required). Each needs uuid, type, title, description, and status. Use type 'this-system' for the primary system and 'leveraged-system' for inherited services.",
          },
        ],
      },
      {
        section: "control-implementation",
        required_fields: [
          { field: "description", type: "string", description: "Overall description of the control implementation approach" },
          {
            field: "implemented-requirements",
            type: "array",
            description: `Array of control implementations. ${request.control_count_hint ? `Hint: expect ~${request.control_count_hint} controls.` : ""}`,
          },
        ],
      },
    ],
    implemented_requirement_template: {
      fields: [
        { field: "uuid", type: "string", description: "Unique UUID for this requirement entry" },
        { field: "control-id", type: "string", description: "NIST 800-53 control ID (lowercase, e.g., 'ac-2')" },
        {
          field: "statements",
          type: "array",
          description: "Array of statement objects, each with statement-id, uuid, and by-components",
        },
        {
          field: "by-components[].component-uuid",
          type: "string",
          description: "UUID of the component implementing this part of the control",
        },
        {
          field: "by-components[].description",
          type: "string",
          description: "Narrative describing how this component satisfies the control requirement",
        },
        {
          field: "by-components[].implementation-status.state",
          type: "string",
          description: "One of: implemented, partial, planned, alternative, not-applicable",
        },
      ],
    },
    notes: [
      "All UUIDs must be valid UUID v4 or v5 format.",
      "Control IDs must be lowercase (e.g., 'ac-2', not 'AC-2').",
      `Security sensitivity level should be '${level}'.`,
      "Use the control_lookup tool to validate control IDs against the framework data.",
      "The by-components pattern supports shared responsibility — use separate entries for service provider vs. inherited controls.",
    ],
  };
}

// Returns the OSCAL mapping-collection skeleton with required sections and
// relationship type guidance. The agent uses this as a structural reference
// when converting framework mapping data to OSCAL mapping-collection JSON.
export type OscalMappingScaffoldRequest = {
  source_framework: string;
  target_framework: string;
  mapping_count_hint?: number;
};

export type OscalMappingScaffoldResponse = {
  oscal_version: string;
  required_sections: Array<{
    section: string;
    required_fields: Array<{ field: string; type: string; description: string }>;
  }>;
  map_entry_template: {
    fields: Array<{ field: string; type: string; description: string }>;
  };
  relationship_types: Array<{ type: string; description: string }>;
  notes: string[];
};

export async function oscalMappingScaffold(
  request: OscalMappingScaffoldRequest
): Promise<OscalMappingScaffoldResponse> {
  const hintNote = request.mapping_count_hint
    ? `Hint: expect ~${request.mapping_count_hint} control pairs.`
    : "";
  return {
    oscal_version: "1.2.0",
    required_sections: [
      {
        section: "metadata",
        required_fields: [
          { field: "title", type: "string", description: "Mapping collection title" },
          { field: "last-modified", type: "string", description: "ISO 8601 datetime of last modification" },
          { field: "version", type: "string", description: "Document version (e.g., '1.0')" },
          { field: "oscal-version", type: "string", description: "OSCAL specification version (use '1.2.0')" },
        ],
      },
      {
        section: "mappings",
        required_fields: [
          { field: "uuid", type: "string", description: "Unique UUID for this mapping group" },
          {
            field: "source-resource",
            type: "object",
            description: `Source framework reference (e.g., '${request.source_framework}')`,
          },
          {
            field: "target-resource",
            type: "object",
            description: `Target framework reference (e.g., '${request.target_framework}')`,
          },
          {
            field: "maps",
            type: "array",
            description: `Array of individual control-to-control mappings. ${hintNote}`,
          },
        ],
      },
    ],
    map_entry_template: {
      fields: [
        { field: "uuid", type: "string", description: "Unique UUID for this map entry" },
        { field: "source.type", type: "string", description: "Source element type (typically 'control')" },
        { field: "source.id-ref", type: "string", description: "Source control ID (lowercase, e.g., 'ac-2')" },
        { field: "target.type", type: "string", description: "Target element type (typically 'control')" },
        { field: "target.id-ref", type: "string", description: "Target control ID (lowercase)" },
        { field: "relationship.type", type: "string", description: "Relationship type (see relationship_types)" },
      ],
    },
    relationship_types: [
      { type: "equivalent-to", description: "Controls address the same requirement — functionally interchangeable" },
      { type: "subset-of", description: "Source is a narrower requirement contained within target" },
      { type: "superset-of", description: "Source is a broader requirement that encompasses target" },
      { type: "intersects-with", description: "Controls partially overlap — neither fully contains the other" },
    ],
    notes: [
      "All UUIDs must be valid UUID v4 or v5 format.",
      "Control IDs must be lowercase (e.g., 'ac-2', not 'AC-2').",
      `Source framework: '${request.source_framework}'.`,
      `Target framework: '${request.target_framework}'.`,
      "Use the control_lookup tool to validate control IDs against the framework data.",
      "Default to 'equivalent-to' for direct control mappings unless context suggests otherwise.",
    ],
  };
}

export async function baselineSelector(
  request: BaselineSelectorRequest
): Promise<BaselineSelectorResponse> {
  const impactRank: Record<string, number> = { low: 1, moderate: 2, high: 3 };
  const rankToLevel: Record<number, string> = { 1: "low", 2: "moderate", 3: "high" };

  // FIPS 199 high-water mark: overall impact = max(C, I, A)
  const cRank = impactRank[request.confidentiality_impact] ?? 1;
  const iRank = impactRank[request.integrity_impact] ?? 1;
  const aRank = impactRank[request.availability_impact] ?? 1;
  const overallRank = Math.max(cRank, iRank, aRank);
  const overall = rankToLevel[overallRank] ?? "low";

  // Map FIPS 199 overall to FedRAMP baseline
  const baselineMap: Record<string, string> = {
    low: "FedRAMP Low",
    moderate: "FedRAMP Moderate",
    high: "FedRAMP High",
  };
  const fedrampBaseline = baselineMap[overall] ?? "FedRAMP Low";

  // Determine DoD Impact Level from data types and mission context
  const dataTypes = request.data_types.map(normalize);
  const missionText = normalize(request.mission);
  let dodIL: string | undefined;

  if (dataTypes.some((t) => t.includes("classified") || t.includes("secret"))) {
    dodIL = "IL6";
  } else if (
    dataTypes.some((t) => t.includes("cui")) &&
    (missionText.includes("mission critical") || missionText.includes("national security"))
  ) {
    dodIL = "IL5";
  } else if (dataTypes.some((t) => t.includes("cui"))) {
    dodIL = "IL4";
  } else if (dataTypes.some((t) => t.includes("public")) || overall === "low") {
    dodIL = "IL2";
  }

  const rationale: string[] = [
    `FIPS 199 categorization: C=${request.confidentiality_impact}, I=${request.integrity_impact}, A=${request.availability_impact}`,
    `High-water mark: ${overall} (highest of C/I/A determines overall impact)`,
    `FedRAMP baseline: ${fedrampBaseline}`,
  ];

  if (dodIL) {
    rationale.push(`DoD Impact Level: ${dodIL}`);
    if (dodIL === "IL5" || dodIL === "IL6") {
      rationale.push("Note: IL5/IL6 require DISA Cloud Computing SRG overlays beyond FedRAMP controls");
    }
  }

  rationale.push(`Data types: ${request.data_types.join(", ")}`);
  rationale.push(`Mission: ${request.mission}`);

  if (request.regulatory_requirements.length > 0) {
    rationale.push(`Regulatory requirements: ${request.regulatory_requirements.join(", ")}`);
  }

  return {
    fedramp_baseline: fedrampBaseline,
    dod_impact_level: dodIL,
    fips_199_categorization: {
      confidentiality: request.confidentiality_impact,
      integrity: request.integrity_impact,
      availability: request.availability_impact,
      overall,
    },
    rationale,
  };
}
