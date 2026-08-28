import { type Resource, ValidationError } from "@upstand/domain";
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
      throw new ValidationError(
        "Stored application build secrets must be an object",
      );
    const validated = ResourceEnvironmentVariablesSchema.safeParse(parsed);
    if (!validated.success) {
      throw new ValidationError("Stored application build secrets are invalid");
    }
    return validated.data;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    // A persisted secret must never silently disappear. Treat malformed or
    // undecryptable data as a deployment error instead of selecting a build
    // path that runs without the configured credentials.
    throw new ValidationError("Stored application build secrets are invalid");
  }
}
