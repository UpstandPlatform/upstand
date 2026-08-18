import { authClient } from "@/lib/auth-client";

type OrganizationCandidate = {
  id: string;
  name: string;
  metadata?: unknown;
};

export function selectInitialOrganization(
  organizations: readonly OrganizationCandidate[],
): OrganizationCandidate | undefined {
  return (
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
    }) ?? organizations[0]
  );
}

/** Select the account's personal workspace before the dashboard mounts. */
export async function bootstrapInitialOrganization(): Promise<boolean> {
  for (const delay of [0, 150, 400]) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      const result = await authClient.organization.list();
      const organizations = result.data ?? [];
      const target = selectInitialOrganization(organizations);
      if (!target) continue;

      const active = await authClient.organization.setActive({
        organizationId: target.id,
      });
      if (!active.error) return true;
    } catch {
      // The auth session and organization bootstrap can settle on different
      // ticks immediately after signup. A bounded retry handles that race.
    }
  }

  return false;
}
