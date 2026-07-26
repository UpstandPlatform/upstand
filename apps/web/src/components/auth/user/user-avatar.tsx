"use client";

import { useAuth, useSession } from "@better-auth-ui/react";
import { UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@upstand/ui/components/avatar";
import { Skeleton } from "@upstand/ui/components/skeleton";
import { cn } from "@upstand/ui/lib/utils";
import type { User } from "better-auth";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { PRESET_ICON_OPTIONS } from "@/lib/icon-utils";

export type UserAvatarProps = {
  className?: string;
  fallback?: ReactNode;
  isPending?: boolean;
  user?: User & { username?: string | null; displayUsername?: string | null };
};

export function UserAvatar({
  className,
  user,
  isPending,
  fallback,
}: UserAvatarProps) {
  const { authClient } = useAuth();
  const {
    data: session,
    isPending: sessionPending,
    error: sessionError,
  } = useSession(authClient, {
    enabled: !user && !isPending,
  });
  const [sessionTimedOut, setSessionTimedOut] = useState(false);

  useEffect(() => {
    if (!sessionPending) {
      setSessionTimedOut(false);
      return;
    }
    const timeout = setTimeout(() => setSessionTimedOut(true), 8_000);
    return () => clearTimeout(timeout);
  }, [sessionPending]);

  const loading =
    (isPending || sessionPending) && !user && !sessionError && !sessionTimedOut;

  if (loading) {
    return <Skeleton className={cn("size-8 rounded-full", className)} />;
  }

  const resolvedUser = user ?? session?.user;

  if (!resolvedUser) {
    return (
      fallback ?? (
        <Avatar
          className={cn(
            "size-8 rounded-full bg-muted text-foreground text-sm",
            className,
          )}
        >
          <AvatarFallback className="rounded-full text-muted-foreground!">
            <HugeiconsIcon icon={UserIcon} className="size-4" />
          </AvatarFallback>
        </Avatar>
      )
    );
  }

  const initials = (resolvedUser.name || resolvedUser.email)
    ?.slice(0, 2)
    .toUpperCase();

  const userImage = resolvedUser.image;
  const isImageSrc =
    userImage &&
    (userImage.startsWith("data:image/") ||
      userImage.startsWith("http://") ||
      userImage.startsWith("https://"));

  const preset = userImage?.startsWith("preset:")
    ? PRESET_ICON_OPTIONS.find((p) => p.id === userImage)
    : null;

  const PresetIcon = preset?.Icon;

  return (
    <Avatar
      className={cn(
        "size-8 rounded-full bg-muted text-foreground text-sm",
        className,
      )}
    >
      <AvatarImage
        className="rounded-full"
        src={isImageSrc ? userImage : undefined}
        alt=""
      />
      <AvatarFallback className="rounded-full text-muted-foreground!">
        {PresetIcon ? (
          <PresetIcon className="size-4 shrink-0 text-foreground" />
        ) : (
          initials || <HugeiconsIcon icon={UserIcon} className="size-4" />
        )}
      </AvatarFallback>
    </Avatar>
  );
}
