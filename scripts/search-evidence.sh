#!/usr/bin/env bash
# search-evidence.sh — grep wrapper for searching evidence directories by control ID.
# Usage: ./scripts/search-evidence.sh <control-id> [evidence-dir]
#
# Examples:
#   ./scripts/search-evidence.sh AC-2 ./evidence/
#   ./scripts/search-evidence.sh "AC-2(3)" ./evidence/

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <control-id> [evidence-dir]"
  echo ""
  echo "Search evidence files for references to a specific control ID."
  echo ""
  echo "Arguments:"
  echo "  control-id    NIST/FedRAMP control identifier (e.g., AC-2, AC-2(3), IR-4)"
  echo "  evidence-dir  Directory to search (default: ./evidence/)"
  echo ""
  echo "Examples:"
  echo "  $0 AC-2 ./evidence/"
  echo "  $0 \"AC-2(3)\" /path/to/evidence/"
  exit 1
fi

CONTROL_ID="$1"
EVIDENCE_DIR="${2:-./evidence/}"

if [[ ! -d "$EVIDENCE_DIR" ]]; then
  echo "Error: Evidence directory '$EVIDENCE_DIR' does not exist." >&2
  exit 1
fi

echo "Searching for '$CONTROL_ID' in $EVIDENCE_DIR ..."
echo "---"

# Case-insensitive recursive search, showing filenames and line numbers
grep -rin "$CONTROL_ID" "$EVIDENCE_DIR" 2>/dev/null || echo "(No matches found)"

echo "---"
echo "Files containing '$CONTROL_ID':"
grep -ril "$CONTROL_ID" "$EVIDENCE_DIR" 2>/dev/null | sort || echo "(None)"
