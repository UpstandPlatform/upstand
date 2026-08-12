"use client";

import {
  Activity01Icon,
  ArrowRight01Icon,
  Certificate01Icon,
  CloudIcon,
  CloudServerIcon,
  ContainerIcon,
  Folder01Icon,
  GitBranchIcon,
  Key01Icon,
  LayoutTemplate,
  LockKeyIcon,
  Network,
  Notification01Icon,
  Package01Icon,
  ServerStack01Icon,
  ShieldCheck,
  Tag01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { getUpGalNavigationTarget } from "@upstand/api/ai/upgal-ui-targets";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@upstand/ui/components/breadcrumb";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@upstand/ui/components/collapsible";
import { Separator } from "@upstand/ui/components/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@upstand/ui/components/sidebar";
import { Spinner } from "@upstand/ui/components/spinner";
import type { Route } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { OrganizationSwitcher } from "@/components/auth/organization/organization-switcher";
import { UserButton } from "@/components/auth/user/user-button";
import { DashboardSharedFeatures } from "@/components/dashboard/dashboard-shared-features";
import { ModeToggle } from "@/components/mode-toggle";
import { ProjectsBreadcrumb } from "@/components/projects-breadcrumb";
import { UpGalTarget } from "@/components/upgal-target";
import { DesktopChrome } from "@/components/workspace/desktop-chrome";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { usePlatformCapabilities } from "@/hooks/use-platform-capabilities";
import { useSystemConfig } from "@/hooks/use-system-config";
import { authClient } from "@/lib/auth-client";
import { selectInitialOrganization } from "@/lib/organization-bootstrap";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

const GlobalSearch = dynamic(
  () =>
    import("@/components/global-search").then((module) => module.GlobalSearch),
  { ssr: false },
);

type NavigationPath = `/${string}`;
type NavigationItem = {
  title: string;
  href: NavigationPath;
  icon?: IconSvgElement;
  items?: readonly NavigationItem[];
};
type NavigationGroup = {
  title: string;
  items: readonly NavigationItem[];
};
type CollapsibleNavigationItem = NavigationItem & {
  icon: IconSvgElement;
  items: readonly NavigationItem[];
};

function isCollapsibleNavigationItem(
  item: NavigationItem,
): item is CollapsibleNavigationItem {
  return (
    item.icon !== undefined && item.items !== undefined && item.items.length > 0
  );
}

const NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  {
    title: "Workloads",
    items: [
      { title: "Projects", href: "/projects", icon: Folder01Icon },
      { title: "Templates", href: "/templates", icon: LayoutTemplate },
    ],
  },
  {
    title: "Infrastructure",
    items: [
      {
        title: "Topology",
        href: "/topology",
        icon: Network,
      },
      {
        title: "Remote Servers",
        href: "/remote-servers",
        icon: CloudServerIcon,
      },
      { title: "SSH Keys", href: "/ssh-keys", icon: Key01Icon },
      { title: "Docker Swarm", href: "/docker-swarm", icon: Network },
      { title: "Docker Inventory", href: "/docker", icon: ContainerIcon },
      {
        title: "Docker Registry",
        href: "/docker-registry",
        icon: Package01Icon,
      },
      { title: "Web Server", href: "/web-server", icon: ServerStack01Icon },
      { title: "Certificates", href: "/certificates", icon: Certificate01Icon },
    ],
  },
  {
    title: "Integrations",
    items: [
      { title: "Git Providers", href: "/git-providers", icon: GitBranchIcon },
      { title: "S3 Storage", href: "/s3-destinations", icon: CloudIcon },
      {
        title: "Secret Providers",
        href: "/secret-providers",
        icon: LockKeyIcon,
      },
      { title: "SCIM", href: "/settings/scim", icon: UserGroupIcon },
      { title: "Single Sign-On", href: "/settings/sso", icon: ShieldCheck },
    ],
  },
  {
    title: "Management",
    items: [
      {
        title: "Observation",
        href: "/observation",
        icon: Activity01Icon,
        items: [
          { title: "Audit Logs", href: "/observation?tab=audits" },
          { title: "Cron Jobs", href: "/observation?tab=cron-jobs" },
          { title: "Requests", href: "/observation?tab=requests" },
          { title: "Monitoring", href: "/observation?tab=monitoring" },
          {
            title: "Notification Deliveries",
            href: "/observation?tab=notification-deliveries",
          },
          { title: "Deployments", href: "/observation?tab=deployments" },
        ],
      },
      {
        title: "Notifications",
        href: "/notifications",
        icon: Notification01Icon,
      },
      { title: "Tags", href: "/tags", icon: Tag01Icon },
    ],
  },
];

