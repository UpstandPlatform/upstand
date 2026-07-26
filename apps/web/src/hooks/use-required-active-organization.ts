import { authClient } from "@/lib/auth-client";

export type ActiveOrganization = NonNullable<
  ReturnType<typeof authClient.useActiveOrganization>["data"]
>;

export type RequiredActiveOrganizationState =
  | {
      status: "loading";
      organization: null;
      organizationId: null;
    }
  | {
      status: "unavailable";
      organization: null;
      organizationId: null;
    }
  | {
      status: "ready";
      organization: ActiveOrganization;
      organizationId: string;
    };

export function getRequiredActiveOrganizationState({
  activeOrganization,
  organizations,
  activeOrganizationPending,
  organizationsPending,
}: {
  activeOrganization: ActiveOrganization | null | undefined;
  organizations: Array<unknown> | null | undefined;
  activeOrganizationPending: boolean;
  organizationsPending: boolean;
}): RequiredActiveOrganizationState {
  if (activeOrganizationPending || organizationsPending) {
    return { status: "loading", organization: null, organizationId: null };
  }

  if (activeOrganization?.id) {
    return {
      status: "ready",
      organization: activeOrganization,
      organizationId: activeOrganization.id,
    };
  }

  // The dashboard layout selects a default organization asynchronously. Keep
  // consumers in a loading state while that selection is settling instead of
  // making requests with an empty or otherwise synthetic organization ID.
  if (organizations && organizations.length > 0) {
    return { status: "loading", organization: null, organizationId: null };
  }

  return { status: "unavailable", organization: null, organizationId: null };
}

export function useRequiredActiveOrganization(): RequiredActiveOrganizationState {
  const { data: activeOrganization, isPending: activeOrganizationPending } =
    authClient.useActiveOrganization();
  const { data: organizations, isPending: organizationsPending } =
    authClient.useListOrganizations();

  return getRequiredActiveOrganizationState({
    activeOrganization,
    organizations,
    activeOrganizationPending,
    organizationsPending,
  });
}
