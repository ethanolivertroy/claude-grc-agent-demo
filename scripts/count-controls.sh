#!/usr/bin/env bash
# count-controls.sh — summarize a GRC assessment JSON: total findings,
# satisfied, gaps, and POA&M entries required.
# Usage: ./scripts/count-controls.sh <assessment.json>

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <assessment.json>"
  echo ""
  echo "Print a summary of a GRC assessment JSON file:"
  echo "  - Total findings"
  echo "  - Satisfied / Partially satisfied / Not satisfied / Not applicable"
  echo "  - High-risk and critical findings"
  echo "  - POA&M entries required"
  echo "  - Overall compliance percentage"
  exit 1
fi

ASSESSMENT_FILE="$1"

if [[ ! -f "$ASSESSMENT_FILE" ]]; then
  echo "Error: File '$ASSESSMENT_FILE' not found." >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required but not installed." >&2
  echo "Install it with: brew install jq (macOS) or apt-get install jq (Linux)" >&2
  exit 1
fi

echo "Assessment Summary: $ASSESSMENT_FILE"
echo "==================================="

# Metadata
FRAMEWORK=$(jq -r '.assessment_metadata.framework // "N/A"' "$ASSESSMENT_FILE")
BASELINE=$(jq -r '.assessment_metadata.baseline_or_level // "N/A"' "$ASSESSMENT_FILE")
DATE=$(jq -r '.assessment_metadata.assessment_date // "N/A"' "$ASSESSMENT_FILE")
SCOPE=$(jq -r '.assessment_metadata.scope // "N/A"' "$ASSESSMENT_FILE")

echo "Framework:  $FRAMEWORK"
echo "Baseline:   $BASELINE"
echo "Date:       $DATE"
echo "Scope:      $SCOPE"
echo ""

# Counts by status
TOTAL=$(jq '.findings | length' "$ASSESSMENT_FILE")
SATISFIED=$(jq '[.findings[] | select(.status == "satisfied")] | length' "$ASSESSMENT_FILE")
PARTIAL=$(jq '[.findings[] | select(.status == "partially_satisfied")] | length' "$ASSESSMENT_FILE")
NOT_SAT=$(jq '[.findings[] | select(.status == "not_satisfied")] | length' "$ASSESSMENT_FILE")
NA=$(jq '[.findings[] | select(.status == "not_applicable")] | length' "$ASSESSMENT_FILE")

echo "Findings Breakdown"
echo "-------------------"
echo "Total:                $TOTAL"
echo "Satisfied:            $SATISFIED"
echo "Partially satisfied:  $PARTIAL"
echo "Not satisfied:        $NOT_SAT"
echo "Not applicable:       $NA"
echo ""

# Risk levels
CRITICAL=$(jq '[.findings[] | select(.risk_level == "critical")] | length' "$ASSESSMENT_FILE")
HIGH=$(jq '[.findings[] | select(.risk_level == "high")] | length' "$ASSESSMENT_FILE")
MODERATE=$(jq '[.findings[] | select(.risk_level == "moderate")] | length' "$ASSESSMENT_FILE")
LOW=$(jq '[.findings[] | select(.risk_level == "low")] | length' "$ASSESSMENT_FILE")

echo "Risk Levels"
echo "-------------------"
echo "Critical:  $CRITICAL"
echo "High:      $HIGH"
echo "Moderate:  $MODERATE"
echo "Low:       $LOW"
echo ""

# POA&M
POAM=$(jq '[.findings[] | select(.poam_required == true)] | length' "$ASSESSMENT_FILE")
echo "POA&M entries required: $POAM"

# Overall percentage
PCT=$(jq '.overall_grc_percentage // "N/A"' "$ASSESSMENT_FILE")
echo "Overall compliance:     ${PCT}%"
