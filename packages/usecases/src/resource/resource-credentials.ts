import type { Resource } from "@upstand/domain";
import {
  decryptSecret,
  type EncryptedPayload,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";

export type ResourceCredentials = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!isRecord(value)) {
    return false;
  }
  const candidate: Record<string, unknown> = value;
  return (
    typeof candidate.ciphertext === "string" &&
    typeof candidate.iv === "string" &&
    typeof candidate.authTag === "string" &&
    typeof candidate.keyVersion === "number"
  );
}

function asCredentials(value: unknown): ResourceCredentials {
  return isRecord(value) ? value : {};
}

/**
 * Resource source/database/Compose credentials are one authenticated document
 * at rest. Legacy plaintext JSON and the previous database-only envelope are
 * accepted so existing resources remain deployable and are upgraded on write.
 */
export function parseResourceCredentials(
  value: string | null | undefined,
): ResourceCredentials {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isEncryptedPayload(parsed)) {
      return asCredentials(JSON.parse(decryptSecret(parsed)));
    }
    return asCredentials(parsed);
  } catch {
    return {};
  }
}

export function serializeResourceCredentials(
  value: string | ResourceCredentials | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isEncryptedPayload(parsed)) return value;
      return JSON.stringify(encryptSecret(value));
    } catch {
      return JSON.stringify(encryptSecret(value));
    }
  }
  return JSON.stringify(encryptSecret(JSON.stringify(asCredentials(value))));
}

export function resourceCredentialsJson(
  resource: Pick<Resource, "credentials">,
): string {
  return JSON.stringify(parseResourceCredentials(resource.credentials));
}
