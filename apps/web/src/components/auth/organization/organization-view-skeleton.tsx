"use client";

import { Skeleton } from "@upstand/ui/components/skeleton";
import { cn } from "@upstand/ui/lib/utils";
import type { ComponentProps } from "react";
import {
  OrganizationLogo,
  type OrganizationLogoSize,
} from "./organization-logo";

export type OrganizationViewSkeletonProps = {
  className?: string;
  hideSlug?: boolean;
  size?: OrganizationLogoSize;
};

export function OrganizationViewSkeleton({
  className,
  hideSlug,
  size = "md",
  ...props
}: OrganizationViewSkeletonProps & ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-w-0 items-center gap-2", className)}
      {...props}
    >
      <OrganizationLogo
        isPending
        className={size === "sm" ? "size-5" : undefined}
        size={size === "lg" ? "md" : "sm"}
      />

      <div className="flex min-w-0 flex-col gap-1">
        <Skeleton className="h-3.5 w-20 rounded-md" />

        {!hideSlug && <Skeleton className="h-3 w-28 rounded-md" />}
      </div>
    </div>
  );
}
