"use client";

import {
  AnalyticsUpIcon,
  Briefcase01Icon,
  CloudServerIcon,
  ContainerIcon,
  Folder01Icon,
  Rocket01Icon,
  Search01Icon,
  Shield01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@upstand/ui/components/command";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";

const QUICK_NAVIGATION = [
  {
    label: "Projects",
    description: "Applications and environments",
    href: "/projects",
    icon: Folder01Icon,
  },
  {
    label: "Deployments",
    description: "Deployment history and status",
    href: "/observation?tab=deployments",
    icon: Rocket01Icon,
  },
  {
    label: "Remote servers",
    description: "Hosts and connection settings",
    href: "/remote-servers",
    icon: CloudServerIcon,
  },
  {
    label: "Docker inventory",
    description: "Containers, images, and volumes",
    href: "/docker",
    icon: ContainerIcon,
  },
  {
    label: "Monitoring",
    description: "System health and metrics",
    href: "/monitoring",
    icon: AnalyticsUpIcon,
  },
] as const;

const SETTINGS_NAVIGATION = [
  { label: "Profile", page: "profile", icon: UserIcon },
  { label: "Workspace", page: "organization", icon: Briefcase01Icon },
  { label: "Security & 2FA", page: "security", icon: Shield01Icon },
] as const;

const RESULT_LABELS = {
  project: "Projects",
  environment: "Environments",
  resource: "Resources",
} as const;

export function GlobalSearch() {
  const router = useRouter();
  const organizationState = useRequiredActiveOrganization();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    if (!open) {
      setInput("");
      setQuery("");
    }
  }, [open]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const results = useQuery({
    ...trpc.search.global.queryOptions({
      organizationId: organizationState.organizationId as string,
      query: query || "_",
      limit: 30,
    }),
    enabled: open && organizationState.status === "ready" && query.length > 1,
  });

  const groupedResults = (results.data ?? []).reduce<
    Record<string, NonNullable<typeof results.data>>
  >((groups, result) => {
    const group = groups[result.type] ?? [];
    group.push(result);
    groups[result.type] = group;
    return groups;
  }, {});

  const normalizedInput = input.trim();
  const searchActive = normalizedInput.length > 1;
  const resultsReady =
    searchActive && normalizedInput === query && !results.isFetching;
  const searchPending = searchActive && !resultsReady;

  const closeSearch = () => {
    setOpen(false);
    setInput("");
    setQuery("");
  };

  const navigateTo = (href: string) => {
    closeSearch();
    router.push(href as Route);
  };

  const openSettings = (page: string) => {
    closeSearch();
    window.dispatchEvent(
      new CustomEvent("open-settings-dialog", { detail: { page } }),
    );
  };

  return (
    <>
      <button
        type="button"
        className="flex size-9 shrink-0 items-center justify-center gap-2 rounded-3xl border bg-input/40 px-0 text-muted-foreground text-sm hover:bg-accent lg:h-9 lg:w-56 lg:justify-start lg:px-3"
        onClick={() => setOpen(true)}
        aria-label="Open global search"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <HugeiconsIcon icon={Search01Icon} className="size-4 shrink-0" />
        <span className="hidden flex-1 truncate text-left lg:block">
          Search…
        </span>
        <kbd className="hidden rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] lg:block">
          ⌘K
        </kbd>
      </button>
      <CommandDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setOpen(true);
          else closeSearch();
        }}
        className="p-1"
        title="Global search"
        description="Search projects, environments, and resources."
      >
        <Command
          shouldFilter={false}
          className="rounded-none p-0 *:data-[slot=command-input-wrapper]:p-1"
        >
          <CommandInput
            value={input}
            onValueChange={setInput}
            placeholder="Search projects, environments, resources…"
          />
          <CommandList className="max-h-[min(60svh,28rem)] p-0 sm:max-h-96">
            {searchActive ? (
              <>
                <CommandEmpty>
                  {searchPending ? "Searching…" : "No matching resources."}
                </CommandEmpty>
                {resultsReady
                  ? (
                      Object.keys(RESULT_LABELS) as Array<
                        keyof typeof RESULT_LABELS
                      >
                    ).map((type) => {
                      const items = groupedResults[type];
                      if (!items?.length) return null;
                      return (
                        <CommandGroup key={type} heading={RESULT_LABELS[type]}>
                          {items.map((result) => (
                            <CommandItem
                              key={`${result.type}-${result.id}`}
                              value={`${result.name} ${result.subtitle}`}
                              onSelect={() => navigateTo(result.href)}
                            >
                              <HugeiconsIcon
                                icon={
                                  type === "resource"
                                    ? CloudServerIcon
                                    : Folder01Icon
                                }
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {result.name}
                              </span>
                              <span className="max-w-[45%] truncate text-muted-foreground text-xs">
                                {result.subtitle}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      );
                    })
                  : null}
              </>
            ) : (
              <>
                <CommandGroup heading="Jump to">
                  {QUICK_NAVIGATION.map((item) => (
                    <CommandItem
                      key={item.href}
                      value={`navigate ${item.label}`}
                      onSelect={() => navigateTo(item.href)}
                    >
                      <HugeiconsIcon icon={item.icon} />
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                      <span className="max-w-[52%] truncate text-muted-foreground text-xs">
                        {item.description}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandGroup heading="Settings">
                  {SETTINGS_NAVIGATION.map((item) => (
                    <CommandItem
                      key={item.page}
                      value={`settings ${item.label}`}
                      onSelect={() => openSettings(item.page)}
                    >
                      <HugeiconsIcon icon={item.icon} />
                      <span>{item.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
