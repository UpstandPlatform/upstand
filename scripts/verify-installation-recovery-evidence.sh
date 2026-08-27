#!/usr/bin/env bash
set -euo pipefail

evidence_file="${1:-}"
signature_file="${2:-}"
public_key_file="${3:-}"
expected_reference="${4:-}"
max_rpo_seconds="${5:-}"
max_rto_seconds="${6:-}"
max_age_seconds="${7:-2592000}"

[[ -f "$evidence_file" && -r "$evidence_file" ]] || {
  echo "verify-installation-recovery-evidence: evidence file is required" >&2
  exit 1
}
[[ -f "$signature_file" && -r "$signature_file" ]] || {
  echo "verify-installation-recovery-evidence: signature file is required" >&2
  exit 1
}
[[ -f "$public_key_file" && -r "$public_key_file" ]] || {
  echo "verify-installation-recovery-evidence: public key file is required" >&2
  exit 1
}

node - "$evidence_file" "$signature_file" "$public_key_file" "$expected_reference" "$max_rpo_seconds" "$max_rto_seconds" "$max_age_seconds" <<'NODE'
const { readFileSync } = require("node:fs");
const crypto = require("node:crypto");

const [evidenceFile, signatureFile, publicKeyFile, expectedReference, maxRpo, maxRto, maxAge] = process.argv.slice(2);
const evidence = JSON.parse(readFileSync(evidenceFile, "utf8"));
const signature = readFileSync(signatureFile, "utf8").replace(/\s+/g, "");
const publicKey = crypto.createPublicKey(readFileSync(publicKeyFile, "utf8"));

const fail = (message) => { throw new Error(message); };
const finiteNonNegative = (value, name) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${name} must be a finite non-negative number`);
};
const positiveSafeInteger = (value, name) => {
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) fail(`${name} must be a positive safe integer`);
  return Number(value);
};
const boundedReference = (value, name) => {
  if (typeof value !== "string" || !/^[^\r\n]{1,256}$/.test(value.trim())) {
    fail(`${name} must be a non-empty bounded reference`);
  }
  return value.trim();
};
const canonicalize = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

if (evidence.schema !== "upstand.installation-recovery-evidence.v1" || evidence.scope !== "installation") {
  fail("installation recovery evidence schema or scope is invalid");
}
if (evidence.result !== "passed" || evidence.data_assertion !== true || evidence.restore_verified !== true) {
  fail("installation recovery evidence must record a passed data restore assertion");
}
boundedReference(evidence.installation_id, "installation_id");
boundedReference(evidence.backup_artifact_reference, "backup_artifact_reference");
boundedReference(evidence.restore_target, "restore_target");
boundedReference(evidence.release_ref, "release_ref");
for (const field of ["offsite_destination_verified", "immutable_retention_verified", "key_escrow_verified"]) {
  if (evidence[field] !== true) fail(`installation recovery evidence is missing ${field}`);
}
if (!/^[^\r\n]{1,256}$/.test(expectedReference) || typeof evidence.evidence_reference !== "string" || evidence.evidence_reference !== expectedReference) {
  fail("installation recovery evidence reference does not match the installed plan");
}
const recordedAt = Date.parse(evidence.recorded_at);
if (!Number.isFinite(recordedAt)) fail("installation recovery evidence has an invalid recorded_at timestamp");
const recoveryPoint = Date.parse(evidence.backup_recovery_point);
if (!Number.isFinite(recoveryPoint) || recoveryPoint > recordedAt + 300000) {
  fail("installation recovery evidence has an invalid or future backup_recovery_point");
}
const ageSeconds = (Date.now() - recordedAt) / 1000;
const maxAgeSeconds = positiveSafeInteger(maxAge, "maximum evidence age");
if (ageSeconds < -300 || ageSeconds > maxAgeSeconds) fail("installation recovery evidence is outside its freshness window");
for (const field of ["measured_rpo_seconds", "measured_rto_seconds", "key_recovery_seconds"]) finiteNonNegative(evidence[field], field);
const maxRpoSeconds = positiveSafeInteger(maxRpo, "configured RPO");
const maxRtoSeconds = positiveSafeInteger(maxRto, "configured RTO");
if (evidence.measured_rpo_seconds > maxRpoSeconds || evidence.measured_rto_seconds > maxRtoSeconds) {
  fail("installation recovery evidence exceeds the configured RPO or RTO");
}
if (publicKey.asymmetricKeyType !== "ed25519") fail("installation recovery evidence key must be Ed25519");
if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length > 4096) fail("installation recovery evidence signature is invalid");
if (!crypto.verify(null, Buffer.from(canonicalize(evidence), "utf8"), publicKey, Buffer.from(signature, "base64"))) {
  fail("installation recovery evidence signature verification failed");
}

console.log("verify-installation-recovery-evidence: passed (schema, freshness, objectives, assertions, and Ed25519 signature validated)");
NODE
