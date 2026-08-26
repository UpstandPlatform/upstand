#!/usr/bin/env bash
set -euo pipefail

evidence_dir="${1:-}"
[[ -n "$evidence_dir" && -d "$evidence_dir" ]] || {
  echo "verify-recovery-evidence: evidence directory is required" >&2
  exit 1
}

node - "$evidence_dir" <<'NODE'
const { readFileSync } = require("node:fs");
const path = require("node:path");

const directory = process.argv[2];
const readJson = (name) => {
  try {
    return JSON.parse(readFileSync(path.join(directory, name), "utf8"));
  } catch (error) {
    throw new Error(`unable to read ${name}: ${error.message}`);
  }
};
const backup = readJson("backup-restore-rehearsal.json");
const key = readJson("secret-key-recovery.json");

if (backup.schema !== "upstand.backup-restore-rehearsal.v1") {
  throw new Error("backup evidence schema is invalid");
}
if (backup.scope !== "synthetic-disposable" || backup.result !== "passed") {
  throw new Error("backup evidence must remain explicitly synthetic and passed");
}
if (backup.data_assertion !== true) {
  throw new Error("backup evidence is missing its data assertion");
}
for (const field of ["readiness_seconds", "transfer_seconds", "restore_seconds", "total_seconds"]) {
  if (typeof backup[field] !== "number" || !Number.isFinite(backup[field]) || backup[field] < 0) {
    throw new Error(`backup evidence has invalid ${field}`);
  }
}
if (backup.max_restore_seconds > 0 && backup.restore_seconds > backup.max_restore_seconds) {
  throw new Error("backup evidence exceeds its restore budget");
}
if (backup.max_total_seconds > 0 && backup.total_seconds > backup.max_total_seconds) {
  throw new Error("backup evidence exceeds its total budget");
}

if (key.schema !== "upstand.secret-key-recovery-rehearsal.v1") {
  throw new Error("key recovery evidence schema is invalid");
}
if (key.scope !== "synthetic-disposable" || key.result !== "passed") {
  throw new Error("key recovery evidence must remain explicitly synthetic and passed");
}
if (key.algorithm !== "aes-256-gcm" || !/^[0-9a-f]{64}$/.test(key.key_sha256)) {
  throw new Error("key recovery evidence is missing a valid algorithm or fingerprint");
}
if (typeof key.recovery_milliseconds !== "number" || key.recovery_milliseconds < 0) {
  throw new Error("key recovery evidence has invalid timing");
}

console.log("verify-recovery-evidence: passed (schema, scope, assertions, budgets, and key fingerprint validated)");
NODE
