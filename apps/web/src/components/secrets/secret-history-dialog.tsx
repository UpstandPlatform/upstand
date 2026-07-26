"use client";

import { Clock01Icon, RotateLeftIcon } from "@hugeicons/core-free-icons";
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
import { Spinner } from "@upstand/ui/components/spinner";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/utils/trpc";

interface SecretHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopeType: "environment" | "resource";
  scopeId: string;
  onSuccess?: () => void;
}

export function SecretHistoryDialog({
  open,
  onOpenChange,
  scopeType,
  scopeId,
  onSuccess,
}: SecretHistoryDialogProps) {
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [compareVersion, setCompareVersion] = useState<number | null>(null);
  const [showValues, setShowValues] = useState(false);
  const { data: versions, isLoading } = useQuery({
    ...trpc.secret.versions.queryOptions({ scopeType, scopeId }),
    enabled: open,
  });

  useEffect(() => {
    const latest = versions?.[0]?.version ?? null;
    setSelectedVersion(latest);
    setCompareVersion(versions?.[1]?.version ?? null);
  }, [versions]);

  const selectedQuery = useQuery({
    ...trpc.secret.version.queryOptions({
      scopeType,
      scopeId,
      version: selectedVersion ?? 0,
    }),
    enabled: open && selectedVersion !== null,
  });
  const compareQuery = useQuery({
    ...trpc.secret.version.queryOptions({
      scopeType,
      scopeId,
      version: compareVersion ?? 0,
    }),
    enabled: open && compareVersion !== null,
  });

  const selectedVariables = useMemo(
    () => parseVariables(selectedQuery.data?.envVars),
    [selectedQuery.data?.envVars],
  );
  const compareVariables = useMemo(
    () => parseVariables(compareQuery.data?.envVars),
    [compareQuery.data?.envVars],
  );
  const comparison = useMemo(() => {
    const keys = [
      ...new Set([
        ...Object.keys(compareVariables),
        ...Object.keys(selectedVariables),
      ]),
    ].sort();
    return keys.map((key) => ({
      key,
      previous: compareVariables[key],
      selected: selectedVariables[key],
      changed: compareVariables[key] !== selectedVariables[key],
    }));
  }, [compareVariables, selectedVariables]);

  const restoreMutation = useMutation({
    ...trpc.secret.restore.mutationOptions(),
    onSuccess: () => {
      toast.success(
        "Secret version restored successfully. Redeployment queued.",
      );
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to restore secret version");
    },
  });

  const handleRestore = (versionNumber: number) => {
    restoreMutation.mutate({
      scopeType,
      scopeId,
      version: versionNumber,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={Clock01Icon} className="size-5 text-primary" />
            Secret Version History
          </DialogTitle>
          <DialogDescription>
            Select any snapshot to inspect its variables, compare it with
            another version, or restore it without deleting history.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : !versions || versions.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-xs">
              No version history logged for this {scopeType} yet.
            </div>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {versions.map((ver) => (
                <div
                  key={ver.id}
                  className={`flex items-center justify-between rounded-lg border p-3 text-xs ${selectedVersion === ver.version ? "border-primary bg-primary/5" : ""}`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">
                        Version {ver.version}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {ver.source}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Created {new Date(ver.createdAt).toLocaleString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant={
                        selectedVersion === ver.version
                          ? "secondary"
                          : "outline"
                      }
                      className="h-7 text-xs"
                      onClick={() => setSelectedVersion(ver.version)}
                    >
                      Inspect
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={restoreMutation.isPending}
                      onClick={() => handleRestore(ver.version)}
                    >
                      {restoreMutation.isPending ? (
                        <Spinner className="size-3" />
                      ) : (
                        <HugeiconsIcon
                          icon={RotateLeftIcon}
                          className="mr-1 size-3.5"
                        />
                      )}
                      Restore
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedVersion !== null && selectedQuery.data && (
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">
                    Version {selectedVersion} variables
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {Object.keys(selectedVariables).length} variable
                    {Object.keys(selectedVariables).length === 1 ? "" : "s"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowValues((value) => !value)}
                >
                  {showValues ? "Hide values" : "Show values"}
                </Button>
              </div>
              <VariableTable
                variables={selectedVariables}
                showValues={showValues}
              />
            </div>
          )}

          {versions &&
            versions.length > 1 &&
            selectedVersion !== null &&
            compareVersion !== null &&
            compareQuery.data && (
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">Compare versions</p>
                    <p className="text-muted-foreground text-xs">
                      {comparison.filter((entry) => entry.changed).length}{" "}
                      changed variable
                      {comparison.filter((entry) => entry.changed).length === 1
                        ? ""
                        : "s"}
                    </p>
                  </div>
                  <select
                    aria-label="Compare selected version with"
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    value={compareVersion}
                    onChange={(event) =>
                      setCompareVersion(Number(event.target.value))
                    }
                  >
                    {versions
                      .filter((version) => version.version !== selectedVersion)
                      .map((version) => (
                        <option key={version.version} value={version.version}>
                          Version {version.version}
                        </option>
                      ))}
                  </select>
                </div>
                <ComparisonTable
                  comparison={comparison}
                  showValues={showValues}
                />
              </div>
            )}
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

function parseVariables(
  value: string | null | undefined,
): Record<string, string> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function displayValue(value: string | undefined, showValues: boolean): string {
  if (value === undefined) return "—";
  return showValues ? value : "••••••••";
}

function VariableTable({
  variables,
  showValues,
}: {
  variables: Record<string, string>;
  showValues: boolean;
}) {
  const entries = Object.entries(variables).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return entries.length === 0 ? (
    <p className="rounded-md border border-dashed p-3 text-center text-muted-foreground text-xs">
      No variables in this version.
    </p>
  ) : (
    <div className="max-h-48 overflow-auto rounded-md border bg-background">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 border-b px-3 py-2 last:border-b-0"
        >
          <code className="truncate text-xs">{key}</code>
          <code className="truncate text-muted-foreground text-xs">
            {displayValue(value, showValues)}
          </code>
        </div>
      ))}
    </div>
  );
}

function ComparisonTable({
  comparison,
  showValues,
}: {
  comparison: Array<{
    key: string;
    previous?: string;
    selected?: string;
    changed: boolean;
  }>;
  showValues: boolean;
}) {
  return comparison.length === 0 ? (
    <p className="rounded-md border border-dashed p-3 text-center text-muted-foreground text-xs">
      Both versions are empty.
    </p>
  ) : (
    <div className="max-h-56 overflow-auto rounded-md border bg-background">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b bg-muted/30 px-3 py-2 font-medium text-[11px] text-muted-foreground">
        <span>Variable</span>
        <span>Compared</span>
        <span>Selected</span>
      </div>
      {comparison.map((entry) => (
        <div
          key={entry.key}
          className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b px-3 py-2 last:border-b-0 ${entry.changed ? "bg-warning/5" : ""}`}
        >
          <code className="truncate text-xs">{entry.key}</code>
          <code className="truncate text-muted-foreground text-xs">
            {displayValue(entry.previous, showValues)}
          </code>
          <code className="truncate text-xs">
            {displayValue(entry.selected, showValues)}
          </code>
        </div>
      ))}
    </div>
  );
}
