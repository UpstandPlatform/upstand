"use client";

import {
  Login01Icon,
  Logout01Icon,
  PlusSignIcon,
  Settings01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { buttonVariants } from "@upstand/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@upstand/ui/components/dropdown-menu";
import { useSidebar } from "@upstand/ui/components/sidebar";
import { cn } from "@upstand/ui/lib/utils";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { UserAvatar } from "./user-avatar";
import { UserView } from "./user-view";

export type UserButtonProps = {
  className?: string;
  align?: "center" | "end" | "start";
  sideOffset?: number;
};

export function UserButton({
  className,
  align = "end",
  sideOffset,
}: UserButtonProps) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleSignOut = async () => {
    setDropdownOpen(false);
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/");
        },
      },
    });
  };

  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({
            variant: "ghost",
            size: isCollapsed ? "default" : "lg",
          }),
          isCollapsed
            ? "mx-auto flex size-8 items-center justify-center rounded-md border border-border bg-background/50 p-0 hover:bg-background/80"
            : "flex h-auto w-full items-center justify-between gap-2 border border-border bg-background/50 py-2.5 font-normal hover:bg-background/80",
          className,
        )}
        disabled={isPending}
      >
        {isCollapsed ? (
          session?.user ? (
            <UserAvatar user={session.user} className="size-6" />
          ) : (
            <UserAvatar className="size-6" />
          )
        ) : (
          <>
            {session ? (
              <UserView hideSubtitle />
            ) : (
              <div className="flex items-center gap-2">
                <UserAvatar />
                <span className="font-medium text-sm">Account</span>
              </div>
            )}
            <HugeiconsIcon
              icon={UnfoldMoreIcon}
              className="size-5 shrink-0 text-muted-foreground"
            />
          </>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="min-w-56 max-w-[48svw]"
        sideOffset={sideOffset}
        align={align}
      >
        {session && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal text-sm">
                <UserView />
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}

        {session ? (
          <>
            <DropdownMenuItem
              onClick={() => {
                setDropdownOpen(false);
                window.dispatchEvent(
                  new CustomEvent("open-settings-dialog", {
                    detail: { page: "profile" },
                  }),
                );
              }}
            >
              <HugeiconsIcon
                icon={Settings01Icon}
                className="mr-2 size-5 text-muted-foreground"
              />
              Settings
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={handleSignOut} variant="destructive">
              <HugeiconsIcon icon={Logout01Icon} className="mr-2 size-5" />
              Sign Out
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem
              onClick={() => {
                setDropdownOpen(false);
                router.push("/login");
              }}
            >
              <HugeiconsIcon
                icon={Login01Icon}
                className="mr-2 size-5 text-muted-foreground"
              />
              Sign In
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={() => {
                setDropdownOpen(false);
                router.push("/login?signup=true");
              }}
            >
              <HugeiconsIcon
                icon={PlusSignIcon}
                className="mr-2 size-5 text-muted-foreground"
              />
              Create Account
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
