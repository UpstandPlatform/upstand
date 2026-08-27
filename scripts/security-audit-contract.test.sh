#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUDIT_FILE="$ROOT_DIR/scripts/security-audit.sh"

if grep -Fq -- '--ignore GHSA-' "$AUDIT_FILE"; then
  echo "security audit must not suppress high-severity advisories" >&2
  exit 1
fi
grep -Fq 'audit --audit-level=high' "$AUDIT_FILE"

echo "security-audit-contract: passed"
