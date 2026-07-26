import type { SecretProvider, SecretProviderType } from "../entities/secret";

export interface SecretProviderConfiguration {
  address?: string;
  token?: string;
  mount?: string;
  path?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  vaultId?: string;
  itemId?: string;
  connectHost?: string;
  connectToken?: string;
}

export interface ISecretProviderRepository {
  findById(id: string): Promise<SecretProvider | null>;
  findConfigurationById(id: string): Promise<{
    provider: SecretProviderType;
    encryptedConfiguration: string;
  } | null>;
  findByOrganizationId(organizationId: string): Promise<SecretProvider[]>;
  create(data: {
    id: string;
    organizationId: string;
    name: string;
    provider: SecretProviderType;
    encryptedConfiguration: string;
    enabled?: boolean;
  }): Promise<SecretProvider>;
  updateById(
    id: string,
    patch: {
      name?: string;
      encryptedConfiguration?: string;
      enabled?: boolean;
    },
  ): Promise<SecretProvider | null>;
  deleteById(id: string): Promise<boolean>;
}
