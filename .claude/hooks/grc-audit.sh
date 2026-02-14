#!/bin/bash
# GRC audit hook: logs every Bash command and blocks writes to finalized packages
INPUT=$(cat)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# Log every command for assessment traceability
echo "[$TIMESTAMP] $COMMAND" >> .claude/grc-audit.log

# Block modifications to finalized authorization packages
if echo "$COMMAND" | grep -qE '(authorization-packages|final-deliverables)/'; then
  echo "Blocked: finalized package directories are read-only during assessment" >&2
  exit 2
fi

exit 0
