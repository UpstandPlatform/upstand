#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/external-services-smoke.ps1"

for required in \
  'UPSTAND_EXTERNAL_SMOKE_IMAGE' \
  "@sha256:[0-9a-fA-F]{64}" \
  'apps/server/dist/migrate.mjs' \
  '/health/live'; do
  grep -Fq -- "$required" "$SCRIPT" || {
    echo "external services smoke is missing required contract: $required" >&2
    exit 1
  }
done

[[ "$(grep -Fc 'bun run apps/server/dist/migrate.mjs' "$SCRIPT")" -ge 2 ]] || {
  echo "external services smoke must exercise both fresh and upgraded migrations" >&2
  exit 1
}

if grep -Fq -- 'upstand-production-server:current' "$SCRIPT"; then
  echo "external services smoke must not use the mutable local server tag" >&2
  exit 1
fi

echo "external-services-smoke-contract: passed"
