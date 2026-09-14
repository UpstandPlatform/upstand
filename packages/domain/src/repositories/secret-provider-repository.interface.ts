import type { SecretProvider, SecretProviderType } from "../entities/secret";

export interface SecretProviderConfiguration {
  providerType?: SecretProviderType;
  address?: string;
  url?: string;
  token?: string;
  namespace?: string;
  mount?: string;
  path?: string;
  siteUrl?: string;
  clientId?: string;
  clientSecret?: string;
  projectId?: string;
  environmentSlug?: string;
  secretPath?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
  parameterPath?: string;
  serviceToken?: string;
  project?: string;
  config?: string;
  vaultUri?: string;
  tenantId?: string;
  apiUrl?: string;
  secretKey?: string;
  appId?: string;
  env?: string;
  vaultId?: string;
  itemId?: string;
  connectHost?: string;
  connectToken?: string;
}

export interface ISecretProviderRepository {
  findById(id: string): Promise<SecretProvider | null>;
  findEnabledConfiguration(
    id: string,
    organizationId: string,
  ): Promise<{
    provider: SecretProviderType;
    encryptedConfiguration: string;
  } | null>;
  findConfiguration(
    id: string,
    organizationId: string,
  ): Promise<{
    provider: SecretProviderType;
    encryptedConfiguration: string;
  } | null>;
  findByOrganizationId(organizationId: string): Promise<SecretProvider[]>;
  findEnabledConfigurationsByOrganizationId(organizationId: string): Promise<
    Array<{
      id: string;
      name: string;
      provider: SecretProviderType;
      encryptedConfiguration: string;
    }>
  >;
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
