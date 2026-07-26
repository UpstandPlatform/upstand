"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@upstand/api/router";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import { Card, CardContent } from "@upstand/ui/components/card";
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
import {
  Bell,
  CheckCircle,
  Copy,
  Download,
  Eye,
  RefreshCw,
  RotateCw,
  Search,
  XCircle,
} from "@/components/huge-icons";
import { CodeBlock } from "@/components/shared/code-block";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { copyText, downloadJson } from "@/lib/browser";
import { trpc } from "@/utils/trpc";

function getDeliveryStatusBadge(status: string) {
  switch (status) {
    case "delivered":
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle className="size-3" /> Delivered
        </Badge>
      );
    case "failed":
    case "dead_letter":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="size-3" />{" "}
          {status === "dead_letter" ? "Dead Letter" : "Failed"}
        </Badge>
      );
    case "processing":
      return <Badge variant="outline">Processing</Badge>;
    default:
      return <Badge variant="secondary">Queued</Badge>;
  }
}

export function NotificationDeliveriesSubpage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [timespan, setTimespan] = useState<"24h" | "7d" | "30d">("30d");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  type DeliveryItem =
    inferRouterOutputs<AppRouter>["notification"]["deliveries"]["items"][number];
  const [selectedDelivery, setSelectedDelivery] = useState<DeliveryItem | null>(
    null,
  );

  const deliveriesQuery = useQuery({
    ...trpc.notification.deliveries.queryOptions({
      organizationId,
      timespan,
      status: status === "all" ? undefined : (status as never),
      search: search.trim() || undefined,
      page,
      pageSize,
    }),
    enabled: organizationState.status === "ready",
  });

  const retryMutation = useMutation({
    ...trpc.notification.retryDelivery.mutationOptions(),
    onSuccess: () => {
      toast.success("Notification delivery requeued for retry");
      void deliveriesQuery.refetch();
    },
    onError: (error) =>
      toast.error(error.message || "Failed to retry delivery"),
  });

  const data = deliveriesQuery.data;

  return (
    <div className="space-y-4">
      {/* Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <InputGroup className="w-full sm:w-64">
            <InputGroupAddon align="inline-start">
              <Search className="size-4 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search title or payload..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </InputGroup>

          <Select
            value={timespan}
            onValueChange={(val) => {
              setTimespan(val as "24h" | "7d" | "30d");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Timespan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Past 24 Hours</SelectItem>
              <SelectItem value="7d">Past 7 Days</SelectItem>
              <SelectItem value="30d">Past 30 Days</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={status}
            onValueChange={(val) => {
              if (val) setStatus(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="dead_letter">Dead Letter</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void deliveriesQuery.refetch()}
          disabled={deliveriesQuery.isFetching}
          className="gap-2"
        >
          <RefreshCw
            className={`size-3.5 ${deliveriesQuery.isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Deliveries Table */}
      <Card className="border-border/60">
        <CardContent className="p-0">
          {deliveriesQuery.isLoading ? (
            <TableSkeleton rows={6} />
          ) : (data?.items.length ?? 0) === 0 ? (
            <PageEmpty
              icon={Bell}
              title="No notification deliveries"
              description="No notification delivery history matches your selected search or filters."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Notification Title</TableHead>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items.map((delivery) => (
                    <TableRow
                      key={delivery.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setSelectedDelivery(delivery)}
                    >
                      <TableCell className="whitespace-nowrap font-mono text-muted-foreground text-xs tabular-nums">
                        {new Date(delivery.createdAt).toLocaleString()}
                      </TableCell>

                      <TableCell className="max-w-[240px]">
                        <div className="flex flex-col">
                          <span className="truncate font-semibold text-foreground text-sm">
                            {delivery.title}
                          </span>
                          <span className="truncate text-muted-foreground text-xs">
                            {delivery.message}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell className="whitespace-nowrap">
                        <Badge variant="outline" className="font-mono text-xs">
                          {delivery.event}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        {getDeliveryStatusBadge(delivery.status)}
                      </TableCell>

                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {delivery.attempts}
                      </TableCell>

                      <TableCell className="text-right">
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {(delivery.status === "failed" ||
                            delivery.status === "dead_letter") && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7 text-warning hover:text-warning"
                              title="Requeue / Retry Delivery"
                              disabled={retryMutation.isPending}
                              onClick={() =>
                                retryMutation.mutate({ id: delivery.id })
                              }
                            >
                              <RotateCw className="size-3.5" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-muted-foreground"
                            title="Inspect Details"
                            onClick={() => setSelectedDelivery(delivery)}
                          >
                            <Eye className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {data && data.items.length > 0 && (
            <PagePagination
              className="p-4"
              page={page}
              pageSize={pageSize}
              total={data.total}
              onPageChange={setPage}
            />
          )}
        </CardContent>
      </Card>

      {/* Delivery Inspection Sheet */}
      <Sheet
        open={Boolean(selectedDelivery)}
        onOpenChange={(open) => !open && setSelectedDelivery(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bell className="size-5 text-primary" />
              Delivery Inspection
            </SheetTitle>
            <SheetDescription>
              Full delivery state, attempt count, and error payload.
            </SheetDescription>
          </SheetHeader>

          {selectedDelivery && (
            <div className="flex flex-col gap-6 px-6 pb-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-muted/20 p-3 sm:col-span-2">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    Notification Title
                  </p>
                  <p className="font-semibold text-sm">
                    {selectedDelivery.title}
                  </p>
                </div>

                <div className="rounded-lg border bg-muted/20 p-3 sm:col-span-2">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    Message Body
                  </p>
                  <p className="whitespace-pre-wrap text-foreground text-sm">
                    {selectedDelivery.message}
                  </p>
                </div>

                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    Status
                  </p>
                  {getDeliveryStatusBadge(selectedDelivery.status)}
                </div>

                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    Event Type
                  </p>
                  <Badge variant="outline" className="font-mono">
                    {selectedDelivery.event}
                  </Badge>
                </div>

                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    Attempts
                  </p>
                  <p className="font-mono text-sm tabular-nums">
                    {selectedDelivery.attempts}
                  </p>
                </div>

                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    Created At
                  </p>
                  <p className="font-mono text-xs">
                    {new Date(selectedDelivery.createdAt).toLocaleString()}
                  </p>
                </div>

                {selectedDelivery.deliveredAt && (
                  <div className="rounded-lg border bg-muted/20 p-3 sm:col-span-2">
                    <p className="mb-1 font-medium text-muted-foreground text-xs">
                      Delivered At
                    </p>
                    <p className="font-mono text-success text-xs">
                      {new Date(selectedDelivery.deliveredAt).toLocaleString()}
                    </p>
                  </div>
                )}

                {selectedDelivery.error && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 sm:col-span-2">
                    <p className="mb-1 font-medium text-destructive text-xs">
                      Delivery Error
                    </p>
                    <pre className="whitespace-pre-wrap break-all font-mono text-destructive text-xs">
                      {selectedDelivery.error}
                    </pre>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-foreground text-sm">
                    Metadata & Payload
                  </h4>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 font-medium text-xs"
                      onClick={async () => {
                        await copyText(
                          JSON.stringify(
                            selectedDelivery.metadata ?? {},
                            null,
                            2,
                          ),
                        );
                        toast.success("Metadata copied to clipboard");
                      }}
                    >
                      <Copy className="size-3.5" /> Copy JSON
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 font-medium text-xs"
                      onClick={() => {
                        downloadJson(
                          selectedDelivery.metadata ?? {},
                          `delivery-${selectedDelivery.id}.json`,
                        );
                      }}
                    >
                      <Download className="size-3.5" /> Download
                    </Button>
                  </div>
                </div>
                <CodeBlock
                  code={JSON.stringify(
                    selectedDelivery.metadata ?? {},
                    null,
                    2,
                  )}
                  language="json"
                  filename="delivery-metadata.json"
                  className="max-h-[350px]"
                />
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
