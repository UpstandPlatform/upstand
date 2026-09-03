"use client";

import { PlusSignIcon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { buttonVariants } from "@upstand/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@upstand/ui/components/dropdown-menu";
import { useSidebar } from "@upstand/ui/components/sidebar";
import { cn } from "@upstand/ui/lib/utils";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { persistActiveOrganizationId } from "@/lib/organization-bootstrap";
import { UserAvatar } from "../user/user-avatar";
import { UserView } from "../user/user-view";
import { OrganizationLogo } from "./organization-logo";
import { OrganizationView } from "./organization-view";

export type OrganizationSwitcherProps = {
  className?: string;
  align?: "center" | "end" | "start";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
};

export function OrganizationSwitcher({
  className,
  align = "start",
  side = "bottom",
  sideOffset,
}: OrganizationSwitcherProps) {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const {
    data: activeOrg,
    isPending: activeOrgPending,
    refetch: refetchActiveOrg,
  } = authClient.useActiveOrganization();
  const { data: organizations, isPending: organizationsPending } =
    authClient.useListOrganizations();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectionPendingId, setSelectionPendingId] = useState<string | null>(
    null,
  );
  const router = useRouter();

  const isPending =
    sessionPending || (!!session && (organizationsPending || activeOrgPending));

  const otherOrganizations =
    organizations?.filter((org) => org.id !== activeOrg?.id) ?? [];

  const handleSetActive = async (orgId: string) => {
    if (selectionPendingId) return;
    setDropdownOpen(false);
    setSelectionPendingId(orgId);
    try {
      const result = await authClient.organization.setActive({
        organizationId: orgId,
      });
      if (result.error) {
        throw new Error(
          result.error.message || "Unable to select organization",
        );
      }
      persistActiveOrganizationId(session?.user.id, orgId);
      await refetchActiveOrg();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to select organization",
      );
    } finally {
      setSelectionPendingId(null);
    }
  };

  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ variant: "ghost" }),
          isCollapsed
            ? "mx-auto flex size-8 items-center justify-center rounded-md border border-border bg-background/50 p-0 hover:bg-background/80"
            : "flex h-auto w-full items-center justify-between gap-2 border border-border bg-background/50 px-2 py-2 text-left hover:bg-background/80",
          className,
        )}
        disabled={!session || isPending}
      >
        {isCollapsed ? (
          isPending ? (
            <OrganizationLogo isPending size="sm" className="size-6" />
          ) : activeOrg ? (
            <OrganizationLogo
              organization={activeOrg}
              size="sm"
              className="size-6"
            />
          ) : session?.user ? (
            <UserAvatar user={session.user} className="size-6" />
          ) : (
            <OrganizationLogo
              organization={{ name: "Select Org" }}
              size="sm"
              className="size-6"
            />
          )
        ) : (
          <>
            {isPending ? (
              <OrganizationView isPending hideRole hideSlug />
            ) : activeOrg ? (
              <OrganizationView hideRole hideSlug organization={activeOrg} />
            ) : session ? (
              <UserView hideSubtitle />
            ) : (
              <OrganizationView
                hideRole
                hideSlug
                organization={{ name: "Select Org" }}
              />
            )}

            <HugeiconsIcon
              icon={UnfoldMoreIcon}
              className="size-5 shrink-0 text-muted-foreground"
            />
          </>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="min-w-64 max-w-svw"
      >
        {activeOrg ? (
          <div className="flex items-center justify-between gap-4 px-2 py-2">
            <OrganizationView hideRole hideSlug organization={activeOrg} />
          </div>
        ) : !isPending && session?.user ? (
          <div className="flex items-center justify-between gap-4 px-2 py-2">
            <UserView hideSubtitle />
          </div>
        ) : null}

        <DropdownMenuSeparator />

        {otherOrganizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => handleSetActive(org.id)}
            disabled={selectionPendingId !== null}
          >
            <OrganizationView hideRole hideSlug organization={org} />
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            setDropdownOpen(false);
            // Trigger can be handled by custom state in dashboard
            const event = new CustomEvent("open-create-org-dialog");
            window.dispatchEvent(event);
          }}
        >
          <HugeiconsIcon
            icon={PlusSignIcon}
            className="mr-2 size-5 text-muted-foreground"
          />
          Create Organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
