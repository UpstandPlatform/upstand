import type {
  SecretProviderConfiguration,
  SecretProviderType,
} from "@upstand/domain";

export interface ExternalSecretProviderPort {
  read(
    provider: SecretProviderType,
    configuration: SecretProviderConfiguration,
  ): Promise<Record<string, string>>;
  readReferences?(
    provider: SecretProviderType,
    configuration: SecretProviderConfiguration,
    references: string[],
  ): Promise<Record<string, string>>;
  listSecretNames?(
    provider: SecretProviderType,
    configuration: SecretProviderConfiguration,
  ): Promise<string[]>;
  testConnection?(
    provider: SecretProviderType,
    configuration: SecretProviderConfiguration,
  ): Promise<{ success: boolean; message: string }>;
}
