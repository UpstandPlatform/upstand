"use client";

import {
  AiBrain01Icon,
  Briefcase01Icon,
  InformationCircleIcon,
  Key01Icon,
  Menu01Icon,
  Monitor,
  ShieldCheck,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@upstand/ui/components/breadcrumb";
import { Button } from "@upstand/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@upstand/ui/components/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@upstand/ui/components/sidebar";
import { cn } from "@upstand/ui/lib/utils";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { ApiKeysPanel } from "./components/api-keys-panel";
import { AppInfoPanel } from "./components/app-info-panel";
import { MembersPanel } from "./components/members-panel";
import { OrganizationPanel } from "./components/organization-panel";
import { ProfilePanel } from "./components/profile-panel";
import { SecurityPanel } from "./components/security-panel";
import { SessionsPanel } from "./components/sessions-panel";
import { UpGalSettingsPanel } from "./components/upgal-settings-panel";

type SettingsLeafItem = {
  name: string;
  label: string;
  icon: IconSvgElement;
  subItems?: never;
};

type SettingsGroupItem = {
  name: string;
  label: string;
  icon: IconSvgElement;
  subItems: Array<{ name: string; label: string }>;
};

type SettingsItem = SettingsLeafItem | SettingsGroupItem;

type SettingsGroup = {
  id: string;
  label: string;
  visible?: boolean;
  items: SettingsItem[];
};

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: activeOrg } = authClient.useActiveOrganization();

  useEffect(() => {
    const handleOpen = (e: Event) => {
      const customEvent = e as CustomEvent<{ page?: string }>;
      if (customEvent.detail?.page) {
        setActiveTab(customEvent.detail.page);
      }
      setOpen(true);
    };
    window.addEventListener("open-settings-dialog", handleOpen);
    return () => window.removeEventListener("open-settings-dialog", handleOpen);
  }, []);

  const groups: SettingsGroup[] = [
    {
      id: "user",
      label: "User Settings",
      items: [
        { name: "profile", label: "Profile", icon: UserIcon },
        { name: "sessions", label: "Sessions", icon: Monitor },
        { name: "security", label: "Security & 2FA", icon: ShieldCheck },
      ],
    },
    {
      id: "workspace",
      label: "Workspace Settings",
      visible: !!activeOrg,
      items: [
        { name: "organization", label: "Workspace", icon: Briefcase01Icon },
        { name: "members", label: "Members", icon: UserGroupIcon },
        { name: "api-keys", label: "API Keys", icon: Key01Icon },
        { name: "upgal", label: "UpGal Settings", icon: AiBrain01Icon },
      ],
    },
    {
      id: "system",
      label: "System",
      items: [{ name: "app", label: "About", icon: InformationCircleIcon }],
    },
  ];

  const getActiveTabLabel = () => {
    for (const group of groups) {
      if (group.visible === false) continue;
      for (const item of group.items) {
        if ("subItems" in item) {
          const match = item.subItems?.find((s) => s.name === activeTab);
          if (match) return match.label;
        } else if (item.name === activeTab) {
          return item.label;
        }
      }
    }
    return activeTab;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="h-dvh max-h-dvh w-screen max-w-none overflow-hidden rounded-none p-0! md:h-[min(90dvh,620px)] md:max-h-none md:w-[min(90vw,860px)] md:max-w-none md:rounded-2xl"
        >
          <DialogTitle className="sr-only">Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Manage your profile, sessions, workspace, and security settings.
          </DialogDescription>

          <SidebarProvider
            className="h-full items-start overflow-hidden"
            style={{ minHeight: 0 }}
          >
            {/* Desktop sidebar nav */}
            <Sidebar
              collapsible="none"
              className="hidden w-48 shrink-0 border-r md:flex"
            >
              <SidebarContent className="gap-3 py-2">
                {groups.map((group) => {
                  if (group.visible === false) return null;
                  return (
                    <SidebarGroup key={group.id} className="px-1 py-0">
                      <div className="px-2 py-1 font-bold text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                        {group.label}
                      </div>
                      <SidebarGroupContent>
                        <SidebarMenu>
                          {group.items.map((item) => {
                            if ("subItems" in item) {
                              return (
                                <SidebarMenuItem
                                  key={item.name}
                                  className="flex flex-col gap-1"
                                >
                                  <div className="flex items-center gap-2 px-3 py-1.5 font-semibold text-muted-foreground/80 text-xs">
                                    <HugeiconsIcon
                                      icon={item.icon}
                                      className="size-4"
                                    />
                                    <span>{item.label}</span>
                                  </div>
                                  <SidebarMenuSub className="ml-4 gap-1 border-l pl-3">
                                    {item.subItems?.map((subItem) => (
                                      <SidebarMenuSubItem key={subItem.name}>
                                        <SidebarMenuSubButton
                                          render={
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setActiveTab(subItem.name)
                                              }
                                            />
                                          }
                                          isActive={activeTab === subItem.name}
                                          className="h-7 text-xs"
                                        >
                                          <span>{subItem.label}</span>
                                        </SidebarMenuSubButton>
                                      </SidebarMenuSubItem>
                                    ))}
                                  </SidebarMenuSub>
                                </SidebarMenuItem>
                              );
                            }

                            return (
                              <SidebarMenuItem key={item.name}>
                                <SidebarMenuButton
                                  render={
                                    <button
                                      type="button"
                                      onClick={() => setActiveTab(item.name)}
                                    />
                                  }
                                  isActive={activeTab === item.name}
                                  tooltip={item.label}
                                  className="text-xs"
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
                  );
                })}
              </SidebarContent>
            </Sidebar>

            {/* Main content area */}
            <main className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
              <header className="flex h-12 shrink-0 items-center border-b px-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="md:hidden"
                  onClick={() => setMobileMenuOpen(true)}
                >
                  <HugeiconsIcon icon={Menu01Icon} />
                </Button>

                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbLink
                        href="#"
                        className="text-muted-foreground"
                      >
                        Settings
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{getActiveTabLabel()}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {activeTab === "profile" && <ProfilePanel />}
                {activeTab === "sessions" && <SessionsPanel />}
                {activeTab === "members" && <MembersPanel />}
                {activeTab === "api-keys" && <ApiKeysPanel />}
                {activeTab === "organization" && <OrganizationPanel />}
                {activeTab === "security" && <SecurityPanel />}
                {activeTab === "upgal" && <UpGalSettingsPanel />}
                {activeTab === "app" && <AppInfoPanel />}
              </div>
            </main>
          </SidebarProvider>
        </DialogContent>
      </Dialog>

      {/* Mobile sheet nav */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b px-4 py-4">
            <SheetTitle>Settings</SheetTitle>
            <SheetDescription>Choose a section to manage.</SheetDescription>
          </SheetHeader>
          <nav className="flex flex-col gap-3 p-2">
            {groups.map((group) => {
              if (group.visible === false) return null;
              return (
                <div key={group.id} className="flex flex-col gap-1">
                  <div className="px-3 py-1 font-bold text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    if ("subItems" in item) {
                      return (
                        <div key={item.name} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 px-3 py-1.5 font-semibold text-muted-foreground/80 text-xs">
                            <HugeiconsIcon
                              icon={item.icon}
                              className="size-4 shrink-0"
                            />
                            <span>{item.label}</span>
                          </div>
                          <div className="ml-4 flex flex-col gap-1 border-l pl-3">
                            {item.subItems?.map((subItem) => (
                              <button
                                key={subItem.name}
                                type="button"
                                onClick={() => {
                                  setActiveTab(subItem.name);
                                  setMobileMenuOpen(false);
                                }}
                                className={cn(
                                  "flex w-full items-center rounded-md px-3 py-1.5 text-left text-xs transition-colors",
                                  activeTab === subItem.name
                                    ? "bg-accent font-medium text-accent-foreground"
                                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                                )}
                              >
                                {subItem.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() => {
                          setActiveTab(item.name);
                          setMobileMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs transition-colors",
                          activeTab === item.name
                            ? "bg-accent font-medium text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )}
                      >
                        <HugeiconsIcon
                          icon={item.icon}
                          className="size-4 shrink-0"
                        />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
