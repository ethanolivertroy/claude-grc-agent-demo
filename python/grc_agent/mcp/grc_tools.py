"""GRC tool implementations — Python port of src/mcp/grc-tools.ts."""

from __future__ import annotations

import json
import math
import random
from datetime import datetime, timedelta, timezone
from typing import Any

import anyio

from ..data.framework_data import load_framework_data
from ..mappings.framework_mapper import load_framework_mappings

# ---------------------------------------------------------------------------
# Framework file mapping — same as TypeScript frameworkFiles
# ---------------------------------------------------------------------------

FRAMEWORK_FILES: dict[str, str] = {
    "NIST 800-53": "nist-800-53-r5.json",
    "NIST 800-171": "nist-800-171-r2.json",
    "CMMC": "cmmc-2.0-practices.json",
    "NIST AI RMF": "nist-ai-rmf.json",
    "ISO 42001": "iso-42001.json",
    "EU AI Act": "eu-ai-act.json",
    "ISO 27001": "iso-27001.json",
    "SOC 2": "soc2.json",
    "CSA CCM": "csa-ccm.json",
    "NIST Privacy Framework": "nist-privacy-framework.json",
    "GDPR": "gdpr.json",
    "CCPA": "ccpa.json",
    "OECD AI Principles": "oecd-ai-principles.json",
    "White House EO 14110": "white-house-eo-14110.json",
    "DFARS 252.204-7012": "dfars-252.204-7012.json",
    "FISMA": "fisma.json",
    "FedRAMP": "fedramp-baselines.json",
}


# Case-insensitive matching lets users pass "ac-1" or "AC-1" interchangeably
def _normalize(text: str) -> str:
    return text.strip().lower()


# Framework-specific search: most frameworks use a flat controls array, but
# CMMC nests practices under levels, AI RMF nests categories under functions,
# and FedRAMP uses a baselines array. Each branch handles one structure.
async def _find_control(framework: str, control_id: str) -> dict[str, Any] | None:
    file_name = FRAMEWORK_FILES.get(framework)
    if not file_name:
        return None
    data = await load_framework_data(file_name)
    target = _normalize(control_id)

    controls = data.get("controls")
    if isinstance(controls, list):
        for ctrl in controls:
            if _normalize(ctrl.get("id", "")) == target:
                return ctrl

    if framework == "CMMC":
        for level in data.get("levels", []):
            for practice in level.get("practices", []):
                if _normalize(practice.get("id", "")) == target:
                    return {**practice, "level": level.get("level")}

    if framework == "NIST AI RMF":
        for func in data.get("functions", []):
            for category in func.get("categories", []):
                if _normalize(category.get("id", "")) == target:
                    return {**category, "function": func.get("id")}

    if framework == "FedRAMP":
        for baseline in data.get("baselines", []):
            if _normalize(baseline.get("baseline", "")) == target:
                return {
                    "id": baseline["baseline"],
                    "name": f"FedRAMP {baseline['baseline']} baseline",
                    "requirements": [baseline.get("description", "")],
                }

    return None


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------


async def control_lookup(args: dict[str, Any]) -> dict[str, Any]:
    control = await _find_control(args["framework"], args["control_id"])
    if not control:
        return {
            "framework": args["framework"],
            "control_id": args["control_id"],
            "control_name": None,
            "requirements": [],
            "assessment_objectives": [],
        }
    return {
        "framework": args["framework"],
        "control_id": control.get("id", args["control_id"]),
        "control_name": control.get("name"),
        "requirements": control.get("requirements", []),
        "assessment_objectives": control.get("assessment_objectives", []),
    }


