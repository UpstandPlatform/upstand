"use client";

import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@upstand/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/utils/trpc";

interface SecretSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  scopeType: "environment" | "resource";
  scopeId: string;
  onSuccess?: (syncedVars?: Record<string, string>) => void;
}

export function SecretSyncDialog({
  open,
  onOpenChange,
  organizationId,
  scopeType,
  scopeId,
  onSuccess,
}: SecretSyncDialogProps) {
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [merge, setMerge] = useState<boolean>(true);

  const { data: providers, isLoading: loadingProviders } = useQuery({
    ...trpc.secret.providers.queryOptions({ organizationId }),
    enabled: open && !!organizationId,
  });

  const activeProviders = providers?.filter((p) => p.enabled) ?? [];

  const syncMutation = useMutation({
    ...trpc.secret.sync.mutationOptions(),
    onSuccess: (data) => {
      const keysCount = Object.keys(data).length;
      toast.success(
        `Successfully synced ${keysCount} secret variable${keysCount === 1 ? "" : "s"} from external provider. Workload redeployment queued.`,
      );
      onOpenChange(false);
      onSuccess?.(data);
    },
    onError: (err) => {
      toast.error(
        err.message || "Failed to sync secrets from external provider",
      );
    },
  });

  const handleSync = () => {
    if (!selectedProviderId) {
      toast.error("Please select a secret provider");
      return;
    }

    syncMutation.mutate({
      providerId: selectedProviderId,
      scopeType,
      scopeId,
      merge,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={RefreshIcon} className="size-5 text-primary" />
            Sync External Secret Provider
          </DialogTitle>
          <DialogDescription>
            Fetch key-value secrets from your external secret engine (Vault, AWS
            Secrets Manager, 1Password) and inject them into this {scopeType}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loadingProviders ? (
            <div className="flex h-20 items-center justify-center">
              <Spinner />
            </div>
          ) : activeProviders.length === 0 ? (
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-center text-xs text-yellow-600 dark:text-yellow-400">
              No active secret providers configured for this organization. Go to{" "}
              <strong>Integrations → Secret Providers</strong> to add one.
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="sync-provider-select">
                  Select Secret Provider
                </Label>
                <Select
                  value={selectedProviderId}
                  onValueChange={(val) => setSelectedProviderId(val || "")}
                >
                  <SelectTrigger id="sync-provider-select" className="w-full">
                    <SelectValue placeholder="Choose provider..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeProviders.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.provider})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sync-mode-select">Import Mode</Label>
                <Select
                  value={merge ? "merge" : "overwrite"}
                  onValueChange={(val) => setMerge(val === "merge")}
                >
                  <SelectTrigger id="sync-mode-select" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="merge">
                      Merge with existing environment variables
                    </SelectItem>
                    <SelectItem value="overwrite">
                      Overwrite all current environment variables
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={syncMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSync}
            disabled={
              syncMutation.isPending ||
              !selectedProviderId ||
              activeProviders.length === 0
            }
          >
            {syncMutation.isPending && <Spinner className="mr-1.5 size-4" />}
            Sync & Apply Secrets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
