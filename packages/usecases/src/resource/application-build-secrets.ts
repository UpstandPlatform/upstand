import type { Resource } from "@upstand/domain";
import {
  decryptSecret,
  type EncryptedPayload,
} from "@upstand/platform/crypto/secret-box";
import { ResourceEnvironmentVariablesSchema } from "./resource-environment";

export function getApplicationBuildSecrets(
  resource: Resource,
): Record<string, string> {
  if (!resource.buildSecrets) return {};
  try {
    const payload = JSON.parse(resource.buildSecrets) as Record<
      string,
      unknown
    >;
    const serialized =
      typeof payload.ciphertext === "string" &&
      typeof payload.iv === "string" &&
      typeof payload.authTag === "string"
        ? decryptSecret(payload as unknown as EncryptedPayload)
        : resource.buildSecrets;
    const parsed = JSON.parse(serialized) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const validated = ResourceEnvironmentVariablesSchema.safeParse(parsed);
    return validated.success ? validated.data : {};
  } catch {
    return {};
  }
}
