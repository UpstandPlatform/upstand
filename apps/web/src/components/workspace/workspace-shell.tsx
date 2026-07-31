"use client";

import {
  AppStoreIcon,
  ArrowDown01Icon,
  Briefcase01Icon,
  CloudServerIcon,
  Folder01Icon,
  Home01Icon,
  JobSearchIcon,
  Moon02Icon,
  Rocket01Icon,
  Settings01Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@upstand/ui/components/button";
import { Separator } from "@upstand/ui/components/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@upstand/ui/components/sidebar";
import { cn } from "@upstand/ui/lib/utils";
import type { Route } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { OrganizationSwitcher } from "@/components/auth/organization/organization-switcher";
import { UserButton } from "@/components/auth/user/user-button";
import { useSystemConfig } from "@/hooks/use-system-config";

const GlobalSearch = dynamic(
  () =>
    import("@/components/global-search").then((module) => module.GlobalSearch),
  { ssr: false },
);

type WorkspaceOrganization = {
  id: string;
  name: string;
};

type WorkspaceNavigationItem = {
  label: string;
  href: string;
  icon: typeof Home01Icon;
  capability?: "remoteServers" | "jobs";
};

const navigationGroups: ReadonlyArray<{
  label: string;
  items: readonly WorkspaceNavigationItem[];
}> = [
  {
    label: "Main",
    items: [
      { label: "Home", href: "/workspace", icon: Home01Icon },
      { label: "Projects", href: "/workspace/projects", icon: Folder01Icon },
      { label: "Apps", href: "/workspace/apps", icon: AppStoreIcon },
      {
        label: "Deployments",
        href: "/workspace/deployments",
        icon: Rocket01Icon,
      },
    ],
  },
  {
    label: "Settings",
    items: [
      {
        label: "Backups",
        href: "/workspace/backups",
        icon: Briefcase01Icon,
      },
      { label: "Settings", href: "/workspace/settings", icon: Settings01Icon },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      {
        label: "Servers",
        href: "/workspace/servers",
        icon: CloudServerIcon,
        capability: "remoteServers",
      },
      {
        label: "Jobs",
        href: "/workspace/jobs",
        icon: JobSearchIcon,
        capability: "jobs",
      },
    ],
  },
];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  return (
    <Button
      aria-label="Toggle theme"
      className="size-8 rounded-full"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      size="icon"
      variant="ghost"
    >
      <HugeiconsIcon icon={isDark ? Sun03Icon : Moon02Icon} />
    </Button>
  );
}

// function RuntimeStatus() {
//   const { capabilities, isPending } = useSystemConfig();
//   const mode = capabilities?.mode ?? "self-hosted";
//   const label =
//     mode === "desktop"
//       ? "Local Desktop"
//       : mode === "cloud"
//         ? "Cloud control plane"
//         : "Self-hosted";
//   return (
//     <Badge
//       className="hidden max-w-44 truncate rounded-full px-2.5 font-normal sm:inline-flex"
//       variant={isPending ? "outline" : "secondary"}
//       title={
//         isPending
//           ? "Loading control-plane capabilities"
//           : `Connected to ${label}`
//       }
//     >
//       <span
//         className={cn(
//           "mr-1.5 size-1.5 rounded-full bg-emerald-500",
//           isPending && "bg-amber-500",
//         )}
//       />
//       {isPending ? "Connecting…" : label}
//     </Badge>
//   );
// }

function WorkspaceSidebar() {
  const pathname = usePathname();
  const { capabilities } = useSystemConfig();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar className="border-none bg-card/80" collapsible="icon">
      <SidebarContent className="gap-5 px-2 py-4">
        {navigationGroups.map((group) => (
          <SidebarGroup className="p-0" key={group.label}>
            {!collapsed && (
              <SidebarGroupLabel className="px-3 text-[10px] uppercase tracking-widest">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items
                  .filter(
                    (item) =>
                      !item.capability || capabilities?.[item.capability],
                  )
                  .map((item) => {
                    const active =
                      pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          className={cn(
                            "h-10 rounded-xl px-3 text-sm",
                            active && "bg-accent text-accent-foreground",
                          )}
                          isActive={active}
                          render={(props) => {
                            const { children, ...linkProps } = props;
                            return (
                              <Link {...linkProps} href={item.href as Route}>
                                {children}
                              </Link>
                            );
                          }}
                          tooltip={item.label}
                        >
                          <HugeiconsIcon icon={item.icon} />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="gap-3 p-3">
        {!collapsed && (
          <Button
            className="h-10 w-full rounded-xl bg-linear-to-r from-amber-400 via-orange-500 to-rose-500 font-semibold text-white shadow-lg shadow-orange-500/15 hover:brightness-110"
            onClick={() => {
              window.location.assign("/workspace/projects");
            }}
          >
            <span className="text-lg">+</span>
            New Project
          </Button>
        )}
        <Separator />
        <OrganizationSwitcher
          className={cn("min-h-12 rounded-xl border-none", collapsed && "px-0")}
        />
        <UserButton className="rounded-xl border-none" />
      </SidebarFooter>
    </Sidebar>
  );
}

export function WorkspaceShell({
  activeOrganization,
  children,
}: {
  activeOrganization: WorkspaceOrganization | null | undefined;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const currentTitle =
    navigationGroups
      .flatMap((group) => group.items)
      .find(
        (item) =>
          item.href === pathname || pathname.startsWith(`${item.href}/`),
      )?.label ?? "Workspace";

  return (
    <SidebarProvider>
      <div className="flex h-svh w-full flex-col overflow-hidden bg-background">
        <div className="flex flex-1 overflow-hidden p-3">
          <WorkspaceSidebar />
          <SidebarInset className="min-w-0 overflow-hidden rounded-2xl bg-background">
            <header className="flex min-h-13 shrink-0 items-center gap-3 border-b px-4 sm:px-7">
              <SidebarTrigger />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-sm">
                  {currentTitle}
                </div>
                <div className="truncate text-muted-foreground text-xs">
                  {activeOrganization?.name ?? "Workspace"}
                </div>
              </div>
              <GlobalSearch />
              <ThemeToggle />
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className="hidden size-4 text-muted-foreground"
              />
            </header>
            <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-7">
              {children}
            </main>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}
