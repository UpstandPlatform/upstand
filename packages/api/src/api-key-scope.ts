import { TRPCError } from "@trpc/server";

export type ApiKeyOrganizationRecord = {
  configId: string;
  referenceId: string;
};

/**
 * Keep key-management mutations bound to the organization selected by the
 * caller. Better Auth's update/delete APIs accept a key id, so the router must
 * establish this scope before delegating to them.
 */
export function assertApiKeyInOrganization(
  key: ApiKeyOrganizationRecord | undefined,
  organizationId: string,
): asserts key is ApiKeyOrganizationRecord {
  if (!key || key.referenceId !== organizationId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The API key is not part of this organization.",
    });
  }
}