async def framework_mapper(args: dict[str, Any]) -> dict[str, Any]:
    mappings_file = await load_framework_mappings()
    related = [
        entry
        for entry in mappings_file.get("mappings", [])
        if entry.get("source") == args["source_framework"]
    ]

    result_mappings = []
    for cid in args["control_ids"]:
        normalized = _normalize(cid)
        mapped: list[dict[str, str]] = []
        for entry in related:
            for m in entry.get("mappings", []):
                if _normalize(m.get("source_control_id", "")) == normalized:
                    mapped.append(
                        {"framework": entry["target"], "control_id": m["target_control_id"]}
                    )
        result_mappings.append({"source_control_id": cid, "related": mapped})

    return {"source_framework": args["source_framework"], "mappings": result_mappings}


# Heuristic gap detection via substring matching — not semantic analysis.
# The agent is expected to compare requirements semantically; this just
# provides a fast first-pass signal.
async def gap_analyzer(args: dict[str, Any]) -> dict[str, Any]:
    control = await _find_control(args["framework"], args["control_id"])
    if not control:
        return {
            "control_id": args["control_id"],
            "requirements": [],
            "implementation_description": args["implementation_description"],
            "heuristic_gaps": ["Control not found in data set."],
        }
    description = _normalize(args["implementation_description"])
    requirements: list[str] = control.get("requirements", [])
    heuristic_gaps = [req for req in requirements if _normalize(req) not in description]
    return {
        "control_id": args["control_id"],
        "requirements": requirements,
        "implementation_description": args["implementation_description"],
        "heuristic_gaps": heuristic_gaps,
    }


# heuristic_match is a hint, not definitive — it checks whether the control
# ID appears in the file. The agent determines actual evidence sufficiency.
async def evidence_validator(args: dict[str, Any]) -> dict[str, Any]:
    control_token = _normalize(args["control_id"])
    file_results: list[dict[str, Any]] = []
    for path in args["evidence_paths"]:
        try:
            content = await anyio.Path(path).read_text(encoding="utf-8")
            file_results.append({
                "path": path,
                "readable": True,
                "excerpt": content[:2000],
                "heuristic_match": control_token in _normalize(content),
            })
        except Exception:
            file_results.append({
                "path": path,
                "readable": False,
                "excerpt": "",
                "heuristic_match": False,
            })
    return {
        "control_id": args["control_id"],
        "file_results": file_results,
    }


