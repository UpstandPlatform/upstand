import {
  createCipheriv,
  createDecipheriv,
  randomBytes as cryptoRandomBytes,
} from "node:crypto";
import { env } from "@upstand/env/server";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const CURRENT_KEY_VERSION = 1;

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

function getMasterKey(keyVersion: number): Buffer {
  if (keyVersion !== 1) {
    throw new Error(`Unsupported encryption key version ${keyVersion}`);
  }
  let raw = env.ENCRYPTION_KEY_V1;
  if (!raw) {
    if (env.NODE_ENV === "test") {
      raw = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=";
    } else {
      throw new Error(
        "ENCRYPTION_KEY_V1 environment variable is missing. It must be a 32-byte base64-encoded string.",
      );
    }
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error("Encryption key must be 32 bytes, base64-encoded");
  return key;
}

export function encryptSecret(plaintext: string): EncryptedPayload {
  const key = getMasterKey(CURRENT_KEY_VERSION);
  const iv = cryptoRandomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptSecret(payload: EncryptedPayload): string {
  const key = getMasterKey(payload.keyVersion);
  const decipher = createDecipheriv(
    ALGO,
    key,
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
