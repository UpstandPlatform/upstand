#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/secret-key-recovery-rehearsal.sh"

grep -Fq 'upstand.secret-key-recovery-rehearsal.v1' "$SCRIPT" || {
  echo "secret-key recovery rehearsal must emit a versioned evidence schema" >&2
  exit 1
}
grep -Fq 'aes-256-gcm' "$SCRIPT" || {
  echo "secret-key recovery rehearsal must use the application encryption algorithm" >&2
  exit 1
}
grep -Fq 'key_sha256' "$SCRIPT" || {
  echo "secret-key recovery rehearsal must emit only a key fingerprint" >&2
  exit 1
}
grep -Fq 'scope: "synthetic-disposable"' "$SCRIPT" || {
  echo "secret-key recovery rehearsal must not be presented as installation evidence" >&2
  exit 1
}
echo "secret-key-recovery-rehearsal-contract: passed"
