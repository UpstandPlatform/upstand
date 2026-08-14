import { Alert02Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@upstand/ui/components/alert-dialog";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Checkbox } from "@upstand/ui/components/checkbox";
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
import {
  type EnvironmentWorkflowDiff,
  useEnvironmentWorkflows,
} from "../hooks/use-environment-workflows";

type EnvironmentOption = {
  id: string;
  name: string;
};

function changeLabel(
  action: EnvironmentWorkflowDiff["resources"][number]["action"],
) {
  switch (action) {
    case "add":
      return "Only in source";
    case "remove":
      return "Only in target";
    case "update":
      return "Configuration differs";
    default:
      return "In sync";
  }
}

function DiffSummary({ diff }: { diff: EnvironmentWorkflowDiff }) {
  const changedResources = diff.resources.filter(
    (resource) => resource.changed,
  );
  const additions = changedResources.filter(
    (resource) => resource.action === "add",
  );
  const removals = changedResources.filter(
    (resource) => resource.action === "remove",
  );
  const updates = changedResources.filter(
    (resource) => resource.action === "update",
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-muted-foreground text-xs">Variable changes</p>
          <p className="font-semibold text-xl">{diff.variables.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-muted-foreground text-xs">Resources to update</p>
          <p className="font-semibold text-xl">{updates.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-muted-foreground text-xs">
            Resources needing review
          </p>
          <p className="font-semibold text-xl">
            {additions.length + removals.length}
          </p>
        </div>
      </div>

      {changedResources.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
          These environments are already in sync.
        </p>
      ) : (
        <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border p-3">
          {changedResources.map((resource) => (
            <div
              key={resource.key}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="min-w-0 truncate font-medium">
                {resource.key}
              </span>
              <Badge
                variant={resource.action === "update" ? "secondary" : "outline"}
              >
                {changeLabel(resource.action)}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EnvironmentWorkflowsCard({
  environmentId,
  environmentName,
  environments,
  inheritsVariables,
  isUpdatingInheritance,
  onToggleInheritance,
}: {
  environmentId: string;
  environmentName: string;
  environments: readonly EnvironmentOption[];
  inheritsVariables: boolean;
  isUpdatingInheritance: boolean;
  onToggleInheritance: () => void;
}) {
  const [diffDialogOpen, setDiffDialogOpen] = useState(false);
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const workflows = useEnvironmentWorkflows(environmentId);
  const target = environments.find(
    (environment) => environment.id === workflows.targetEnvironmentId,
  );

  const handleCompare = async () => {
    const nextDiff = await workflows.compare(workflows.targetEnvironmentId);
    if (nextDiff) setDiffDialogOpen(true);
  };

  const handlePromote = () => {
    if (!workflows.targetEnvironmentId) return;
    setIncludeSecrets(false);
    setPromoteDialogOpen(true);
  };

  const confirmPromote = () => {
    if (!workflows.targetEnvironmentId) return;
    workflows.promote.mutate(
      {
        sourceEnvironmentId: environmentId,
        targetEnvironmentId: workflows.targetEnvironmentId,
        includeResources: true,
        includeSecrets,
      },
      {
        onSuccess: () => {
          setPromoteDialogOpen(false);
          toast.success(
            `Promoted matching configuration to ${target?.name ?? "the target environment"}.`,
          );
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const hasReviewItems = workflows.diff?.resources.some(
    (resource) => resource.action === "add" || resource.action === "remove",
  );

  return (
    <>
      <Card className="border border-border/40 bg-card/20">
        <CardHeader>
          <CardTitle className="font-semibold text-lg">
            Environment workflows
          </CardTitle>
          <CardDescription>
            Compare this environment with another environment, then promote only
            matching resource configuration. Missing and target-only resources
            are never created or deleted automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 border-border/20">
          <div className="rounded-lg border bg-background/40 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-sm">
                  Shared variable inheritance
                </p>
                <p className="text-muted-foreground text-xs">
                  {inheritsVariables
                    ? "Deployments resolve variables from this environment and its parents."
                    : "Deployments use only variables defined directly here."}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleInheritance}
                disabled={isUpdatingInheritance}
              >
                {isUpdatingInheritance && <Spinner data-icon="inline-start" />}
                {inheritsVariables
                  ? "Disable inheritance"
                  : "Enable inheritance"}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Label htmlFor="environment-workflow-target">
                Target environment
              </Label>
              <p className="mt-1 text-muted-foreground text-xs">
                Compare before promoting so you can see exactly what will
                change.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={workflows.targetEnvironmentId}
                onValueChange={(value) =>
                  workflows.selectTargetEnvironment(value ?? "")
                }
                disabled={environments.length === 0}
              >
                <SelectTrigger
                  id="environment-workflow-target"
                  className="sm:w-72"
                >
                  <SelectValue placeholder="Choose a target environment" />
                </SelectTrigger>
                <SelectContent>
                  {environments
                    .filter((candidate) => candidate.id !== environmentId)
                    .map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={handleCompare}
                disabled={
                  !workflows.targetEnvironmentId || workflows.isComparing
                }
              >
                {workflows.isComparing && <Spinner data-icon="inline-start" />}
                Compare changes
              </Button>
              <Button
                onClick={handlePromote}
                disabled={
                  !workflows.targetEnvironmentId ||
                  workflows.promote.isPending ||
                  !workflows.diff
                }
              >
                Promote matching changes
              </Button>
            </div>
            {environments.length === 0 && (
              <p className="text-muted-foreground text-xs">
                This project has no other environment to compare with yet.
              </p>
            )}
            {workflows.compareError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
                <HugeiconsIcon
                  icon={Alert02Icon}
                  className="mt-0.5 size-4 shrink-0"
                />
                <span>{workflows.compareError}</span>
              </div>
            )}
            {workflows.diff && target && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <span>{environmentName}</span>
                  <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
                  <span>{target.name}</span>
                </div>
                <p className="mt-1 text-muted-foreground text-xs">
                  Review the comparison before promoting.{" "}
                  {hasReviewItems
                    ? "Some resources need manual follow-up because promotion never creates or removes resources."
                    : "Only matching resources will be updated."}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={diffDialogOpen} onOpenChange={setDiffDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Environment comparison</DialogTitle>
            <DialogDescription>
              Changes from {environmentName} to{" "}
              {target?.name ?? "the target environment"}. Values and secrets are
              never shown.
            </DialogDescription>
          </DialogHeader>
          {workflows.diff && <DiffSummary diff={workflows.diff} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiffDialogOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setDiffDialogOpen(false);
                handlePromote();
              }}
              disabled={
                !workflows.diff ||
                workflows.diff.resources.every((resource) => !resource.changed)
              }
            >
              Review promotion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={promoteDialogOpen} onOpenChange={setPromoteDialogOpen}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Promote matching configuration?</AlertDialogTitle>
            <AlertDialogDescription>
              This updates matching resources in{" "}
              {target?.name ?? "the target environment"}. It does not create
              missing resources or delete target-only resources.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {workflows.diff && <DiffSummary diff={workflows.diff} />}
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              checked={includeSecrets}
              onCheckedChange={(checked) => setIncludeSecrets(Boolean(checked))}
            />
            <span>
              <span className="font-medium">Include secrets</span>
              <span className="block text-muted-foreground text-xs">
                Copy encrypted environment and resource secrets for matching
                resources.
              </span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={workflows.promote.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={workflows.promote.isPending || !workflows.diff}
              onClick={confirmPromote}
            >
              {workflows.promote.isPending && (
                <Spinner data-icon="inline-start" />
              )}
              Confirm promotion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
