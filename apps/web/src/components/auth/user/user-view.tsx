"use client";

import { useAuth, useSession } from "@better-auth-ui/react";
import { Skeleton } from "@upstand/ui/components/skeleton";
import { cn } from "@upstand/ui/lib/utils";
import type { User } from "better-auth";
import { UserAvatar } from "./user-avatar";

export type UserViewProps = {
  className?: string;
  isPending?: boolean;
  hideSubtitle?: boolean;
  user?: Partial<User> & {
    username?: string | null;
    displayUsername?: string | null;
  };
};

export function UserView({
  className,
  isPending,
  hideSubtitle = false,
  user,
}: UserViewProps) {
  const { authClient } = useAuth();
  const { data: session, isPending: sessionPending } = useSession(authClient, {
    enabled: !user && !isPending,
  });

  const resolvedUser = user ?? session?.user;

  if ((isPending || sessionPending) && !user) {
    return (
      <div className={cn("flex min-w-0 items-center gap-2", className)}>
        <UserAvatar isPending />

        <div className="grid flex-1 gap-1 text-left text-sm">
          <Skeleton className="h-4 w-24" />

          {!hideSubtitle && <Skeleton className="h-3 w-32" />}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <UserAvatar user={resolvedUser as User | undefined} aria-hidden="true" />

      <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium text-foreground">
          {resolvedUser?.name || resolvedUser?.email}
        </span>

        {!hideSubtitle && resolvedUser?.name && (
          <span className="truncate text-muted-foreground text-xs">
            {resolvedUser?.email}
          </span>
        )}
      </div>
    </div>
  );
}
