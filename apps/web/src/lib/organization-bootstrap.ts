import { authClient } from "@/lib/auth-client";

type OrganizationCandidate = {
  id: string;
  name: string;
  metadata?: unknown;
};

const ACTIVE_ORGANIZATION_STORAGE_KEY = "upstand.active-organization";

function getActiveOrganizationStorageKey(userId: string): string {
  return `${ACTIVE_ORGANIZATION_STORAGE_KEY}:${userId}`;
}

export function readPersistedActiveOrganizationId(
  userId: string | null | undefined,
): string | null {
  if (!userId || typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(getActiveOrganizationStorageKey(userId));
  } catch {
    return null;
  }
}

export function persistActiveOrganizationId(
  userId: string | null | undefined,
  organizationId: string,
): void {
  if (!userId || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      getActiveOrganizationStorageKey(userId),
      organizationId,
    );
  } catch {
    // Storage can be disabled by browser privacy settings. Better Auth's
    // server-side active-organization cookie remains the source of truth.
  }
}

export function selectInitialOrganization(
  organizations: readonly OrganizationCandidate[],
  preferredOrganizationId?: string | null,
): OrganizationCandidate | undefined {
  return (
    (preferredOrganizationId
      ? organizations.find(
          (organization) => organization.id === preferredOrganizationId,
        )
      : undefined) ??
    organizations.find((organization) => {
      const metadata = organization.metadata;
      return (
        Boolean(
          metadata &&
            typeof metadata === "object" &&
            "isPersonal" in metadata &&
            metadata.isPersonal === true,
        ) || organization.name.toLowerCase() === "personal"
      );
    }) ??
    organizations[0]
  );
}

/** Select the account's personal workspace before the dashboard mounts. */
export async function bootstrapInitialOrganization(
  userId?: string,
): Promise<boolean> {
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const session = await authClient.getSession().catch(() => null);
    resolvedUserId = session?.data?.user?.id;
  }

  const preferredOrganizationId =
    readPersistedActiveOrganizationId(resolvedUserId);

  for (const delay of [0, 150, 400]) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      const result = await authClient.organization.list();
      const organizations = result.data ?? [];
      const target = selectInitialOrganization(
        organizations,
        preferredOrganizationId,
      );
      if (!target) continue;

      const active = await authClient.organization.setActive({
        organizationId: target.id,
      });
      if (!active.error) {
        persistActiveOrganizationId(resolvedUserId, target.id);
        return true;
      }
    } catch {
      // The auth session and organization bootstrap can settle on different
      // ticks immediately after signup. A bounded retry handles that race.
    }
  }

  return false;
}
