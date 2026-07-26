"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import { CardContent, CardHeader } from "@upstand/ui/components/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@upstand/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@upstand/ui/components/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@upstand/ui/components/table";
import { useState } from "react";
import { toast } from "sonner";
import { PageEmpty } from "@/components/dashboard/page-empty";
import { PagePagination } from "@/components/dashboard/page-pagination";
import { TableSkeleton } from "@/components/dashboard/page-skeleton";
import { Copy, Eye, FileClock, Search } from "@/components/huge-icons";
import { CodeBlock } from "@/components/shared/code-block";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { copyText } from "@/lib/browser";
import { trpc } from "@/utils/trpc";

function getActionBadgeVariant(
  action: string,
): "success" | "info" | "warning" | "destructive" | "outline" {
  switch (action) {
    case "create":
    case "start":
    case "restore":
    case "import":
    case "duplicate":
      return "success";
    case "deploy":
    case "run":
    case "reload":
    case "update":
    case "configure":
    case "rotate":
    case "invite":
    case "test":
      return "info";
    case "delete":
    case "revoke":
    case "failure":
      return "destructive";
    case "cancel":
    case "stop":
    case "logout":
      return "warning";
    default:
      return "outline";
  }
}

const ACTIONS = [
  "all",
  "read",
  "create",
  "update",
  "delete",
  "deploy",
  "cancel",
  "run",
  "start",
  "stop",
  "reload",
  "login",
  "logout",
  "failure",
  "invite",
  "revoke",
  "rotate",
  "test",
  "import",
  "restore",
  "duplicate",
  "configure",
];

