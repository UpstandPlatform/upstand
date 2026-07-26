"use client";

import { cn } from "@upstand/ui/lib/utils";
import type { Organization } from "better-auth/client";
import type { ComponentProps } from "react";
import { authClient } from "@/lib/auth-client";
import {
  OrganizationLogo,
  type OrganizationLogoSize,
} from "./organization-logo";
import { OrganizationViewSkeleton } from "./organization-view-skeleton";

export type OrganizationViewProps = {
  className?: string;
  isPending?: boolean;
  size?: OrganizationLogoSize;
  hideRole?: boolean;
  hideSlug?: boolean;
  organization?: Partial<Organization>;
};

export function OrganizationView({
  className,
  isPending,
  size = "md",
  hideSlug,
  hideRole = true,
  organization,
  ...props
}: OrganizationViewProps & ComponentProps<"div">) {
  const { data: activeOrg, isPending: activeOrgPending } =
    authClient.useActiveOrganization();

  const resolvedOrganization = (organization ?? activeOrg) || undefined;

  if (isPending || (!organization && activeOrgPending)) {
    return (
      <OrganizationViewSkeleton
        className={className}
        hideSlug={hideSlug}
        size={size}
        {...props}
      />
    );
  }

  return (
    <div
      className={cn("flex min-w-0 items-center gap-2", className)}
      {...props}
    >
      <OrganizationLogo
        organization={resolvedOrganization}
        className={size === "sm" ? "size-5" : undefined}
        size={size === "lg" ? "md" : "sm"}
        aria-hidden="true"
      />

      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate font-medium text-foreground text-sm leading-tight">
            {resolvedOrganization?.name}
          </p>
        </div>

        {!hideSlug && resolvedOrganization?.slug && (
          <p className="overflow-x-hidden truncate font-mono text-muted-foreground text-xs leading-tight">
            /{resolvedOrganization.slug}
          </p>
        )}
      </div>
    </div>
  );
}
