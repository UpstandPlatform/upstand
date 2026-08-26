#!/usr/bin/env bash
set -euo pipefail

# High-severity dependency advisories are release-blocking. Electron's
# packaging extractor is replaced by the checked-in compatibility shim, and
# the vulnerable DMG maker is intentionally not part of the supported build.
bun_bin="${BUN_BIN:-bun}"
if ! command -v "$bun_bin" >/dev/null 2>&1 && command -v bun.exe >/dev/null 2>&1; then
  bun_bin="bun.exe"
fi
command -v "$bun_bin" >/dev/null 2>&1 || {
  echo "security-audit: Bun runtime is required" >&2
  exit 1
}
"$bun_bin" audit --audit-level=high