const RESOURCE_TYPES = [
  "all",
  "project",
  "environment",
  "resource",
  "deployment",
  "user",
  "organization",
  "server",
  "ssh_key",
  "git_provider",
  "registry",
  "backup",
  "notification",
  "settings",
  "docker",
  "swarm",
  "session",
  "custom_role",
  "tag",
  "template",
  "certificate",
  "schedule",
  "domain",
  "application",
  "database",
  "compose",
  "port",
  "mount",
  "system",
];

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function AuditsSubpage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [resourceType, setResourceType] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const logs = useQuery({
    ...trpc.auditLog.list.queryOptions({
      organizationId,
      search: search.trim() || undefined,
      action: action === "all" ? undefined : (action as never),
      resourceType:
        resourceType === "all" ? undefined : (resourceType as never),
      page,
      pageSize,
    }),
    enabled: organizationState.status === "ready",
  });

  type AuditLogItem = Exclude<typeof logs.data, undefined>["items"][number];
  const [selectedItem, setSelectedItem] = useState<AuditLogItem | null>(null);

  return (
    <div className="space-y-4">
      <CardHeader className="gap-4 p-0 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <InputGroup className="w-full sm:w-64">
            <InputGroupAddon align="inline-start">
              <Search className="size-4 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search actor, resource, or IP..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </InputGroup>
          <Select
            value={action}
            onValueChange={(value) => {
              if (value) {
                setAction(value);
                setPage(1);
              }
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              {ACTIONS.map((item) => (
                <SelectItem key={item} value={item}>
                  {item === "all" ? "All actions" : item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={resourceType}
            onValueChange={(value) => {
              if (value) {
                setResourceType(value);
                setPage(1);
              }
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Resource" />
            </SelectTrigger>
            <SelectContent>
              {RESOURCE_TYPES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item === "all" ? "All resources" : item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {logs.isPending ? <TableSkeleton rows={6} /> : null}
        {!logs.isPending && (logs.data?.items.length ?? 0) === 0 ? (
          <PageEmpty
            icon={FileClock}
            title="No audit events found"
            description="No system activity matches your search query or selected action/resource filters."
          />
        ) : null}
        {(logs.data?.items.length ?? 0) > 0 ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target Entity</TableHead>
                  <TableHead className="hidden md:table-cell">
                    Route / IP
                  </TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Details</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.data?.items.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                    onClick={() => setSelectedItem(item)}
                  >
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs tabular-nums">
                      {dateFormatter.format(new Date(item.createdAt))}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-sm">
                          {item.actorName}
                        </span>
                        <span className="truncate text-muted-foreground text-xs">
                          {item.actorEmail}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getActionBadgeVariant(item.action)}>
                        {item.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[250px]">
                      <div className="flex min-w-0 flex-col gap-1.5 md:flex-row md:items-center">
                        <span className="w-fit shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs capitalize">
                          {item.resourceType}
                        </span>
                        {item.resourceName && (
                          <span
                            className="truncate font-medium text-sm"
                            title={item.resourceName}
                          >
                            {item.resourceName}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden max-w-[200px] md:table-cell">
                      <div className="flex min-w-0 flex-col">
                        <span
                          className="truncate font-mono text-muted-foreground text-xs"
                          title={item.route}
                        >
                          {item.route}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {item.ipAddress || "Not recorded"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Eye className="size-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
        {logs.data && logs.data.items.length > 0 && (
          <PagePagination
            className="mt-4 px-2"
            page={page}
            pageSize={pageSize}
            total={logs.data.total}
            onPageChange={setPage}
          />
        )}
      </CardContent>

      <Sheet
        open={Boolean(selectedItem)}
        onOpenChange={(open) => !open && setSelectedItem(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Audit Event Details</SheetTitle>
            <SheetDescription>
              Full audit payload, network origin, and metadata for this event.
            </SheetDescription>
          </SheetHeader>
          {selectedItem && (
            <div className="flex flex-col gap-6 px-6 pb-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    Actor Name
                  </p>
                  <p className="font-semibold text-sm">
                    {selectedItem.actorName}
                  </p>
                </div>
                <div className="group relative rounded-lg border bg-muted/20 p-3">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    Actor Email
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="select-all truncate text-sm">
                      {selectedItem.actorEmail}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await copyText(selectedItem.actorEmail);
                        toast.success("Actor email copied to clipboard");
                      }}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    Actor Role
                  </p>
                  <p className="font-medium text-sm">
                    {selectedItem.actorRole || "Unknown"}
                  </p>
                </div>
                <div className="group relative rounded-lg border bg-muted/20 p-3">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    IP Address
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-sm tabular-nums">
                      {selectedItem.ipAddress || "Not recorded"}
                    </p>
                    {selectedItem.ipAddress && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await copyText(selectedItem.ipAddress ?? "");
                          toast.success("IP address copied to clipboard");
                        }}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    Action
                  </p>
                  <Badge
                    variant={getActionBadgeVariant(selectedItem.action)}
                    className="mt-0.5"
                  >
                    {selectedItem.action}
                  </Badge>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    Resource Type
                  </p>
                  <p className="font-medium text-sm capitalize">
                    {selectedItem.resourceType}
                  </p>
                </div>
                {selectedItem.resourceName && (
                  <div className="rounded-lg border bg-muted/20 p-3 sm:col-span-2">
                    <p className="mb-1 font-medium text-muted-foreground text-xs">
                      Resource Identifier
                    </p>
                    <p className="break-all font-mono text-sm">
                      {selectedItem.resourceName}
                    </p>
                  </div>
                )}
                <div className="rounded-lg border bg-muted/20 p-3 sm:col-span-2">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    API Route / Path
                  </p>
                  <p className="break-all font-mono text-sm">
                    {selectedItem.route}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3 sm:col-span-2">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    Timestamp
                  </p>
                  <p className="font-mono text-sm">
                    {dateFormatter.format(new Date(selectedItem.createdAt))}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h4 className="font-semibold text-foreground text-sm">
                  Event Metadata
                </h4>
                <CodeBlock
                  code={JSON.stringify(selectedItem.metadata ?? {}, null, 2)}
                  language="json"
                  filename="metadata.json"
                  className="max-h-87.5"
                />
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
