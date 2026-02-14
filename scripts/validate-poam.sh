#!/usr/bin/env bash
# validate-poam.sh — check POA&M completeness in a GRC assessment JSON file.
# Usage: ./scripts/validate-poam.sh <assessment.json>
#
# Validates that every finding with poam_required=true has a poam_entry
# containing the required fields: weakness_description, scheduled_completion_date,
# milestones, source, status.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <assessment.json>"
  echo ""
  echo "Validate POA&M entry completeness in a GRC assessment JSON file."
  echo ""
  echo "Checks that every finding with poam_required=true has a poam_entry with:"
  echo "  - weakness_description"
  echo "  - scheduled_completion_date"
  echo "  - milestones"
  echo "  - source"
  echo "  - status"
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

REQUIRED_FIELDS=("weakness_description" "scheduled_completion_date" "milestones" "source" "status")

echo "Validating POA&M entries in: $ASSESSMENT_FILE"
echo "---"

# Count findings that require POA&M
POAM_REQUIRED=$(jq '[.findings[] | select(.poam_required == true)] | length' "$ASSESSMENT_FILE")
TOTAL_FINDINGS=$(jq '.findings | length' "$ASSESSMENT_FILE")

echo "Total findings: $TOTAL_FINDINGS"
echo "Findings requiring POA&M: $POAM_REQUIRED"
echo ""

if [[ "$POAM_REQUIRED" -eq 0 ]]; then
  echo "No POA&M entries required — nothing to validate."
  exit 0
fi

# Check each finding that requires a POA&M
ISSUES=0
while IFS= read -r control_id; do
  # Check if poam_entry exists
  HAS_ENTRY=$(jq -r --arg cid "$control_id" \
    '.findings[] | select(.control_id == $cid and .poam_required == true) | .poam_entry != null' \
    "$ASSESSMENT_FILE")

  if [[ "$HAS_ENTRY" != "true" ]]; then
    echo "FAIL: $control_id — poam_required=true but no poam_entry"
    ISSUES=$((ISSUES + 1))
    continue
  fi

  # Check required fields
  for field in "${REQUIRED_FIELDS[@]}"; do
    HAS_FIELD=$(jq -r --arg cid "$control_id" --arg f "$field" \
      '.findings[] | select(.control_id == $cid and .poam_required == true) | .poam_entry[$f] != null' \
      "$ASSESSMENT_FILE")

    if [[ "$HAS_FIELD" != "true" ]]; then
      echo "FAIL: $control_id — poam_entry missing field: $field"
      ISSUES=$((ISSUES + 1))
    fi
  done
done < <(jq -r '.findings[] | select(.poam_required == true) | .control_id' "$ASSESSMENT_FILE")

echo ""
if [[ "$ISSUES" -eq 0 ]]; then
  echo "PASS: All $POAM_REQUIRED POA&M entries are complete."
else
  echo "ISSUES FOUND: $ISSUES problem(s) across $POAM_REQUIRED POA&M entries."
  exit 1
fi
