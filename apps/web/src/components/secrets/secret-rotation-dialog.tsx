"use client";

import {
  Clock01Icon,
  Delete02Icon,
  PlusSignIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import { Spinner } from "@upstand/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/utils/trpc";

interface SecretRotationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  scopeType: "environment" | "resource";
  scopeId: string;
  onSuccess?: () => void;
}

export function SecretRotationDialog({
  open,
  onOpenChange,
  organizationId,
  scopeType,
  scopeId,
  onSuccess,
}: SecretRotationDialogProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [keysInput, setKeysInput] = useState("");
  const [intervalHours, setIntervalHours] = useState(168); // 1 week default
  const [valueLength, setValueLength] = useState(32);
  const [rotateKeysInput, setRotateKeysInput] = useState("");

  const {
    data: schedules,
    isLoading,
    refetch,
  } = useQuery({
    ...trpc.secret.rotationSchedules.queryOptions({ scopeType, scopeId }),
    enabled: open,
  });

  const createScheduleMutation = useMutation({
    ...trpc.secret.createRotationSchedule.mutationOptions(),
    onSuccess: () => {
      toast.success("Secret rotation schedule created");
      setIsAdding(false);
      setKeysInput("");
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create rotation schedule");
    },
  });

  const deleteScheduleMutation = useMutation({
    ...trpc.secret.deleteRotationSchedule.mutationOptions(),
    onSuccess: () => {
      toast.success("Rotation schedule deleted");
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete schedule");
    },
  });

  const rotateNowMutation = useMutation({
    ...trpc.secret.rotate.mutationOptions(),
    onSuccess: (data) => {
      toast.success(
        `Rotated keys (${data.rotatedKeys.join(", ")}). Workload redeployment queued.`,
      );
      setRotateKeysInput("");
      onSuccess?.();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to rotate secrets");
    },
  });

  const handleCreateSchedule = (e: React.SyntheticEvent) => {
    e.preventDefault();
    const keys = keysInput
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (keys.length === 0) {
      toast.error("Please enter at least one variable key name to rotate");
      return;
    }

    createScheduleMutation.mutate({
      organizationId,
      scopeType,
      scopeId,
      keys,
      intervalHours,
      valueLength,
      enabled: true,
    });
  };

  const handleRotateOnDemand = () => {
    const keys = rotateKeysInput
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (keys.length === 0) {
      toast.error("Please enter variable key names to rotate");
      return;
    }

    rotateNowMutation.mutate({
      scopeType,
      scopeId,
      keys,
      length: valueLength,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={Clock01Icon} className="size-5 text-primary" />
            Secret Rotation & Schedules
          </DialogTitle>
          <DialogDescription>
            Configure automated recurring secret rotation or immediately trigger
            on-demand rotation for specific environment keys.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* On-Demand Rotation */}
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <h4 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              Immediate On-Demand Rotation
            </h4>
            <div className="space-y-2">
              <Label htmlFor="rotate-keys-input" className="text-xs">
                Key names to rotate (comma-separated)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="rotate-keys-input"
                  placeholder="e.g., API_SECRET_KEY, DB_PASSWORD"
                  value={rotateKeysInput}
                  onChange={(e) => setRotateKeysInput(e.target.value)}
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 shrink-0 text-xs"
                  disabled={
                    rotateNowMutation.isPending || !rotateKeysInput.trim()
                  }
                  onClick={handleRotateOnDemand}
                >
                  {rotateNowMutation.isPending ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <HugeiconsIcon
                      icon={RefreshIcon}
                      className="mr-1 size-3.5"
                    />
                  )}
                  Rotate Now
                </Button>
              </div>
            </div>
          </div>

          {/* Rotation Schedules Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                Automated Rotation Schedules
              </h4>
              {!isAdding && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setIsAdding(true)}
                >
                  <HugeiconsIcon
                    icon={PlusSignIcon}
                    className="mr-1 size-3.5"
                  />
                  New Schedule
                </Button>
              )}
            </div>

            {isAdding ? (
              <form
                onSubmit={handleCreateSchedule}
                className="space-y-3 rounded-lg border p-3"
              >
                <div className="space-y-1">
                  <Label htmlFor="schedule-keys" className="text-xs">
                    Target Variable Keys (comma-separated)
                  </Label>
                  <Input
                    id="schedule-keys"
                    placeholder="APP_SECRET, OAUTH_SECRET"
                    value={keysInput}
                    onChange={(e) => setKeysInput(e.target.value)}
                    required
                    className="h-8 text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="interval-hours" className="text-xs">
                      Interval (Hours)
                    </Label>
                    <Input
                      id="interval-hours"
                      type="number"
                      min={1}
                      max={8760}
                      value={intervalHours}
                      onChange={(e) =>
                        setIntervalHours(
                          Number.parseInt(e.target.value, 10) || 168,
                        )
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="value-length" className="text-xs">
                      Value Length (bytes)
                    </Label>
                    <Input
                      id="value-length"
                      type="number"
                      min={16}
                      max={128}
                      value={valueLength}
                      onChange={(e) =>
                        setValueLength(
                          Number.parseInt(e.target.value, 10) || 32,
                        )
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setIsAdding(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={createScheduleMutation.isPending}
                  >
                    {createScheduleMutation.isPending && (
                      <Spinner className="mr-1 size-3" />
                    )}
                    Save Schedule
                  </Button>
                </div>
              </form>
            ) : isLoading ? (
              <div className="flex h-16 items-center justify-center">
                <Spinner />
              </div>
            ) : !schedules || schedules.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center text-muted-foreground text-xs">
                No automatic rotation schedules configured for this {scopeType}.
              </div>
            ) : (
              <div className="space-y-2">
                {schedules.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border p-2.5 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium font-mono">
                          {s.keys.join(", ")}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          Every {s.intervalHours}h
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Last rotated:{" "}
                        {s.lastRotatedAt
                          ? new Date(s.lastRotatedAt).toLocaleString()
                          : "Never"}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-destructive hover:bg-destructive/10"
                      onClick={() =>
                        deleteScheduleMutation.mutate({ id: s.id })
                      }
                      disabled={deleteScheduleMutation.isPending}
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
