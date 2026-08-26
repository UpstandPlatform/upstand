#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/verify-recovery-evidence.sh"

grep -Fq 'upstand.backup-restore-rehearsal.v1' "$SCRIPT" || {
  echo "recovery evidence verifier must validate backup evidence" >&2
  exit 1
}
grep -Fq 'upstand.secret-key-recovery-rehearsal.v1' "$SCRIPT" || {
  echo "recovery evidence verifier must validate key recovery evidence" >&2
  exit 1
}
grep -Fq 'synthetic-disposable' "$SCRIPT" || {
  echo "recovery evidence verifier must preserve synthetic scope" >&2
  exit 1
}
grep -Fq 'max_restore_seconds' "$SCRIPT" || {
  echo "recovery evidence verifier must enforce restore budgets" >&2
  exit 1
}

echo "verify-recovery-evidence-contract: passed"
