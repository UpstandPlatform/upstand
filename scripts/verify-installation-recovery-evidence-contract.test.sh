#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

node - "$TEMP_DIR" <<'NODE'
const { mkdirSync, writeFileSync } = require("node:fs");
const crypto = require("node:crypto");
const path = process.argv[2];
mkdirSync(path, { recursive: true });
const evidence = {
  schema: "upstand.installation-recovery-evidence.v1",
  scope: "installation",
  result: "passed",
  installation_id: "installation-001",
  backup_artifact_reference: "s3://backups/upstand/backup-2026-08-27.dump",
  restore_target: "isolated-restore-2026-08-27",
  release_ref: "v0.2.26",
  evidence_reference: "change-1234",
  recorded_at: new Date().toISOString(),
  backup_recovery_point: new Date(Date.now() - 300000).toISOString(),
  data_assertion: true,
  restore_verified: true,
  offsite_destination_verified: true,
  immutable_retention_verified: true,
  key_escrow_verified: true,
  measured_rpo_seconds: 300,
  measured_rto_seconds: 900,
  key_recovery_seconds: 30,
};
const canonicalize = (value) => Array.isArray(value)
  ? `[${value.map(canonicalize).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const keys = crypto.generateKeyPairSync("ed25519");
const signature = crypto.sign(null, Buffer.from(canonicalize(evidence)), keys.privateKey).toString("base64");
writeFileSync(`${path}/evidence.json`, JSON.stringify(evidence));
writeFileSync(`${path}/evidence.sig`, signature);
writeFileSync(`${path}/public.pem`, keys.publicKey.export({ type: "spki", format: "pem" }));
NODE

bash "$ROOT_DIR/scripts/verify-installation-recovery-evidence.sh" \
  "$TEMP_DIR/evidence.json" "$TEMP_DIR/evidence.sig" "$TEMP_DIR/public.pem" \
  change-1234 3600 1800 86400

node - "$TEMP_DIR" <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const crypto = require("node:crypto");
const path = process.argv[2];
const evidence = JSON.parse(readFileSync(`${path}/evidence.json`, "utf8"));
const canonicalize = (value) => Array.isArray(value)
  ? `[${value.map(canonicalize).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const keys = crypto.generateKeyPairSync("ed25519");
evidence.backup_recovery_point = new Date(Date.now() + 3600000).toISOString();
writeFileSync(`${path}/future-evidence.json`, JSON.stringify(evidence));
writeFileSync(`${path}/future-evidence.sig`, crypto.sign(null, Buffer.from(canonicalize(evidence)), keys.privateKey).toString("base64"));
writeFileSync(`${path}/future-public.pem`, keys.publicKey.export({ type: "spki", format: "pem" }));
NODE

if bash "$ROOT_DIR/scripts/verify-installation-recovery-evidence.sh" \
  "$TEMP_DIR/future-evidence.json" "$TEMP_DIR/future-evidence.sig" "$TEMP_DIR/future-public.pem" \
  change-1234 3600 1800 86400; then
  echo "verification unexpectedly accepted a future backup recovery point" >&2
  exit 1
fi

if bash "$ROOT_DIR/scripts/verify-installation-recovery-evidence.sh" \
  "$TEMP_DIR/evidence.json" "$TEMP_DIR/evidence.sig" "$TEMP_DIR/public.pem" \
  wrong-reference 3600 1800 86400; then
  echo "verification unexpectedly accepted a mismatched evidence reference" >&2
  exit 1
fi

if bash "$ROOT_DIR/scripts/verify-installation-recovery-evidence.sh" \
  "$TEMP_DIR/evidence.json" "$TEMP_DIR/evidence.sig" "$TEMP_DIR/public.pem" \
  change-1234 999999999999999999999999 1800 86400; then
  echo "verification unexpectedly accepted an unsafe RPO objective" >&2
  exit 1
fi

if bash "$ROOT_DIR/scripts/verify-installation-recovery-evidence.sh" \
  "$TEMP_DIR/evidence.json" "$TEMP_DIR/evidence.sig" "$TEMP_DIR/public.pem" \
  "" 3600 1800 86400; then
  echo "verification unexpectedly accepted an empty evidence reference" >&2
  exit 1
fi

node - "$TEMP_DIR" <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const crypto = require("node:crypto");
const path = process.argv[2];
const evidence = JSON.parse(readFileSync(`${path}/evidence.json`, "utf8"));
const canonicalize = (value) => Array.isArray(value)
  ? `[${value.map(canonicalize).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`
    : JSON.stringify(value);
for (const field of ["installation_id", "backup_artifact_reference", "restore_target", "release_ref"]) {
  const invalidEvidence = { ...evidence };
  delete invalidEvidence[field];
  const keys = crypto.generateKeyPairSync("ed25519");
  writeFileSync(`${path}/missing-${field}.json`, JSON.stringify(invalidEvidence));
  writeFileSync(`${path}/missing-${field}.sig`, crypto.sign(null, Buffer.from(canonicalize(invalidEvidence)), keys.privateKey).toString("base64"));
  writeFileSync(`${path}/missing-${field}.pem`, keys.publicKey.export({ type: "spki", format: "pem" }));
}
NODE

for field in installation_id backup_artifact_reference restore_target release_ref; do
  if bash "$ROOT_DIR/scripts/verify-installation-recovery-evidence.sh" \
    "$TEMP_DIR/missing-${field}.json" "$TEMP_DIR/missing-${field}.sig" "$TEMP_DIR/missing-${field}.pem" \
    change-1234 3600 1800 86400; then
    echo "verification unexpectedly accepted missing ${field}" >&2
    exit 1
  fi
done

echo "verify-installation-recovery-evidence-contract: passed"
