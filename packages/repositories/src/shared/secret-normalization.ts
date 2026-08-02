import {
  type EncryptedPayload,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ciphertext === "string" &&
    typeof candidate.iv === "string" &&
    typeof candidate.authTag === "string" &&
    typeof candidate.keyVersion === "number"
  );
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value === "") return false;
  try {
    return isEncryptedPayload(JSON.parse(value));
  } catch {
    return false;
  }
}

/** Encrypt legacy plaintext while preserving already encrypted values. */
export function normalizeStoredSecret(value: string): string;
export function normalizeStoredSecret(value: null): null;
export function normalizeStoredSecret(value: undefined): undefined;
export function normalizeStoredSecret(
  value: string | null | undefined,
): string | null | undefined;
export function normalizeStoredSecret(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined) return value;
  if (isEncryptedSecret(value)) return value;
  return JSON.stringify(encryptSecret(value));
}
