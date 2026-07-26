"use client";

import { Briefcase01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@upstand/ui/components/avatar";
import { Skeleton } from "@upstand/ui/components/skeleton";
import { cn } from "@upstand/ui/lib/utils";
import type { Organization } from "better-auth/client";
import type { ComponentProps, CSSProperties, ReactNode } from "react";

export type OrganizationLogoSize = "sm" | "md" | "lg";

export type OrganizationLogoProps = {
  className?: string;
  fallback?: ReactNode;
  isPending?: boolean;
  organization?: Partial<Organization>;
  size?: OrganizationLogoSize;
};

const sizeClasses: Record<OrganizationLogoSize, string> = {
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
};

const fallbackTextClasses: Record<OrganizationLogoSize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
};

export function OrganizationLogo({
  className,
  fallback,
  isPending,
  organization,
  size = "sm",
  style,
  ...props
}: OrganizationLogoProps &
  Omit<ComponentProps<typeof Avatar>, "children" | "size" | "style"> & {
    style?: CSSProperties;
  }) {
  if (isPending && !organization) {
    return (
      <Skeleton className={cn(sizeClasses[size], className)} style={style} />
    );
  }

  const initials = organization?.name?.slice(0, 2).toUpperCase();
  const resolvedLogo = organization?.logo?.trim() || undefined;

  return (
    <Avatar
      className={cn(sizeClasses[size], className)}
      style={style}
      {...props}
    >
      <AvatarImage
        alt={organization?.name ?? "Organization"}
        src={resolvedLogo}
      />

      <AvatarFallback
        className={cn("text-muted-foreground!", fallbackTextClasses[size])}
      >
        {fallback || initials || (
          <HugeiconsIcon icon={Briefcase01Icon} className="size-4" />
        )}
      </AvatarFallback>
    </Avatar>
  );
}
