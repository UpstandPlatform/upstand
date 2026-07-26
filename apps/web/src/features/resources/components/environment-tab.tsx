"use client";

import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyValueEditor } from "@/components/shared/key-value-editor";
import type { ResourceDetailState } from "../hooks/use-resource-detail";

interface EnvironmentTabProps {
  resource: NonNullable<ResourceDetailState["resource"]>;
  secrets: ResourceDetailState["secrets"];
  updateResource: ResourceDetailState["updateResource"];
  isUpdatingResource: boolean;
}

export function EnvironmentTab({
  resource,
  secrets,
  updateResource,
  isUpdatingResource,
}: EnvironmentTabProps) {
  const [envList, setEnvList] = useState<Array<{ key: string; value: string }>>(
    [],
  );
  const [buildEnvList, setBuildEnvList] = useState<
    Array<{ key: string; value: string }>
  >([]);
  const environmentVersion = JSON.stringify(secrets.envVars);
  const buildEnvironmentVersion = JSON.stringify(secrets.buildEnvVars ?? {});
  const managedEnvironment = resource?.managedEnvironment ?? {};
  const managedEntries = Object.entries(managedEnvironment);

  useEffect(() => {
    if (environmentVersion) {
      try {
        const parsed = JSON.parse(environmentVersion || "{}");
        setEnvList(
          Object.entries(parsed).map(([key, value]) => ({
            key,
            value: String(value),
          })),
        );
      } catch {
        setEnvList([]);
      }
    }
  }, [environmentVersion]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(buildEnvironmentVersion || "{}");
      setBuildEnvList(
        Object.entries(parsed).map(([key, value]) => ({
          key,
          value: String(value),
        })),
      );
    } catch {
      setBuildEnvList([]);
    }
  }, [buildEnvironmentVersion]);

  const saveEnvVars = () => {
    const obj: Record<string, string> = {};
    for (const item of envList) {
      if (item.key.trim()) {
        obj[item.key.trim()] = item.value;
      }
    }
    updateResource(
      { id: resource.id, envVars: JSON.stringify(obj) },
      {
        onSuccess: () =>
          toast.success("Environment variables saved successfully"),
      },
    );
  };

  const saveBuildEnvVars = () => {
    const obj: Record<string, string> = {};
    for (const item of buildEnvList) {
      if (item.key.trim()) obj[item.key.trim()] = item.value;
    }
    updateResource(
      { id: resource.id, buildEnvVars: JSON.stringify(obj) },
      {
        onSuccess: () =>
          toast.success("Build environment variables saved successfully"),
      },
    );
  };

  return (
    <Card className="border border-border/40 bg-card/20">
      <CardHeader>
        <CardTitle className="font-semibold text-lg">
          Environment Variables
        </CardTitle>
        <CardDescription className="text-muted-foreground text-sm">
          Define configuration variables injected into container processes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 border-border/20 border-t pt-4">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-primary text-xs leading-relaxed">
          <p className="mb-1 font-semibold text-sm">
            Tip: Reference project environment variables
          </p>
          You can reference shared project-level variables in your values using
          the syntax:
          <code className="mx-1 rounded border border-border/20 bg-background/50 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {"DATABASE_URL=$" + "{{project.DATABASE_URL}}"}
          </code>
          . These will be overridden with the actual value mapped in the
          environment settings during deployment.
        </div>

        {managedEntries.length > 0 ? (
          <div className="space-y-2 rounded-md border border-border/40 bg-muted/20 p-4">
            <div>
              <p className="font-medium text-sm">Managed database variables</p>
              <p className="text-muted-foreground text-xs">
                Upstand derives these from the database credentials. They are
                read-only here and are injected alongside the variables below.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {managedEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="flex min-w-0 items-center justify-between gap-3 rounded border border-border/30 bg-background/50 px-3 py-2"
                >
                  <span className="truncate font-medium font-mono text-xs">
                    {key}
                  </span>
                  <span className="font-mono text-muted-foreground text-xs">
                    {value ? "••••••••••••" : "Empty"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <KeyValueEditor
          value={envList}
          onChange={setEnvList}
          keyPlaceholder="VARIABLE_NAME"
          valuePlaceholder="Value…"
          addLabel="Add Environment Variable"
        />

        <div className="flex justify-end border-border/20 border-t pt-4">
          <Button
            onClick={saveEnvVars}
            disabled={isUpdatingResource}
            className="font-medium"
          >
            Save Configuration
          </Button>
        </div>

        {resource.type === "application" ? (
          <div className="space-y-4 border-border/20 border-t pt-5">
            <div>
              <h3 className="font-semibold text-sm">Build-only Variables</h3>
              <p className="mt-1 text-muted-foreground text-xs">
                Available to image builders, but never injected into the running
                container. Runtime variables remain available during builds for
                compatibility.
              </p>
            </div>
            <KeyValueEditor
              value={buildEnvList}
              onChange={setBuildEnvList}
              keyPlaceholder="BUILD_VARIABLE"
              valuePlaceholder="Value…"
              addLabel="Add Build Variable"
            />
            <div className="flex justify-end">
              <Button
                onClick={saveBuildEnvVars}
                disabled={isUpdatingResource}
                variant="outline"
                className="font-medium"
              >
                Save Build Variables
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
