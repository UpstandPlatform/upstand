"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@upstand/ui/components/progress";
import { Spinner } from "@upstand/ui/components/spinner";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import { trpc } from "@/utils/trpc";

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
const preCutoverStatuses = new Set([
  "queued",
  "preflight",
  "transferring",
  "shadow-deploying",
  "validating",
]);

function statusVariant(status: string) {
  if (status === "completed") return "success" as const;
  if (status === "failed" || status === "cancelled") {
    return "destructive" as const;
  }
  if (status === "awaiting-confirmation") return "warning" as const;
  return "info" as const;
}

export function WorkloadMigrationStatusCard({
  organizationId,
  resourceId,
  serverNames,
}: {
  organizationId: string;
  resourceId: string;
  serverNames: ReadonlyMap<string, string>;
}) {
  const queryClient = useQueryClient();
  const [confirmCleanupOpen, setConfirmCleanupOpen] = useState(false);
  const lastPlacementRefreshStatus = useRef<string | null>(null);
  const input = { organizationId, resourceId };
  const migrationQuery = useQuery({
    ...trpc.server.getResourceWorkloadMigration.queryOptions(input),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && !terminalStatuses.has(status) ? 2_000 : false;
    },
  });
  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: trpc.server.getResourceWorkloadMigration.queryKey(input),
    });
  };
  const cancel = useMutation({
    ...trpc.server.cancelWorkloadMigration.mutationOptions(),
    onSuccess: async () => {
      toast.success("Migration cancellation requested");
      await invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const rollback = useMutation({
    ...trpc.server.rollbackWorkloadMigration.mutationOptions(),
    onSuccess: async () => {
      toast.success("Migration rollback queued");
      await invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const confirm = useMutation({
    ...trpc.server.confirmWorkloadMigration.mutationOptions(),
    onSuccess: async () => {
      setConfirmCleanupOpen(false);
      toast.success("Source cleanup completed");
      await invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const migration = migrationQuery.data;
  const migrationStatus = migration?.status;
  useEffect(() => {
    if (
      migrationStatus &&
      ["awaiting-confirmation", "completed"].includes(migrationStatus) &&
      lastPlacementRefreshStatus.current !== migrationStatus
    ) {
      lastPlacementRefreshStatus.current = migrationStatus;
      void queryClient.invalidateQueries({
        queryKey: trpc.resource.get.queryKey({ id: resourceId }),
      });
    }
  }, [migrationStatus, queryClient, resourceId]);

  if (migrationQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Workload migration</CardTitle>
          <CardDescription>
            Migration status could not be loaded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-destructive text-sm" role="alert">
            {migrationQuery.error.message}
          </p>
        </CardContent>
      </Card>
    );
  }
  if (!migration) return null;

  const mutationInput = { organizationId, migrationId: migration.id };
  const source =
    migration.sourceServerId === "local"
      ? "Local control plane"
      : (serverNames.get(migration.sourceServerId) ?? migration.sourceServerId);
  const target =
    serverNames.get(migration.targetServerId) ?? migration.targetServerId;
  const pending = cancel.isPending || rollback.isPending || confirm.isPending;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Workload migration</CardTitle>
          <CardDescription>
            {source} → {target}. Placement changes only after target validation
            and cutover.
          </CardDescription>
          <Badge variant={statusVariant(migration.status)}>
            {migration.status.replaceAll("-", " ")}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Progress value={migration.progress}>
            <ProgressLabel>Migration progress</ProgressLabel>
            <ProgressValue />
          </Progress>
          {migration.errorMessage ? (
            <p className="text-destructive text-sm" role="alert">
              {migration.errorCode}: {migration.errorMessage}
            </p>
          ) : null}
          {migration.status === "awaiting-confirmation" ? (
            <p className="text-muted-foreground text-sm">
              Traffic is on the target. The source remains intact until you
              explicitly confirm cleanup.
            </p>
          ) : null}
        </CardContent>
        {!terminalStatuses.has(migration.status) ? (
          <CardFooter className="flex flex-wrap justify-end gap-2">
            {preCutoverStatuses.has(migration.status) ? (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => cancel.mutate(mutationInput)}
              >
                {cancel.isPending ? <Spinner data-icon="inline-start" /> : null}
                Cancel migration
              </Button>
            ) : null}
            {["cutting-over", "awaiting-confirmation"].includes(
              migration.status,
            ) ? (
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => rollback.mutate(mutationInput)}
              >
                {rollback.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Roll back to source
              </Button>
            ) : null}
            {migration.status === "awaiting-confirmation" ? (
              <Button
                disabled={pending}
                onClick={() => setConfirmCleanupOpen(true)}
              >
                Confirm source cleanup
              </Button>
            ) : null}
          </CardFooter>
        ) : null}
      </Card>

      <ConfirmActionDialog
        open={confirmCleanupOpen}
        onOpenChange={setConfirmCleanupOpen}
        title="Remove the retained source workload?"
        description="This permanently removes the old source workload after the validated cutover. It cannot be used for rollback afterward."
        actionLabel="Remove source"
        pending={confirm.isPending}
        onConfirm={() =>
          confirm.mutate({ ...mutationInput, confirmCleanup: true })
        }
        requireConfirmText
        confirmText="CLEANUP"
      />
    </>
  );
}