# Generates a structured POA&M entry following federal standards (FedRAMP
# POA&M template). Milestones use a two-phase structure: plan then implement.
async def finding_generator(args: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y%m%d")
    date_str = now.strftime("%Y-%m-%d")
    risk: str = args.get("risk_level", "moderate")

    remediation_days = {"critical": 30, "high": 90, "moderate": 180, "low": 365}.get(risk, 180)
    completion_date = (now + timedelta(days=remediation_days)).strftime("%Y-%m-%d")
    midpoint_date = (now + timedelta(days=remediation_days // 2)).strftime("%Y-%m-%d")

    return {
        "finding_id": f"F-{timestamp}-{random.randint(100, 999)}",
        "poam_required": True,
        "poam_entry": {
            "weakness_description": args["gap_summary"],
            "point_of_contact": "ISSO — to be assigned",
            "resources_required": "Engineering and security team remediation effort",
            "scheduled_completion_date": completion_date,
            "milestones": [
                {"description": "Develop remediation plan and assign resources", "due_date": midpoint_date},
                {"description": "Implement remediation and validate effectiveness", "due_date": completion_date},
            ],
            "source": "assessment",
            "status": "open",
            "deviation_request": False,
            "original_detection_date": date_str,
            "vendor_dependency": False,
            "false_positive": False,
        },
        "remediation_steps": [
            args["gap_summary"],
            f"Remediation target: {completion_date} ({remediation_days} days based on {risk} risk level).",
        ],
    }


# Walk levels in order (L1 → L2 → L3); a level is achieved only when ALL
# its practices are implemented. First level with gaps stops progression.
async def cmmc_level_checker(args: dict[str, Any]) -> dict[str, Any]:
    data = await load_framework_data(FRAMEWORK_FILES["CMMC"])
    implemented = {
        _normalize(item["control_id"])
        for item in args["implementations"]
        if _normalize(item["status"]) in ("implemented", "satisfied")
    }

    achieved: str = "None"
    gaps_to_next = 0

    for level in data.get("levels", []):
        practices = level.get("practices", [])
        missing = [p for p in practices if _normalize(p.get("id", "")) not in implemented]
        if not missing:
            achieved = level.get("level", "None")
        else:
            gaps_to_next = len(missing)
            break

    return {"level": achieved, "gaps_to_next_level": gaps_to_next}


# Keyword-based EU AI Act risk classification — maps prohibited uses to
# "unacceptable", safety-critical domains to "high", interactive systems
# to "limited", and everything else to "minimal".
async def ai_risk_classifier(args: dict[str, Any]) -> dict[str, Any]:
    text = _normalize(args["system_description"])
    if "social scoring" in text or "subliminal" in text:
        return {"eu_ai_act_risk_tier": "unacceptable", "nist_ai_rmf_function": "govern"}
    if any(kw in text for kw in ("biometric", "critical infrastructure", "employment", "law enforcement")):
        return {"eu_ai_act_risk_tier": "high", "nist_ai_rmf_function": "map"}
    if "chatbot" in text or "recommendation" in text:
        return {"eu_ai_act_risk_tier": "limited", "nist_ai_rmf_function": "measure"}
    return {"eu_ai_act_risk_tier": "minimal", "nist_ai_rmf_function": "manage"}


# FIPS 199 high-water mark: the overall system impact level equals the
# highest of Confidentiality, Integrity, and Availability. This drives
# both FedRAMP baseline selection and DoD Impact Level determination.
# Returns the OSCAL SSP skeleton with required sections and field descriptions.
# The agent uses this as a structural reference when converting SSP documents
# to OSCAL JSON — it knows what to fill in without the prompt hardcoding the schema.
async def oscal_ssp_scaffold(args: dict[str, Any]) -> dict[str, Any]:
    level = args["security_sensitivity_level"].lower()
    control_hint = args.get("control_count_hint")
    hint_note = f"Hint: expect ~{control_hint} controls." if control_hint else ""
    return {
        "oscal_version": "1.2.0",
        "required_sections": [
            {
                "section": "metadata",
                "required_fields": [
                    {"field": "title", "type": "string", "description": "SSP document title"},
                    {"field": "last-modified", "type": "string", "description": "ISO 8601 datetime of last modification"},
                    {"field": "version", "type": "string", "description": "Document version (e.g., '1.0')"},
                    {"field": "oscal-version", "type": "string", "description": "OSCAL specification version (use '1.2.0')"},
                    {"field": "roles", "type": "array", "description": "Organizational roles (id, title) referenced by parties"},
                    {"field": "parties", "type": "array", "description": "Organizations and individuals (uuid, type, name)"},
                ],
            },
            {
                "section": "import-profile",
                "required_fields": [
                    {"field": "href", "type": "string", "description": "URI of the baseline profile this SSP is based on (e.g., FedRAMP Moderate profile URL)"},
                ],
            },
            {
                "section": "system-characteristics",
                "required_fields": [
                    {"field": "system-ids", "type": "array", "description": "Array of system identifier objects, each with identifier-type and id"},
                    {"field": "system-name", "type": "string", "description": "Official system name"},
                    {"field": "description", "type": "string", "description": "Narrative description of the system's purpose and function"},
                    {"field": "security-sensitivity-level", "type": "string", "description": f"Impact level: '{level}'"},
                    {
                        "field": "system-information",
                        "type": "object",
                        "description": "information-types array with NIST SP 800-60 categorizations and C/I/A impacts",
                    },
                    {
                        "field": "security-impact-level",
                        "type": "object",
                        "description": "security-objective-confidentiality, security-objective-integrity, security-objective-availability",
                    },
                    {
                        "field": "status",
                        "type": "object",
                        "description": "System status with 'state' field (operational, under-development, under-major-modification, disposition, other)",
                    },
                    {
                        "field": "authorization-boundary",
                        "type": "object",
                        "description": "Narrative description of what is inside and outside the authorization boundary",
                    },
                ],
            },
            {
                "section": "system-implementation",
                "required_fields": [
                    {"field": "users", "type": "array", "description": "System users with uuid, role-ids, and title (optional but recommended)"},
                    {
                        "field": "components",
                        "type": "array",
                        "description": "System components (required). Each needs uuid, type, title, description, and status. Use type 'this-system' for the primary system and 'leveraged-system' for inherited services.",
                    },
                ],
            },
            {
                "section": "control-implementation",
                "required_fields": [
                    {"field": "description", "type": "string", "description": "Overall description of the control implementation approach"},
                    {
                        "field": "implemented-requirements",
                        "type": "array",
                        "description": f"Array of control implementations. {hint_note}",
                    },
                ],
            },
        ],
        "implemented_requirement_template": {
            "fields": [
                {"field": "uuid", "type": "string", "description": "Unique UUID for this requirement entry"},
                {"field": "control-id", "type": "string", "description": "NIST 800-53 control ID (lowercase, e.g., 'ac-2')"},
                {
                    "field": "statements",
                    "type": "array",
                    "description": "Array of statement objects, each with statement-id, uuid, and by-components",
                },
                {
                    "field": "by-components[].component-uuid",
                    "type": "string",
                    "description": "UUID of the component implementing this part of the control",
                },
                {
                    "field": "by-components[].description",
                    "type": "string",
                    "description": "Narrative describing how this component satisfies the control requirement",
                },
                {
                    "field": "by-components[].implementation-status.state",
                    "type": "string",
                    "description": "One of: implemented, partial, planned, alternative, not-applicable",
                },
            ],
        },
        "notes": [
            "All UUIDs must be valid UUID v4 or v5 format.",
            "Control IDs must be lowercase (e.g., 'ac-2', not 'AC-2').",
            f"Security sensitivity level should be '{level}'.",
            "Use the control_lookup tool to validate control IDs against the framework data.",
            "The by-components pattern supports shared responsibility — use separate entries for service provider vs. inherited controls.",
        ],
    }


# Returns the OSCAL mapping-collection skeleton with required sections and
# relationship type guidance. The agent uses this as a structural reference
# when converting framework mapping data to OSCAL mapping-collection JSON.
async def oscal_mapping_scaffold(args: dict[str, Any]) -> dict[str, Any]:
    source = args["source_framework"]
    target = args["target_framework"]
    count_hint = args.get("mapping_count_hint")
    hint_note = f"Hint: expect ~{count_hint} control pairs." if count_hint else ""
    return {
        "oscal_version": "1.2.0",
        "required_sections": [
            {
                "section": "metadata",
                "required_fields": [
                    {"field": "title", "type": "string", "description": "Mapping collection title"},
                    {"field": "last-modified", "type": "string", "description": "ISO 8601 datetime of last modification"},
                    {"field": "version", "type": "string", "description": "Document version (e.g., '1.0')"},
                    {"field": "oscal-version", "type": "string", "description": "OSCAL specification version (use '1.2.0')"},
                ],
            },
            {
                "section": "mappings",
                "required_fields": [
                    {"field": "uuid", "type": "string", "description": "Unique UUID for this mapping group"},
                    {"field": "source-resource", "type": "object", "description": f"Source framework reference (e.g., '{source}')"},
                    {"field": "target-resource", "type": "object", "description": f"Target framework reference (e.g., '{target}')"},
                    {"field": "maps", "type": "array", "description": f"Array of individual control-to-control mappings. {hint_note}"},
                ],
            },
        ],
        "map_entry_template": {
            "fields": [
                {"field": "uuid", "type": "string", "description": "Unique UUID for this map entry"},
                {"field": "source.type", "type": "string", "description": "Source element type (typically 'control')"},
                {"field": "source.id-ref", "type": "string", "description": "Source control ID (lowercase, e.g., 'ac-2')"},
                {"field": "target.type", "type": "string", "description": "Target element type (typically 'control')"},
                {"field": "target.id-ref", "type": "string", "description": "Target control ID (lowercase)"},
                {"field": "relationship.type", "type": "string", "description": "Relationship type (see relationship_types)"},
            ],
        },
        "relationship_types": [
            {"type": "equivalent-to", "description": "Controls address the same requirement — functionally interchangeable"},
            {"type": "subset-of", "description": "Source is a narrower requirement contained within target"},
            {"type": "superset-of", "description": "Source is a broader requirement that encompasses target"},
            {"type": "intersects-with", "description": "Controls partially overlap — neither fully contains the other"},
        ],
        "notes": [
            "All UUIDs must be valid UUID v4 or v5 format.",
            "Control IDs must be lowercase (e.g., 'ac-2', not 'AC-2').",
            f"Source framework: '{source}'.",
            f"Target framework: '{target}'.",
            "Use the control_lookup tool to validate control IDs against the framework data.",
            "Default to 'equivalent-to' for direct control mappings unless context suggests otherwise.",
        ],
    }


async def baseline_selector(args: dict[str, Any]) -> dict[str, Any]:
    impact_rank = {"low": 1, "moderate": 2, "high": 3}
    rank_to_level = {1: "low", 2: "moderate", 3: "high"}

    c_rank = impact_rank.get(args["confidentiality_impact"], 1)
    i_rank = impact_rank.get(args["integrity_impact"], 1)
    a_rank = impact_rank.get(args["availability_impact"], 1)
    overall_rank = max(c_rank, i_rank, a_rank)
    overall = rank_to_level.get(overall_rank, "low")

    baseline_map = {"low": "FedRAMP Low", "moderate": "FedRAMP Moderate", "high": "FedRAMP High"}
    fedramp_baseline = baseline_map.get(overall, "FedRAMP Low")

    data_types = [_normalize(t) for t in args.get("data_types", [])]
    mission_text = _normalize(args.get("mission", ""))
    dod_il: str | None = None

    if any("classified" in t or "secret" in t for t in data_types):
        dod_il = "IL6"
    elif any("cui" in t for t in data_types) and (
        "mission critical" in mission_text or "national security" in mission_text
    ):
        dod_il = "IL5"
    elif any("cui" in t for t in data_types):
        dod_il = "IL4"
    elif any("public" in t for t in data_types) or overall == "low":
        dod_il = "IL2"

    rationale = [
        f"FIPS 199 categorization: C={args['confidentiality_impact']}, I={args['integrity_impact']}, A={args['availability_impact']}",
        f"High-water mark: {overall} (highest of C/I/A determines overall impact)",
        f"FedRAMP baseline: {fedramp_baseline}",
    ]
    if dod_il:
        rationale.append(f"DoD Impact Level: {dod_il}")
        if dod_il in ("IL5", "IL6"):
            rationale.append(
                "Note: IL5/IL6 require DISA Cloud Computing SRG overlays beyond FedRAMP controls"
            )
    rationale.append(f"Data types: {', '.join(args.get('data_types', []))}")
    rationale.append(f"Mission: {args.get('mission', '')}")
    regs = args.get("regulatory_requirements", [])
    if regs:
        rationale.append(f"Regulatory requirements: {', '.join(regs)}")

    return {
        "fedramp_baseline": fedramp_baseline,
        "dod_impact_level": dod_il,
        "fips_199_categorization": {
            "confidentiality": args["confidentiality_impact"],
            "integrity": args["integrity_impact"],
            "availability": args["availability_impact"],
            "overall": overall,
        },
        "rationale": rationale,
    }
