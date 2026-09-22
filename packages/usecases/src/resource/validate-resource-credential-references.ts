import type { IUnitOfWork } from "@upstand/domain";
import { ValidationError } from "@upstand/domain";
import {
  parseResourceCredentialInput,
  parseResourceCredentialsStrict,
} from "./resource-credentials";

type CredentialReferenceRepositories = Pick<
  IUnitOfWork,
  "gitProviderRepository" | "sshKeyRepository"
>;

export function hasResourceCredentialReferences(
  credentials: string | null | undefined,
): boolean {
  const parsed = parseResourceCredentialsStrict(credentials);
  return (
    typeof parsed.githubAccount === "string" ||
    typeof parsed.sshKeyId === "string"
  );
}

export async function validateResourceCredentialReferences(
  repositories: CredentialReferenceRepositories,
  organizationId: string,
  credentials: string | null | undefined,
): Promise<void> {
  // Create/update requests carry the credential draft as plaintext JSON so it
  // can be encrypted exactly once at the persistence boundary. Stored
  // resource credentials remain encrypted and are still accepted here for
  // deployment, migration, and other server-side callers.
  const parsed = parseResourceCredentialInput(credentials);

  if (typeof parsed.githubAccount === "string") {
    const provider = await repositories.gitProviderRepository.findById(
      parsed.githubAccount,
    );
    if (!provider || provider.organizationId !== organizationId) {
      throw new ValidationError(
        "Selected Git provider is not available to this organization",
      );
    }
  }

  if (typeof parsed.sshKeyId === "string") {
    const sshKey = await repositories.sshKeyRepository.findById(
      parsed.sshKeyId,
    );
    if (!sshKey || sshKey.organizationId !== organizationId) {
      throw new ValidationError(
        "Selected SSH key is not available to this organization",
      );
    }
  }
}
