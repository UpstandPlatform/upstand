"use client";

import type { ResourceAdvancedConfig } from "@upstand/domain";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Switch } from "@upstand/ui/components/switch";
import { CodeEditor, CodeSurface } from "@/components/shared/code-editor";
import { type AdvancedCardProps, splitLines } from "./types";

// ──────────────────────────────────────────────────────────────────────────────
// Healthcheck & Deployment Card
// ──────────────────────────────────────────────────────────────────────────────

type UpdateConfig = ResourceAdvancedConfig["updateConfig"];
type RollbackConfig = ResourceAdvancedConfig["rollbackConfig"];
type Healthcheck = NonNullable<ResourceAdvancedConfig["healthcheck"]>;
type SmokeTest = NonNullable<ResourceAdvancedConfig["smokeTest"]>;
type Autoscaling = ResourceAdvancedConfig["autoscaling"];
type DeploymentStrategy = ResourceAdvancedConfig["deploymentStrategy"];

// ──────────────────────────────────────────────────────────────────────────────
// Update / Rollback shared sub-form
// ──────────────────────────────────────────────────────────────────────────────

type StrategyFormProps = {
  title: string;
  description: string;
  parallelism: number | undefined;
  delaySeconds: number | undefined;
  monitorSeconds: number | undefined;
  failureAction: string | undefined;
  failureOptions: Array<{ value: string; label: string }>;
  order: string | undefined;
  onParallelism: (v: number | undefined) => void;
  onDelay: (v: number | undefined) => void;
  onMonitor: (v: number | undefined) => void;
  onFailureAction: (v: string) => void;
  onOrder: (v: string) => void;
};

