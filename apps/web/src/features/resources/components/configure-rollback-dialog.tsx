"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "@upstand/api/router";
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
import { Switch } from "@upstand/ui/components/switch";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  Layers,
} from "@/components/huge-icons";
import { trpc } from "@/utils/trpc";
import type { ResourceDetailState } from "../hooks/use-resource-detail";

interface ConfigureRollbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: NonNullable<ResourceDetailState["resource"]>;
  organizationId: string;
  onSuccess?: () => void;
}

export function ConfigureRollbackDialog({
  open,
  onOpenChange,
  resource,
  organizationId,
  onSuccess,
}: ConfigureRollbackDialogProps) {
  const [rollbackActive, setRollbackActive] = useState(false);
  const [rollbackRegistryId, setRollbackRegistryId] = useState("");

  const dockerRegistriesQuery = useQuery({
    ...trpc.dockerRegistry.list.queryOptions({ organizationId }),
    enabled: open && Boolean(organizationId),
  });

  const registries = dockerRegistriesQuery.data || [];
  const hasRegistries = registries.length > 0;

  useEffect(() => {
    if (open && resource) {
      setRollbackActive(resource.rollbackActive === true);
      setRollbackRegistryId(resource.rollbackRegistryId ?? "");
    }
  }, [open, resource]);

  const updateMutation = useMutation({
    ...trpc.resource.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Rollback configuration updated successfully");
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: TRPCClientErrorLike<AppRouter>) => {
      toast.error(error.message || "Failed to update rollback configuration");
    },
  });

  const handleSave = () => {
    if (rollbackActive && !rollbackRegistryId) {
      toast.error(
        "Please select a Docker registry to enable rollback functionality.",
      );
      return;
    }

    updateMutation.mutate({
      id: resource.id,
      rollbackActive,
      rollbackRegistryId: rollbackActive ? rollbackRegistryId : null,
    });
  };

  const handleToggleActive = (checked: boolean) => {
    if (checked && !hasRegistries) {
      toast.error(
        "No registries available. Please configure a registry first to enable rollbacks.",
      );
      return;
    }
    setRollbackActive(checked);
    if (checked && !rollbackRegistryId && registries[0]) {
      setRollbackRegistryId(registries[0].id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-5 text-primary" />
            Configure Rollback
          </DialogTitle>
          <DialogDescription>
            Configure automated service rollbacks and image retention settings
            for{" "}
            <span className="font-semibold text-foreground">
              {resource?.name}
            </span>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Storage & Cache Warning Banner */}
          <div className="space-y-2.5 rounded-lg border border-warning/30 bg-warning/10 p-3.5 text-warning text-xs">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <AlertTriangleIcon className="size-4 shrink-0 text-warning" />
              <span>Storage Usage & Cache Warning</span>
            </div>
            <p className="leading-relaxed">
              Having rollbacks enabled increases disk storage usage on your
              server because historical Docker image revisions are retained in
              your registry and server image cache.
            </p>
            <p className="font-medium leading-relaxed">
              ⚠️ <span className="underline">Important</span>: Manually cleaning
              the image or build cache may delete rollback images, making them
              unavailable for future rollbacks. Please exercise caution with
              this option.
            </p>
          </div>

          {/* Rollback Switch */}
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-4">
            <div className="space-y-1 pr-4">
              <Label
                htmlFor="rollback-active-switch"
                className="cursor-pointer font-medium text-sm"
              >
                Enable Rollback Feature
              </Label>
              <p className="text-muted-foreground text-xs">
                Rollbacks are disabled by default. Enable to allow reverting to
                previous deployment revisions.
              </p>
            </div>
            <Switch
              id="rollback-active-switch"
              checked={rollbackActive}
              onCheckedChange={handleToggleActive}
              disabled={!hasRegistries && !rollbackActive}
            />
          </div>

          {/* Registry Selection or No Registry Warning */}
          {!hasRegistries ? (
            <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs">
              <div className="font-medium text-destructive text-sm">
                No registries available
              </div>
              <p className="text-muted-foreground">
                Please configure a registry first to enable rollbacks. A Docker
                Registry is required to store historical build artifacts
                securely.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1 gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={() => {
                  onOpenChange(false);
                  window.location.href = "/docker-registry";
                }}
              >
                <span>Go to Docker Registry page</span>
                <ExternalLinkIcon className="size-3.5" />
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="rollback-registry-select" className="text-xs">
                Rollback Docker Registry{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Select
                value={rollbackRegistryId || (registries[0]?.id ?? "")}
                onValueChange={(val) => setRollbackRegistryId(val || "")}
                disabled={!rollbackActive}
              >
                <SelectTrigger id="rollback-registry-select">
                  <SelectValue placeholder="Select a Docker registry..." />
                </SelectTrigger>
                <SelectContent>
                  {registries.map((reg) => (
                    <SelectItem key={reg.id} value={reg.id}>
                      {reg.name} ({reg.registryUrl || "Docker Hub"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Credentials from this registry will be supplied to Swarm during
                rollback operations.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <>
                <Spinner data-icon="inline-start" />
                Saving…
              </>
            ) : (
              "Save Rollback Settings"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
