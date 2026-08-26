#!/usr/bin/env bash
set -euo pipefail

key_file="${UPSTAND_ENCRYPTION_KEY_FILE:-}"
evidence_file="${UPSTAND_SECRET_KEY_RECOVERY_EVIDENCE_FILE:-}"
run_id="${UPSTAND_SECRET_KEY_RECOVERY_RUN_ID:-$(date -u +%Y%m%d%H%M%S)-$$}"

fail() {
  echo "secret-key-recovery-rehearsal: $*" >&2
  exit 1
}

[[ -n "$key_file" && -r "$key_file" ]] \
  || fail "UPSTAND_ENCRYPTION_KEY_FILE must point to a readable key file"
[[ -n "$evidence_file" ]] \
  || fail "UPSTAND_SECRET_KEY_RECOVERY_EVIDENCE_FILE is required"
evidence_parent="$(dirname -- "$evidence_file")"
[[ -d "$evidence_parent" ]] \
  || fail "evidence directory does not exist: $evidence_parent"

umask 077
node_output="$(node - "$key_file" "$run_id" <<'NODE'
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require("node:crypto");
const { readFileSync } = require("node:fs");

const keyFile = process.argv[2];
const runId = process.argv[3];
const key = Buffer.from(readFileSync(keyFile, "utf8").trim(), "base64");
if (key.length !== 32) throw new Error("encryption key must decode to exactly 32 bytes");
const plaintext = Buffer.from(`upstand-key-recovery:${runId}`, "utf8");
const started = performance.now();
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const authTag = cipher.getAuthTag();
const decipher = createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(authTag);
const recovered = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
if (!recovered.equals(plaintext)) throw new Error("recovered key sentinel does not match");
console.log(JSON.stringify({
  schema: "upstand.secret-key-recovery-rehearsal.v1",
  run_id: runId,
  completed_at: new Date().toISOString(),
  scope: "synthetic-disposable",
  result: "passed",
  algorithm: "aes-256-gcm",
  key_sha256: createHash("sha256").update(key).digest("hex"),
  recovery_milliseconds: Math.round(performance.now() - started),
}));
key.fill(0);
plaintext.fill(0);
recovered.fill(0);
NODE
)" || fail "authenticated encryption-key recovery probe failed"

printf '%s\n' "$node_output" > "$evidence_file"
echo "secret-key-recovery-rehearsal: passed (synthetic authenticated key recovery; evidence=$evidence_file)"