function StrategyForm({
  parallelism,
  delaySeconds,
  monitorSeconds,
  failureAction,
  failureOptions,
  order,
  onParallelism,
  onDelay,
  onMonitor,
  onFailureAction,
  onOrder,
}: StrategyFormProps) {
  const numericField = (
    placeholder: string,
    value: number | undefined,
    onChange: (v: number | undefined) => void,
  ) => (
    <Input
      type="number"
      min={0}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) =>
        onChange(e.target.value ? Number(e.target.value) : undefined)
      }
    />
  );

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {numericField("Parallelism", parallelism, onParallelism)}
      {numericField("Delay (s)", delaySeconds, onDelay)}
      {numericField("Monitor (s)", monitorSeconds, onMonitor)}

      <Select
        value={failureAction ?? "pause"}
        onValueChange={(v) => v && onFailureAction(v)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Failure action" />
        </SelectTrigger>
        <SelectContent>
          {failureOptions.map(({ value, label }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={order ?? "stop-first"}
        onValueChange={(v) => v && onOrder(v)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Order" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="stop-first">Stop first</SelectItem>
          <SelectItem value="start-first">Start first</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

const UPDATE_FAILURE_OPTIONS = [
  { value: "pause", label: "Pause" },
  { value: "continue", label: "Continue" },
  { value: "rollback", label: "Rollback" },
];

const ROLLBACK_FAILURE_OPTIONS = [
  { value: "pause", label: "Pause" },
  { value: "continue", label: "Continue" },
];

const HEALTHCHECK_TIMING_FIELDS: Array<{
  key: keyof Healthcheck;
  label: string;
  min: number;
}> = [
  { key: "intervalSeconds", label: "Interval (s)", min: 1 },
  { key: "timeoutSeconds", label: "Timeout (s)", min: 1 },
  { key: "retries", label: "Retries", min: 1 },
  { key: "startPeriodSeconds", label: "Start period (s)", min: 0 },
];

/**
 * Manages container healthcheck configuration and rolling update/rollback
 * strategies — two closely related deployment lifecycle concerns.
 */
export function HealthcheckDeploymentCard({
  config,
  resourceType,
  onChange,
}: AdvancedCardProps) {
  // ── Healthcheck helpers ──
  const updateHealthcheck = (partial: Partial<Healthcheck>) => {
    if (!config.healthcheck) return;
    onChange("healthcheck", { ...config.healthcheck, ...partial });
  };

  const updateSmokeTest = (partial: Partial<SmokeTest>) => {
    const current = config.smokeTest;
    if (!current) return;
    onChange("smokeTest", {
      enabled: current.enabled,
      type: current.type,
      target: current.target,
      expectedStatus: current.expectedStatus,
      timeoutSeconds: current.timeoutSeconds,
      retries: current.retries,
      ...partial,
    });
  };

  const onHealthcheckCommandChange = (raw: string) => {
    const command = splitLines(raw);
    if (command.length === 0) {
      onChange("healthcheck", null);
    } else {
      onChange("healthcheck", {
        command,
        intervalSeconds: config.healthcheck?.intervalSeconds ?? 30,
        timeoutSeconds: config.healthcheck?.timeoutSeconds ?? 5,
        retries: config.healthcheck?.retries ?? 3,
        startPeriodSeconds: config.healthcheck?.startPeriodSeconds ?? 10,
      });
    }
  };

  // ── Update config helpers ──
  const updateUpdateConfig = (partial: Partial<UpdateConfig>) =>
    onChange("updateConfig", { ...config.updateConfig, ...partial });

  const updateRollbackConfig = (partial: Partial<RollbackConfig>) =>
    onChange("rollbackConfig", { ...config.rollbackConfig, ...partial });
  const updateAutoscaling = (partial: Partial<Autoscaling>) =>
    onChange("autoscaling", { ...config.autoscaling, ...partial });
  const updateDeploymentStrategy = (partial: Partial<DeploymentStrategy>) =>
    onChange("deploymentStrategy", {
      ...config.deploymentStrategy,
      ...partial,
    });
  const updateReplication = (
    partial: Partial<ResourceAdvancedConfig["databaseReplication"]>,
  ) =>
    onChange("databaseReplication", {
      ...config.databaseReplication,
      ...partial,
    });
  const updatePreDeployHook = (
    partial: Partial<NonNullable<ResourceAdvancedConfig["preDeployHook"]>>,
  ) =>
    onChange("preDeployHook", {
      enabled: config.preDeployHook?.enabled ?? false,
      command: config.preDeployHook?.command ?? "",
      timeoutSeconds: config.preDeployHook?.timeoutSeconds ?? 300,
      ...partial,
    });
  const updatePostDeployHook = (
    partial: Partial<NonNullable<ResourceAdvancedConfig["postDeployHook"]>>,
  ) =>
    onChange("postDeployHook", {
      enabled: config.postDeployHook?.enabled ?? false,
      command: config.postDeployHook?.command ?? "",
      timeoutSeconds: config.postDeployHook?.timeoutSeconds ?? 300,
      onFailure: config.postDeployHook?.onFailure ?? "warn",
      ...partial,
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Health &amp; deployment</CardTitle>
        <CardDescription>
          Container healthcheck probe and the rolling-update and rollback
          strategies Swarm applies during and after deployments.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 border-t pt-5">
        {/* ── Healthcheck ── */}
        <Field>
          <FieldLabel>Healthcheck</FieldLabel>
          <FieldDescription>
            Configure the container health command and its timing. Clear the
            command to disable the healthcheck entirely.
          </FieldDescription>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
            <CodeSurface>
              <CodeEditor
                language="shell"
                height="90px"
                value={config.healthcheck?.command.join("\n") ?? ""}
                onChange={onHealthcheckCommandChange}
                aria-label="Healthcheck command"
              />
            </CodeSurface>

            {HEALTHCHECK_TIMING_FIELDS.map(({ key, label, min }) => (
              <Input
                key={key}
                type="number"
                min={min}
                placeholder={label}
                value={config.healthcheck?.[key] ?? ""}
                onChange={(e) => {
                  const value = e.target.value ? Number(e.target.value) : 0;
                  updateHealthcheck({ [key]: value });
                }}
                aria-label={label}
              />
            ))}
          </div>
        </Field>

        <Field>
          <FieldLabel>Deployment smoke test</FieldLabel>
          <FieldDescription>
            Verify the deployed endpoint after Swarm convergence. The check must
            pass before traffic switching completes.
          </FieldDescription>
          <FieldGroup className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Field orientation="horizontal" className="lg:col-span-4">
              <FieldContent>
                <FieldLabel htmlFor="advanced-smoke-test-enabled">
                  Enable smoke test
                </FieldLabel>
              </FieldContent>
              <Switch
                id="advanced-smoke-test-enabled"
                checked={config.smokeTest?.enabled ?? false}
                onCheckedChange={(enabled) =>
                  onChange(
                    "smokeTest",
                    enabled
                      ? {
                          target: config.smokeTest?.target || "",
                          type: config.smokeTest?.type ?? "http",
                          expectedStatus:
                            config.smokeTest?.expectedStatus ?? 200,
                          timeoutSeconds:
                            config.smokeTest?.timeoutSeconds ?? 10,
                          retries: config.smokeTest?.retries ?? 3,
                          enabled: true,
                        }
                      : null,
                  )
                }
              />
            </Field>
            {config.smokeTest?.enabled ? (
              <>
                <Select
                  value={config.smokeTest.type}
                  onValueChange={(type) =>
                    type && updateSmokeTest({ type: type as "http" | "tcp" })
                  }
                >
                  <SelectTrigger aria-label="Smoke test type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http">HTTP GET</SelectItem>
                    <SelectItem value="tcp">TCP connection</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={config.smokeTest.target}
                  onChange={(event) =>
                    updateSmokeTest({ target: event.target.value })
                  }
                  placeholder={
                    config.smokeTest.type === "http"
                      ? "https://app.example.com/health"
                      : "app.example.com:8080"
                  }
                  aria-label="Smoke test target"
                />
                <Input
                  type="number"
                  min={1}
                  max={120}
                  value={config.smokeTest.timeoutSeconds}
                  onChange={(event) =>
                    updateSmokeTest({
                      timeoutSeconds: Number(event.target.value) || 1,
                    })
                  }
                  placeholder="Timeout (s)"
                  aria-label="Smoke test timeout"
                />
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={config.smokeTest.retries}
                  onChange={(event) =>
                    updateSmokeTest({
                      retries: Number(event.target.value) || 1,
                    })
                  }
                  placeholder="Retries"
                  aria-label="Smoke test retries"
                />
                {config.smokeTest.type === "http" ? (
                  <Input
                    type="number"
                    min={100}
                    max={599}
                    value={config.smokeTest.expectedStatus}
                    onChange={(event) =>
                      updateSmokeTest({
                        expectedStatus: Number(event.target.value) || 200,
                      })
                    }
                    placeholder="Expected HTTP status"
                    aria-label="Expected HTTP status"
                  />
                ) : null}
              </>
            ) : null}
          </FieldGroup>
        </Field>

        {/* ── Rolling update + Rollback ── */}
        <FieldGroup className="grid gap-5 lg:grid-cols-2">
          <Field>
            <FieldLabel>Rolling update</FieldLabel>
            <FieldDescription>
              Control how Swarm replaces tasks during a deployment.
            </FieldDescription>
            <StrategyForm
              title="Rolling update"
              description=""
              parallelism={config.updateConfig.parallelism}
              delaySeconds={config.updateConfig.delaySeconds}
              monitorSeconds={config.updateConfig.monitorSeconds}
              failureAction={config.updateConfig.failureAction}
              failureOptions={UPDATE_FAILURE_OPTIONS}
              order={config.updateConfig.order}
              onParallelism={(v) => updateUpdateConfig({ parallelism: v })}
              onDelay={(v) => updateUpdateConfig({ delaySeconds: v })}
              onMonitor={(v) => updateUpdateConfig({ monitorSeconds: v })}
              onFailureAction={(v) =>
                updateUpdateConfig({
                  failureAction: v as UpdateConfig["failureAction"],
                })
              }
              onOrder={(v) =>
                updateUpdateConfig({ order: v as UpdateConfig["order"] })
              }
            />
          </Field>

          <Field>
            <FieldLabel>Rollback behaviour</FieldLabel>
            <FieldDescription>
              Define the fallback strategy when an update fails.
            </FieldDescription>
            <StrategyForm
              title="Rollback"
              description=""
              parallelism={config.rollbackConfig.parallelism}
              delaySeconds={config.rollbackConfig.delaySeconds}
              monitorSeconds={config.rollbackConfig.monitorSeconds}
              failureAction={config.rollbackConfig.failureAction}
              failureOptions={ROLLBACK_FAILURE_OPTIONS}
              order={config.rollbackConfig.order}
              onParallelism={(v) => updateRollbackConfig({ parallelism: v })}
              onDelay={(v) => updateRollbackConfig({ delaySeconds: v })}
              onMonitor={(v) => updateRollbackConfig({ monitorSeconds: v })}
              onFailureAction={(v) =>
                updateRollbackConfig({
                  failureAction: v as RollbackConfig["failureAction"],
                })
              }
              onOrder={(v) =>
                updateRollbackConfig({ order: v as RollbackConfig["order"] })
              }
            />
          </Field>
        </FieldGroup>

        {resourceType !== "database" && (
          <Field>
            <FieldLabel>Autoscaling</FieldLabel>
            <FieldDescription>
              Reconcile Swarm replicas from CPU, memory, request rate, or a
              custom monitoring metric.
            </FieldDescription>
            <div className="flex items-center gap-3">
              <Switch
                checked={config.autoscaling.enabled}
                onCheckedChange={(enabled) => updateAutoscaling({ enabled })}
              />
              <span className="text-sm">Enable autoscaling</span>
            </div>
            {config.autoscaling.enabled && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    ["minReplicas", "Min replicas"],
                    ["maxReplicas", "Max replicas"],
                    ["targetCpuPercent", "CPU target %"],
                    ["targetMemoryPercent", "Memory target %"],
                    ["targetRequestsPerSecond", "Requests / second"],
                    ["cooldownSeconds", "Cooldown seconds"],
                  ] as const
                ).map(([key, label]) => (
                  <Input
                    key={key}
                    type="number"
                    min={key === "cooldownSeconds" ? 10 : 1}
                    placeholder={label}
                    value={config.autoscaling[key] ?? ""}
                    onChange={(event) =>
                      updateAutoscaling({
                        [key]: event.target.value
                          ? Number(event.target.value)
                          : undefined,
                      })
                    }
                    aria-label={label}
                  />
                ))}
              </div>
            )}
          </Field>
        )}

        {resourceType === "application" && (
          <Field>
            <FieldLabel>Progressive delivery</FieldLabel>
            <FieldDescription>
              Canary, blue-green, and progressive strategies create an isolated
              revision, gate it on health and metrics, then promote or remove
              it.
            </FieldDescription>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                value={config.deploymentStrategy.type}
                onValueChange={(type) =>
                  type &&
                  updateDeploymentStrategy({
                    type: type as DeploymentStrategy["type"],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Deployment strategy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rolling">Rolling</SelectItem>
                  <SelectItem value="canary">Canary</SelectItem>
                  <SelectItem value="blue-green">Blue-green</SelectItem>
                  <SelectItem value="progressive">Progressive</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                max={99}
                placeholder="Canary percent"
                value={config.deploymentStrategy.canaryPercent ?? ""}
                onChange={(event) =>
                  updateDeploymentStrategy({
                    canaryPercent: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
              />
              <Input
                type="number"
                min={0}
                placeholder="Bake time seconds"
                value={config.deploymentStrategy.bakeTimeSeconds}
                onChange={(event) =>
                  updateDeploymentStrategy({
                    bakeTimeSeconds: Number(event.target.value) || 0,
                  })
                }
              />
              <Input
                placeholder="Progressive steps (10,25,50)"
                value={config.deploymentStrategy.steps.join(",")}
                onChange={(event) =>
                  updateDeploymentStrategy({
                    steps: event.target.value
                      .split(",")
                      .map((value) => Number(value.trim()))
                      .filter((value) => Number.isFinite(value)),
                  })
                }
              />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Switch
                checked={config.deploymentStrategy.automaticRollback}
                onCheckedChange={(automaticRollback) =>
                  updateDeploymentStrategy({ automaticRollback })
                }
              />
              <span className="text-sm">
                Automatically roll back on a failed metric gate
              </span>
            </div>
          </Field>
        )}

        {resourceType === "database" && (
          <Field>
            <FieldLabel>PostgreSQL high availability</FieldLabel>
            <FieldDescription>
              Use the bitnami/postgresql-repmgr image to reconcile replicas and
              automatic failover.
            </FieldDescription>
            <div className="flex items-center gap-3">
              <Switch
                checked={config.databaseReplication.enabled}
                onCheckedChange={(enabled) => updateReplication({ enabled })}
              />
              <span className="text-sm">Enable managed replication</span>
            </div>
            {config.databaseReplication.enabled && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input
                  type="number"
                  min={1}
                  max={5}
                  placeholder="Replica count"
                  value={config.databaseReplication.replicaCount}
                  onChange={(event) =>
                    updateReplication({
                      replicaCount: Number(event.target.value) || 1,
                    })
                  }
                />
                <div className="flex items-center gap-3 rounded-md border px-3">
                  <Switch
                    checked={config.databaseReplication.automaticFailover}
                    onCheckedChange={(automaticFailover) =>
                      updateReplication({ automaticFailover })
                    }
                  />
                  <span className="text-sm">Automatic failover</span>
                </div>
              </div>
            )}
          </Field>
        )}

        {resourceType !== "database" && (
          <>
            <Field className="border-t pt-4">
              <FieldLabel>Pre-Deploy Hook Command</FieldLabel>
              <FieldDescription>
                Command executed inside the container before switching live
                traffic. A non-zero exit code aborts the deployment and triggers
                an automatic rollback (e.g. <code>npx prisma db push</code> or{" "}
                <code>rails db:migrate</code>).
              </FieldDescription>
              <div className="mb-2 flex items-center gap-3">
                <Switch
                  checked={config.preDeployHook?.enabled ?? false}
                  onCheckedChange={(enabled) =>
                    updatePreDeployHook({
                      enabled,
                    })
                  }
                />
                <span className="text-sm">Enable Pre-Deploy Hook</span>
              </div>
              {config.preDeployHook?.enabled && (
                <Input
                  placeholder="e.g. npx prisma db push"
                  value={config.preDeployHook?.command ?? ""}
                  onChange={(e) =>
                    updatePreDeployHook({
                      command: e.target.value,
                      enabled: true,
                    })
                  }
                />
              )}
            </Field>

            <Field className="border-t pt-4">
              <FieldLabel>Post-Deploy Hook Command</FieldLabel>
              <FieldDescription>
                Command executed inside the container after healthchecks pass
                and live traffic is active (e.g.{" "}
                <code>npx prisma migrate deploy</code>).
              </FieldDescription>
              <div className="mb-2 flex items-center gap-3">
                <Switch
                  checked={config.postDeployHook?.enabled ?? false}
                  onCheckedChange={(enabled) =>
                    updatePostDeployHook({
                      enabled,
                    })
                  }
                />
                <span className="text-sm">Enable Post-Deploy Hook</span>
              </div>
              {config.postDeployHook?.enabled && (
                <div className="mt-3 flex flex-col gap-3">
                  <Input
                    placeholder="e.g. npx prisma migrate deploy"
                    value={config.postDeployHook?.command ?? ""}
                    onChange={(e) =>
                      updatePostDeployHook({
                        command: e.target.value,
                        enabled: true,
                      })
                    }
                  />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <FieldLabel className="text-xs">
                        Timeout (seconds)
                      </FieldLabel>
                      <Input
                        type="number"
                        min={10}
                        max={1800}
                        value={config.postDeployHook?.timeoutSeconds ?? 300}
                        onChange={(e) =>
                          updatePostDeployHook({
                            timeoutSeconds:
                              Number.parseInt(e.target.value, 10) || 300,
                          })
                        }
                      />
                    </div>
                    <div>
                      <FieldLabel className="text-xs">
                        Failure Action
                      </FieldLabel>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        value={config.postDeployHook?.onFailure ?? "warn"}
                        onChange={(e) =>
                          updatePostDeployHook({
                            onFailure: e.target.value as "warn" | "fail",
                          })
                        }
                      >
                        <option value="warn">
                          Log Warning &amp; Continue Deployment
                        </option>
                        <option value="fail">
                          Fail Deployment &amp; Trigger Rollback
                        </option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </Field>
          </>
        )}
      </CardContent>
    </Card>
  );
}
