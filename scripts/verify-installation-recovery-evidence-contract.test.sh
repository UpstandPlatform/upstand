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
  evidence_reference: "change-1234",
  recorded_at: new Date().toISOString(),
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

echo "verify-installation-recovery-evidence-contract: passed"
