import type { SecretScopeType, SecretVersion } from "../entities/secret";

export type SecretVersionPayload = {
  scopeType: SecretScopeType;
  scopeId: string;
  version: number;
  credentials?: string | null;
  buildSecrets?: string | null;
  buildEnvVars?: string | null;
  envVars: string;
  source?: string;
  createdBy?: string | null;
};

export interface ISecretVersionRepository {
  findByScope(
    scopeType: SecretScopeType,
    scopeId: string,
  ): Promise<SecretVersion[]>;
  findByScopeVersion(
    scopeType: SecretScopeType,
    scopeId: string,
    version: number,
  ): Promise<SecretVersionPayload | null>;
  append(payload: SecretVersionPayload): Promise<SecretVersion>;
}
