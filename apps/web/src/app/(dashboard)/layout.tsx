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
  HierarchyIcon,
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
  SidebarHeader,
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
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CreateOrganizationDialog } from "@/components/auth/organization/create-organization-dialog";
import { OrganizationSwitcher } from "@/components/auth/organization/organization-switcher";
import { UserButton } from "@/components/auth/user/user-button";
import { GlobalSearch } from "@/components/global-search";
import { ModeToggle } from "@/components/mode-toggle";
import { ProjectsBreadcrumb } from "@/components/projects-breadcrumb";
import { UpGalChat } from "@/components/upgal-chat";
import { UpGalGuideOverlay } from "@/components/upgal-guide-overlay";
import { UpGalTarget } from "@/components/upgal-target";
import { SettingsDialog } from "@/features/settings";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

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
        title: "Remote Servers",
        href: "/remote-servers",
        icon: CloudServerIcon,
      },
      { title: "SSH Keys", href: "/ssh-keys", icon: Key01Icon },
      { title: "Docker Swarm", href: "/docker-swarm", icon: Network },
      { title: "Topology", href: "/topology", icon: HierarchyIcon },
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
}: {
  group: NavigationGroup;
  pathname: string;
  isCollapsed: boolean;
}) {
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");

  const content = (
    <SidebarGroupContent className={isCollapsed ? undefined : "mt-1"}>
      <SidebarMenu>
        {group.items.map((item: NavigationItem) => {
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

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/"
          aria-label="Upstand home"
          className="flex items-center gap-2 px-1 font-bold text-sm tracking-tight"
        >
          <Image src="/brand/logo.svg" alt="" width={28} height={28} priority />
          <span className="group-data-[collapsible=icon]:hidden">Upstand</span>
        </Link>
      </SidebarHeader>

      <OrganizationSwitcher className="min-h-13.75 w-full border-none p-[11.5px]" />

      <Separator />

      <SidebarContent className="group-data-[collapsible=icon]:overflow-auto! flex flex-col gap-4 px-2 py-2">
        {NAVIGATION_GROUPS.map((group) => (
          <DashboardSidebarGroup
            key={group.title}
            group={group}
            isCollapsed={isCollapsed}
            pathname={pathname}
          />
        ))}
      </SidebarContent>

      <SidebarFooter>
        <UserButton className="w-full" />
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

function ChatWrapper({
  organizationId,
  pathname,
}: {
  organizationId: string | undefined;
  pathname: string;
}) {
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");

  const currentNav = getCurrentNavigationItem(pathname, currentTab);

  return (
    <UpGalChat organizationId={organizationId} pageTitle={currentNav?.title} />
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const {
    data: activeOrg,
    isPending: activeOrgPending,
    refetch: refetchActiveOrg,
  } = authClient.useActiveOrganization();
  const { data: organizations, isPending: organizationsPending } =
    authClient.useListOrganizations();
  const [createOrgOpen, setCreateOrgOpen] = useState(false);

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
    if (session && organizations && organizations.length > 0 && !activeOrg) {
      const personal = organizations.find(
        (o) => o.metadata?.isPersonal || o.name.toLowerCase() === "personal",
      );
      const targetOrg = personal || organizations[0];
      authClient.organization
        .setActive({
          organizationId: targetOrg.id,
        })
        .then(() => {
          void refetchActiveOrg();
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
    if (sessionPending || mfaPending) return;
    if (!session && pathname !== "/2fa-verify") {
      router.push("/login");
      return;
    }
    if (session && mfaData && !mfaData.verified && pathname !== "/2fa-verify") {
      router.push("/2fa-verify");
    }
  }, [session, sessionPending, mfaData, mfaPending, pathname, router]);

  if (sessionPending || (session && mfaPending)) {
    return (
      <div className="flex h-svh items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground text-sm">
          <Spinner />
          <span className="text-sm">Checking authorization…</span>
        </div>
      </div>
    );
  }

  // 2FA challenge page — render without the sidebar shell
  if (pathname === "/2fa-verify") return <>{children}</>;

  return (
    <SidebarProvider>
      <div className="flex h-svh w-full overflow-hidden">
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
                    <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
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
      <CreateOrganizationDialog
        open={createOrgOpen}
        onOpenChange={setCreateOrgOpen}
      />
      <SettingsDialog />
      <Suspense fallback={null}>
        <ChatWrapper organizationId={activeOrg?.id} pathname={pathname} />
      </Suspense>
      <UpGalGuideOverlay />
    </SidebarProvider>
  );
}
