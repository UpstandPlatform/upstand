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
import { Switch } from "@upstand/ui/components/switch";
import { CodeEditor, CodeSurface } from "@/components/shared/code-editor";
import { type AdvancedCardProps, splitLines } from "./types";

// ──────────────────────────────────────────────────────────────────────────────
// General & Runtime Card
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Covers the most commonly-reached advanced knobs:
 *   • Entrypoint command & command arguments
 *   • Working directory, user, hostname
 *   • Isolated deployment toggle
 *   • Compose-specific: service target name + volume isolation toggle
 */
export function GeneralCard({
  config,
  resourceType,
  onChange,
}: AdvancedCardProps) {
  const isCompose = resourceType === "compose";
  const updateDeploymentReliability = (
    partial: Partial<ResourceAdvancedConfig["deploymentReliability"]>,
  ) =>
    onChange("deploymentReliability", {
      ...config.deploymentReliability,
      ...partial,
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>General &amp; runtime</CardTitle>
        <CardDescription>
          Container entrypoint, identity, and Compose-specific overrides. All
          values take effect on the next deployment.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 border-t pt-5">
        {/* ── Isolation toggles ── */}
        <FieldGroup className="grid gap-4 md:grid-cols-2">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="advanced-isolated-deployment">
                Isolated deployment
              </FieldLabel>
              <FieldDescription>
                Attach this resource to a dedicated Swarm overlay network so it
                cannot resolve services from other resources.
              </FieldDescription>
            </FieldContent>
            <Switch
              id="advanced-isolated-deployment"
              checked={config.isolatedDeployment}
              onCheckedChange={(value) => onChange("isolatedDeployment", value)}
            />
          </Field>

          {isCompose && (
            <>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="advanced-isolated-volumes">
                    Isolate Compose volumes
                  </FieldLabel>
                  <FieldDescription>
                    Prefix named volumes for this Compose deployment to avoid
                    collisions between isolated instances.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="advanced-isolated-volumes"
                  checked={config.isolatedDeploymentsVolume}
                  onCheckedChange={(value) =>
                    onChange("isolatedDeploymentsVolume", value)
                  }
                />
              </Field>

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="advanced-randomize">
                    Randomize resource names
                  </FieldLabel>
                  <FieldDescription>
                    Append a random suffix to Compose resource names to prevent
                    naming collisions across isolated deployments.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="advanced-randomize"
                  checked={config.randomize}
                  onCheckedChange={(value) => onChange("randomize", value)}
                />
              </Field>
            </>
          )}
        </FieldGroup>

        {resourceType === "application" || resourceType === "compose" ? (
          <Field>
            <FieldLabel>Git source strategy</FieldLabel>
            <FieldDescription>
              Reuse large repository workspaces between deployments and fetch
              Git LFS objects when the repository uses pointer files.
            </FieldDescription>
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="advanced-reuse-workspace">
                    Reuse repository workspace
                  </FieldLabel>
                  <FieldDescription>
                    Keep the checkout between deployments and refresh it with
                    fetch/checkout instead of cloning from scratch.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="advanced-reuse-workspace"
                  checked={config.source.reuseWorkspace}
                  onCheckedChange={(value) =>
                    onChange("source", {
                      ...config.source,
                      reuseWorkspace: value,
                    })
                  }
                />
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="advanced-git-lfs">Git LFS</FieldLabel>
                  <FieldDescription>
                    Initialize Git LFS and download binary objects before the
                    build starts.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="advanced-git-lfs"
                  checked={config.source.gitLfs}
                  onCheckedChange={(value) =>
                    onChange("source", { ...config.source, gitLfs: value })
                  }
                />
              </Field>
              <Input
                type="number"
                min={0}
                max={100_000}
                value={config.source.fetchDepth}
                onChange={(event) =>
                  onChange("source", {
                    ...config.source,
                    fetchDepth: Number(event.target.value) || 0,
                  })
                }
                aria-label="Git fetch depth"
                placeholder="Fetch depth (0 = full history)"
              />
              <Input
                type="number"
                min={30}
                max={86_400}
                value={config.source.timeoutSeconds}
                onChange={(event) =>
                  onChange("source", {
                    ...config.source,
                    timeoutSeconds: Number(event.target.value) || 30,
                  })
                }
                aria-label="Git operation timeout"
                placeholder="Git timeout (seconds)"
              />
            </FieldGroup>
          </Field>
        ) : null}

        <Field>
          <FieldLabel>Deployment reliability</FieldLabel>
          <FieldDescription>
            Control retry pacing and how long a worker may be silent before an
            execution is marked stale. Retries use capped exponential backoff.
          </FieldDescription>
          <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              id="advanced-max-attempts"
              type="number"
              min={1}
              max={10}
              value={config.deploymentReliability.maxAttempts}
              onChange={(event) =>
                updateDeploymentReliability({
                  maxAttempts:
                    Number(event.target.value) ||
                    config.deploymentReliability.maxAttempts,
                })
              }
              aria-label="Maximum deployment attempts"
              placeholder="Max attempts"
            />
            <Input
              id="advanced-retry-base"
              type="number"
              min={1}
              max={300}
              value={config.deploymentReliability.retryBaseSeconds}
              onChange={(event) => {
                const retryBaseSeconds =
                  Number(event.target.value) ||
                  config.deploymentReliability.retryBaseSeconds;
                updateDeploymentReliability({
                  retryBaseSeconds,
                  retryMaxSeconds: Math.max(
                    config.deploymentReliability.retryMaxSeconds,
                    retryBaseSeconds,
                  ),
                });
              }}
              aria-label="Retry base delay in seconds"
              placeholder="Retry base (seconds)"
            />
            <Input
              id="advanced-retry-max"
              type="number"
              min={config.deploymentReliability.retryBaseSeconds}
              max={3600}
              value={config.deploymentReliability.retryMaxSeconds}
              onChange={(event) =>
                updateDeploymentReliability({
                  retryMaxSeconds:
                    Number(event.target.value) ||
                    config.deploymentReliability.retryMaxSeconds,
                })
              }
              aria-label="Maximum retry delay in seconds"
              placeholder="Retry cap (seconds)"
            />
            <Input
              id="advanced-stale-after"
              type="number"
              min={60}
              max={86_400}
              value={config.deploymentReliability.staleAfterSeconds}
              onChange={(event) =>
                updateDeploymentReliability({
                  staleAfterSeconds:
                    Number(event.target.value) ||
                    config.deploymentReliability.staleAfterSeconds,
                })
              }
              aria-label="Stale execution threshold in seconds"
              placeholder="Stale after (seconds)"
            />
          </FieldGroup>
        </Field>

        {/* ── Compose service target ── */}
        {isCompose && (
          <Field>
            <FieldLabel htmlFor="advanced-compose-service">
              Compose service target
            </FieldLabel>
            <FieldDescription>
              Apply the resource-level command, ports, volumes, and limits to
              this service. Leave empty to apply them to every service in the
              Compose project.
            </FieldDescription>
            <Input
              id="advanced-compose-service"
              value={config.serviceName ?? ""}
              onChange={(e) =>
                onChange("serviceName", e.target.value || undefined)
              }
              placeholder="web"
            />
          </Field>
        )}

        {/* ── Entrypoint & args ── */}
        <FieldGroup className="grid gap-5 lg:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="advanced-command">
              Entrypoint command
            </FieldLabel>
            <FieldDescription>
              One argument per line. Leave empty to use the image default.
            </FieldDescription>
            <CodeSurface>
              <CodeEditor
                id="advanced-command"
                language="shell"
                allowLanguageChange={false}
                height="110px"
                value={config.command.join("\n")}
                onChange={(value) => onChange("command", splitLines(value))}
                aria-label="Entrypoint command arguments"
              />
            </CodeSurface>
          </Field>

          <Field>
            <FieldLabel htmlFor="advanced-args">Command arguments</FieldLabel>
            <FieldDescription>
              Arguments are passed after the entrypoint command.
            </FieldDescription>
            <CodeSurface>
              <CodeEditor
                id="advanced-args"
                language="shell"
                allowLanguageChange={false}
                height="110px"
                value={config.args.join("\n")}
                onChange={(value) => onChange("args", splitLines(value))}
                aria-label="Command arguments"
              />
            </CodeSurface>
          </Field>
        </FieldGroup>

        {/* ── Container identity ── */}
        <FieldGroup className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="advanced-working-dir">
              Working directory
            </FieldLabel>
            <FieldDescription>
              Absolute path used as the container&apos;s working directory.
            </FieldDescription>
            <Input
              id="advanced-working-dir"
              placeholder="/app"
              value={config.workingDir ?? ""}
              onChange={(e) =>
                onChange("workingDir", e.target.value || undefined)
              }
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="advanced-user">User</FieldLabel>
            <FieldDescription>
              UID, username, or{" "}
              <span className="font-mono text-xs">uid:gid</span> pair for the
              container process.
            </FieldDescription>
            <Input
              id="advanced-user"
              placeholder="1000 or appuser"
              value={config.user ?? ""}
              onChange={(e) => onChange("user", e.target.value || undefined)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="advanced-hostname">Hostname</FieldLabel>
            <FieldDescription>
              Custom hostname injected into the container&apos;s network
              namespace.
            </FieldDescription>
            <Input
              id="advanced-hostname"
              placeholder="my-service"
              value={config.hostname ?? ""}
              onChange={(e) =>
                onChange("hostname", e.target.value || undefined)
              }
            />
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