const FLAT_NAVIGATION_ITEMS: NavigationItem[] = NAVIGATION_GROUPS.flatMap(
  (group) =>
    group.items.flatMap((item) =>
      item.items ? [item, ...item.items] : [item],
    ),
);

function getCurrentNavigationItem(
  pathname: string,
  currentTab: string | null,
): NavigationItem | undefined {
  return FLAT_NAVIGATION_ITEMS.find((item) => {
    if (item.href.includes("?")) {
      const [path, query] = item.href.split("?");
      const targetTab = new URLSearchParams(query).get("tab");
      return pathname === path && currentTab === targetTab;
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  });
}

function CollapsibleMenuItem({
  item,
  pathname,
  currentTab,
}: {
  item: CollapsibleNavigationItem;
  pathname: string;
  currentTab: string | null;
}) {
  const isChildActive = item.items.some((subItem: NavigationItem) => {
    if (subItem.href.includes("?")) {
      const [path, query] = subItem.href.split("?");
      const targetTab = new URLSearchParams(query).get("tab");
      return pathname === path && currentTab === targetTab;
    }
    return pathname === subItem.href || pathname.startsWith(`${subItem.href}/`);
  });

  const [isOpen, setIsOpen] = useState(isChildActive);

  // Sync state if active child changes
  useEffect(() => {
    if (isChildActive) {
      setIsOpen(true);
    }
  }, [isChildActive]);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="group/sub-collapsible w-full"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger
          render={
            <SidebarMenuButton
              isActive={isChildActive}
              tooltip={item.title}
              className="text-xs"
            >
              <HugeiconsIcon icon={item.icon} className="size-5!" />
              <span>{item.title}</span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                className="ml-auto size-3.5 transition-transform duration-200 group-data-open/sub-collapsible:rotate-90"
              />
            </SidebarMenuButton>
          }
        />
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.items.map((subItem: NavigationItem) => {
              const isSubActive = (() => {
                if (subItem.href.includes("?")) {
                  const [path, query] = subItem.href.split("?");
                  const targetTab = new URLSearchParams(query).get("tab");
                  return pathname === path && currentTab === targetTab;
                }
                return (
                  pathname === subItem.href ||
                  pathname.startsWith(`${subItem.href}/`)
                );
              })();

              return (
                <SidebarMenuSubItem key={subItem.title}>
                  <SidebarMenuSubButton
                    isActive={isSubActive}
                    className="text-xs!"
                    render={(props) => {
                      const { children, ...linkProps } = props;
                      return (
                        <Link {...linkProps} href={subItem.href as Route}>
                          {children}
                        </Link>
                      );
                    }}
                  >
                    <span>{subItem.title}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function DashboardSidebarGroup({
  group,
  pathname,
  isCollapsed,
  currentTab,
  isCloud,
  isInstanceOwner,
}: {
  group: NavigationGroup;
  pathname: string;
  isCollapsed: boolean;
  currentTab: string | null;
  isCloud: boolean;
  isInstanceOwner: boolean;
}) {
  const { capabilities } = usePlatformCapabilities();

  const filteredItems = group.items.filter((item) => {
    if (isCloud && item.href === "/web-server" && !isInstanceOwner)
      return false;
    if (isCloud && item.href === "/docker" && !isInstanceOwner) return false;
    if (capabilities) {
      if (item.href === "/docker" && capabilities.mode === "desktop")
        return false;
      if (item.href === "/web-server" && capabilities.mode === "desktop")
        return false;
      if (item.href === "/certificates" && !capabilities.acmeCertificates)
        return false;
      if (item.href === "/docker-swarm" && !capabilities.swarmManagement)
        return false;
      if (
        (item.href === "/settings/scim" || item.href === "/settings/sso") &&
        !capabilities.enterpriseScimSso
      ) {
        return false;
      }
    }
    return true;
  });

  const content = (
    <SidebarGroupContent className={isCollapsed ? undefined : "mt-1"}>
      <SidebarMenu>
        {filteredItems.map((item: NavigationItem) => {
          if (isCollapsibleNavigationItem(item)) {
            return (
              <CollapsibleMenuItem
                key={item.title}
                item={item}
                pathname={pathname}
                currentTab={currentTab}
              />
            );
          }

          if (item.icon === undefined) return null;

          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                render={(props) => {
                  const { children, ...linkProps } = props;
                  return (
                    <UpGalTarget
                      definition={getUpGalNavigationTarget(
                        item.href as `/${string}`,
                      )}
                    >
                      <Link {...linkProps} href={item.href as Route}>
                        {children}
                      </Link>
                    </UpGalTarget>
                  );
                }}
                isActive={
                  pathname === item.href || pathname.startsWith(`${item.href}/`)
                }
                tooltip={item.title}
                className="text-xs"
              >
                <HugeiconsIcon icon={item.icon} className="size-5!" />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroupContent>
  );

  if (isCollapsed) {
    return <SidebarGroup className="p-0">{content}</SidebarGroup>;
  }

  return (
    <Collapsible defaultOpen className="group">
      <SidebarGroup className="p-0">
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between px-3 py-1.5 font-bold text-[10px] text-muted-foreground/60 uppercase tracking-wider transition-colors hover:text-foreground">
          <span>{group.title}</span>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className="size-3.5 transition-transform duration-200 group-data-open:rotate-90"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>{content}</CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

function DashboardSidebar({ pathname }: { pathname: string }) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const currentTab = useSearchParams().get("tab");
  const { isCloud, isInstanceOwner } = useSystemConfig();

  return (
    <Sidebar className={cn("in-[.is-desktop]:pt-9")} collapsible="icon">
      <OrganizationSwitcher className="min-h-13.75 w-full rounded-none border-none p-[11.5px]" />

      <Separator />

      <SidebarContent className="group-data-[collapsible=icon]:overflow-auto! flex flex-col gap-4 px-2 py-2">
        {NAVIGATION_GROUPS.map((group) => (
          <DashboardSidebarGroup
            key={group.title}
            group={group}
            isCollapsed={isCollapsed}
            pathname={pathname}
            currentTab={currentTab}
            isCloud={isCloud}
            isInstanceOwner={isInstanceOwner}
          />
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t p-0">
        <UserButton className="w-full rounded-none border-none" />
      </SidebarFooter>
    </Sidebar>
  );
}

function BreadcrumbTitle({
  pathname,
  activeOrgName,
}: {
  pathname: string;
  activeOrgName: string;
}) {
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");

  const currentNav = getCurrentNavigationItem(pathname, currentTab);

  return (
    <BreadcrumbPage className="max-w-[min(48vw,16rem)] truncate">
      {currentNav?.title ?? activeOrgName}
    </BreadcrumbPage>
  );
}

export function DashboardLayout({
  children,
  variant = "legacy",
}: {
  children: React.ReactNode;
  variant?: "legacy" | "workspace";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    data: session,
    isPending: sessionPending,
    refetch: refetchSession,
  } = authClient.useSession();
  const {
    data: activeOrg,
    isPending: activeOrgPending,
    refetch: refetchActiveOrg,
  } = authClient.useActiveOrganization();
  const { data: organizations, isPending: organizationsPending } =
    authClient.useListOrganizations();
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [sessionValidationPending, setSessionValidationPending] =
    useState(false);
  const [sessionValidationError, setSessionValidationError] = useState(false);
  const [sessionPendingTimedOut, setSessionPendingTimedOut] = useState(false);
  const sessionValidationInFlight = useRef(false);
  const organizationSelectionInFlight = useRef(false);

  useEffect(() => {
    if (!sessionPending) {
      setSessionPendingTimedOut(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSessionPendingTimedOut(true);
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [sessionPending]);

  useEffect(() => {
    const handler = () => setCreateOrgOpen(true);
    window.addEventListener("open-create-org-dialog", handler);
    return () => window.removeEventListener("open-create-org-dialog", handler);
  }, []);

  const { data: mfaData, isPending: mfaPending } = useQuery({
    ...trpc.auth.isSession2faVerified.queryOptions(),
    enabled: !!session,
    // Don't use stale data for security checks
    staleTime: 0,
  });

  useEffect(() => {
    if (sessionPending || organizationsPending || activeOrgPending) return;
    if (
      session &&
      organizations &&
      organizations.length > 0 &&
      !activeOrg &&
      !organizationSelectionInFlight.current
    ) {
      const targetOrg = selectInitialOrganization(organizations);
      if (!targetOrg) return;
      organizationSelectionInFlight.current = true;
      void authClient.organization
        .setActive({ organizationId: targetOrg.id })
        .then(() => refetchActiveOrg())
        .catch(() => undefined)
        .finally(() => {
          organizationSelectionInFlight.current = false;
        });
    }
  }, [
    session,
    sessionPending,
    organizations,
    organizationsPending,
    activeOrg,
    activeOrgPending,
    refetchActiveOrg,
  ]);

  useEffect(() => {
    if (
      (sessionPending && !sessionPendingTimedOut) ||
      pathname === "/2fa-verify" ||
      sessionValidationError
    )
      return;
    if (!session) {
      if (sessionValidationInFlight.current) return;

      sessionValidationInFlight.current = true;
      setSessionValidationPending(true);
      setSessionValidationError(false);
      let cancelled = false;

      void (async () => {
        let sessionRefreshStatus:
          | "authenticated"
          | "unauthenticated"
          | "unavailable" = "unavailable";
        for (const delay of [0, 150, 400]) {
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          try {
            const result = await Promise.race([
              authClient.getSession(),
              new Promise<undefined>((resolve) => {
                setTimeout(resolve, 5000);
              }),
            ]);
            if (result?.data) {
              sessionRefreshStatus = "authenticated";
              await Promise.race([
                refetchSession(),
                new Promise<void>((resolve) => {
                  setTimeout(resolve, 5000);
                }),
              ]);
              break;
            }

            // A response without data or an error is an explicit anonymous
            // session. Network errors, timeouts, and Better Auth errors must
            // remain retryable instead of forcing a logout during an outage.
            if (result && !result.error) {
              sessionRefreshStatus = "unauthenticated";
              break;
            }
          } catch {
            // Keep transient transport failures retryable.
          }
        }

        if (cancelled) return;
        sessionValidationInFlight.current = false;
        if (sessionRefreshStatus === "unauthenticated") {
          router.replace("/login");
          return;
        }
        setSessionValidationPending(false);
        if (sessionRefreshStatus === "unavailable") {
          setSessionValidationError(true);
        }
      })();

      return () => {
        cancelled = true;
        sessionValidationInFlight.current = false;
      };
    }

    if (mfaPending) return;

    if (session && mfaData && !mfaData.verified && pathname !== "/2fa-verify") {
      router.replace("/2fa-verify");
      return;
    }

    setSessionValidationPending(false);
  }, [
    session,
    sessionPending,
    sessionPendingTimedOut,
    sessionValidationError,
    mfaData,
    mfaPending,
    pathname,
    refetchSession,
    router,
  ]);

  if (
    (sessionPending && !sessionPendingTimedOut) ||
    sessionValidationPending ||
    (session && mfaPending)
  ) {
    return (
      <div className="flex h-svh items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground text-sm">
          <Spinner />
          <span className="text-sm">Checking authorization…</span>
        </div>
      </div>
    );
  }

  if (sessionValidationError) {
    return (
      <div className="flex h-svh items-center justify-center px-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center text-muted-foreground text-sm">
          <span>
            We couldn’t verify your session. Check the server connection and try
            again.
          </span>
          <button
            className="rounded-md border px-3 py-2 font-medium text-foreground text-sm hover:bg-muted"
            onClick={() => {
              setSessionValidationError(false);
              setSessionValidationPending(true);
            }}
            type="button"
          >
            Retry session check
          </button>
        </div>
      </div>
    );
  }

  // 2FA challenge page — render without the sidebar shell
  if (pathname === "/2fa-verify") return <>{children}</>;

  if (variant === "workspace") {
    return (
      <>
        <WorkspaceShell activeOrganization={activeOrg}>
          {children}
        </WorkspaceShell>
        <DashboardSharedFeatures
          organizationId={activeOrg?.id}
          createOrganizationOpen={createOrgOpen}
          onCreateOrganizationOpenChange={setCreateOrgOpen}
          pageTitle="Workspace"
        />
      </>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex h-svh w-full flex-col overflow-hidden">
        <DesktopChrome />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<div className="w-60 border-r bg-background" />}>
            <DashboardSidebar pathname={pathname} />
          </Suspense>

          <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2 sm:flex-nowrap sm:px-4 sm:py-0">
              <div className="flex min-w-0 items-center gap-2">
                <SidebarTrigger />
                <Breadcrumb className="min-w-0">
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden sm:inline-flex">
                      <BreadcrumbLink href="/dashboard">
                        Dashboard
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    {activeOrg && (
                      <>
                        <BreadcrumbSeparator />
                        {pathname === "/projects" ||
                        pathname.startsWith("/projects/") ? (
                          <ProjectsBreadcrumb
                            activeOrg={activeOrg}
                            pathname={pathname}
                          />
                        ) : (
                          <BreadcrumbItem>
                            <Suspense
                              fallback={
                                <BreadcrumbPage className="max-w-[min(48vw,16rem)] truncate">
                                  {activeOrg.name}
                                </BreadcrumbPage>
                              }
                            >
                              <BreadcrumbTitle
                                pathname={pathname}
                                activeOrgName={activeOrg.name}
                              />
                            </Suspense>
                          </BreadcrumbItem>
                        )}
                      </>
                    )}
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
                <GlobalSearch />
                <ModeToggle />
              </div>
            </header>

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
              {children}
            </div>
          </SidebarInset>
        </div>
      </div>
      <Suspense fallback={null}>
        <DashboardSharedFeatures
          organizationId={activeOrg?.id}
          createOrganizationOpen={createOrgOpen}
          onCreateOrganizationOpenChange={setCreateOrgOpen}
        />
      </Suspense>
    </SidebarProvider>
  );
}

export default DashboardLayout;
