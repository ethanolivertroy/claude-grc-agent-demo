"""MCP server registration — Python port of src/mcp/grc-server.ts."""

from __future__ import annotations

import json

from claude_agent_sdk import create_sdk_mcp_server, tool

from .grc_tools import (
    ai_risk_classifier,
    baseline_selector,
    cmmc_level_checker,
    control_lookup,
    evidence_validator,
    finding_generator,
    framework_mapper,
    gap_analyzer,
    oscal_mapping_scaffold,
    oscal_ssp_scaffold,
)


def _text_result(data: dict) -> dict:
    return {"content": [{"type": "text", "text": json.dumps(data, indent=2)}]}


# 8 domain tools registered as an in-process MCP server (data-provider pattern).
# All framework knowledge lives in data/*.json — tools query it at runtime
# rather than hardcoding compliance logic. Available to the main agent and all subagents.

# Retrieve control requirements and assessment objectives from framework data
@tool(
    "control_lookup",
    "Look up a control by ID and return requirements and assessment objectives.",
    {"framework": {"type": "string"}, "control_id": {"type": "string"}},
)
async def control_lookup_tool(args: dict) -> dict:
    return _text_result(await control_lookup(args))


# Find equivalent controls across frameworks (e.g., NIST 800-53 ↔ ISO 27001)
@tool(
    "framework_mapper",
    "Map control IDs between frameworks.",
    {
        "source_framework": {"type": "string"},
        "control_ids": {"type": "array", "items": {"type": "string"}},
    },
)
async def framework_mapper_tool(args: dict) -> dict:
    return _text_result(await framework_mapper(args))


# Compare implementation description against requirements; heuristic first-pass
@tool(
    "gap_analyzer",
    "Return control requirements alongside the implementation description and heuristic gap hints. The agent should compare semantically.",
    {
        "framework": {"type": "string"},
        "control_id": {"type": "string"},
        "implementation_description": {"type": "string"},
    },
)
async def gap_analyzer_tool(args: dict) -> dict:
    return _text_result(await gap_analyzer(args))


# Read evidence files and check whether they mention the control ID
@tool(
    "evidence_validator",
    "Read evidence files and return excerpts with a heuristic match hint. The agent determines actual sufficiency.",
    {
        "framework": {"type": "string"},
        "control_id": {"type": "string"},
        "evidence_paths": {"type": "array", "items": {"type": "string"}},
    },
)
async def evidence_validator_tool(args: dict) -> dict:
    return _text_result(await evidence_validator(args))


# Produce POA&M entries with federal-standard fields and risk-based timelines
@tool(
    "finding_generator",
    "Create structured POA&M / finding entries with federal-standard fields including milestones, source, deviation tracking, and risk-based remediation timelines.",
    {
        "framework": {"type": "string"},
        "control_id": {"type": "string"},
        "gap_summary": {"type": "string"},
        "risk_level": {
            "type": "string",
            "enum": ["low", "moderate", "high", "critical"],
        },
    },
)
async def finding_generator_tool(args: dict) -> dict:
    return _text_result(await finding_generator(args))


# Determine highest achievable CMMC level from practice implementation status
@tool(
    "cmmc_level_checker",
    "Assess achievable CMMC level and gaps to next level.",
    {
        "implementations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "control_id": {"type": "string"},
                    "status": {"type": "string"},
                },
            },
        },
    },
)
async def cmmc_level_checker_tool(args: dict) -> dict:
    return _text_result(await cmmc_level_checker(args))


# Classify AI system under EU AI Act risk tiers and NIST AI RMF functions
@tool(
    "ai_risk_classifier",
    "Classify EU AI Act risk tier and assess against NIST AI RMF.",
    {"system_description": {"type": "string"}},
)
async def ai_risk_classifier_tool(args: dict) -> dict:
    return _text_result(await ai_risk_classifier(args))


# Return OSCAL mapping-collection skeleton for agent-driven mapping conversion
@tool(
    "oscal_mapping_scaffold",
    "Return the OSCAL mapping-collection skeleton with required sections, relationship types, and a map entry template. Used during framework-mapping-to-OSCAL conversion.",
    {
        "source_framework": {"type": "string", "description": "Source framework name (e.g., 'NIST 800-53')"},
        "target_framework": {"type": "string", "description": "Target framework name (e.g., 'ISO 27001')"},
        "mapping_count_hint": {"type": "number", "description": "Approximate number of control pairs to convert"},
    },
)
async def oscal_mapping_scaffold_tool(args: dict) -> dict:
    return _text_result(await oscal_mapping_scaffold(args))


# Recommend FedRAMP baseline + DoD IL from FIPS 199 impact categorization
@tool(
    "baseline_selector",
    "Recommend FedRAMP baseline and DoD Impact Level using FIPS 199 high-water mark categorization.",
    {
        "confidentiality_impact": {"type": "string", "enum": ["low", "moderate", "high"]},
        "integrity_impact": {"type": "string", "enum": ["low", "moderate", "high"]},
        "availability_impact": {"type": "string", "enum": ["low", "moderate", "high"]},
        "data_types": {"type": "array", "items": {"type": "string"}},
        "mission": {"type": "string"},
        "regulatory_requirements": {"type": "array", "items": {"type": "string"}},
    },
)
async def baseline_selector_tool(args: dict) -> dict:
    return _text_result(await baseline_selector(args))


# Return OSCAL SSP skeleton structure for agent-driven SSP conversion
@tool(
    "oscal_ssp_scaffold",
    "Return the OSCAL SSP skeleton with required sections, field descriptions, and an implemented-requirement template. Used during SSP-to-OSCAL conversion.",
    {
        "security_sensitivity_level": {"type": "string", "description": "Impact level (low, moderate, high)"},
        "control_count_hint": {"type": "number", "description": "Approximate number of controls to convert"},
    },
)
async def oscal_ssp_scaffold_tool(args: dict) -> dict:
    return _text_result(await oscal_ssp_scaffold(args))


grc_mcp_server = create_sdk_mcp_server(
    name="grc-tools",
    tools=[
        control_lookup_tool,
        framework_mapper_tool,
        gap_analyzer_tool,
        evidence_validator_tool,
        finding_generator_tool,
        cmmc_level_checker_tool,
        ai_risk_classifier_tool,
        baseline_selector_tool,
        oscal_ssp_scaffold_tool,
        oscal_mapping_scaffold_tool,
    ],
)
