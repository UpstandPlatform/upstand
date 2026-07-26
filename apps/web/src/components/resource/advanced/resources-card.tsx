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
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@upstand/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@upstand/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Textarea } from "@upstand/ui/components/textarea";
import type { AdvancedCardProps } from "./types";

type RestartCondition = ResourceAdvancedConfig["restartPolicy"]["condition"];

function isRestartCondition(value: string): value is RestartCondition {
  return value === "any" || value === "none" || value === "on-failure";
}

// ──────────────────────────────────────────────────────────────────────────────
// Unit-adorned number input helper
// ──────────────────────────────────────────────────────────────────────────────

type UnitInputProps = {
  id?: string;
  placeholder?: string;
  unit: string;
  value: number | undefined;
  min?: number;
  step?: number;
  onChange: (value: number | undefined) => void;
};

function UnitInput({
  id,
  placeholder,
  unit,
  value,
  min = 0,
  step = 1,
  onChange,
}: UnitInputProps) {
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        type="number"
        min={min}
        step={step}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? Number(e.target.value) : undefined)
        }
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText>{unit}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Resources & Limits Card
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Covers CPU/memory limits & reservations, restart policy, replicas,
 * stop grace period, and placement constraints.
 */
export function ResourcesCard({ config, onChange }: AdvancedCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resources &amp; limits</CardTitle>
        <CardDescription>
          CPU and memory budgets, restart behaviour, replica count, and Swarm
          placement constraints.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 border-t pt-5">
        {/* ── CPU + Memory ── */}
        <FieldGroup className="grid gap-5 lg:grid-cols-2">
          <Field>
            <FieldLabel>Resource limits</FieldLabel>
            <FieldDescription>
              Hard ceiling enforced by the container runtime. CPU in cores,
              memory in MB.
            </FieldDescription>
            <div className="grid gap-2 sm:grid-cols-2">
              <UnitInput
                id="advanced-cpu-limit"
                placeholder="Unlimited"
                unit="CPU"
                min={0.01}
                step={0.25}
                value={config.resources.cpuLimit}
                onChange={(v) =>
                  onChange("resources", { ...config.resources, cpuLimit: v })
                }
              />
              <UnitInput
                id="advanced-memory-limit"
                placeholder="Unlimited"
                unit="MB"
                min={1}
                step={256}
                value={config.resources.memoryLimitMb}
                onChange={(v) =>
                  onChange("resources", {
                    ...config.resources,
                    memoryLimitMb: v,
                  })
                }
              />
            </div>
          </Field>

          <Field>
            <FieldLabel>Resource reservations</FieldLabel>
            <FieldDescription>
              Minimum resources guaranteed to this service by the Swarm
              scheduler. CPU in cores, memory in MB.
            </FieldDescription>
            <div className="grid gap-2 sm:grid-cols-2">
              <UnitInput
                id="advanced-cpu-reservation"
                placeholder="None"
                unit="CPU"
                min={0.01}
                step={0.25}
                value={config.resources.cpuReservation}
                onChange={(v) =>
                  onChange("resources", {
                    ...config.resources,
                    cpuReservation: v,
                  })
                }
              />
              <UnitInput
                id="advanced-memory-reservation"
                placeholder="None"
                unit="MB"
                min={1}
                step={256}
                value={config.resources.memoryReservationMb}
                onChange={(v) =>
                  onChange("resources", {
                    ...config.resources,
                    memoryReservationMb: v,
                  })
                }
              />
            </div>
          </Field>
        </FieldGroup>

        {/* ── Restart policy ── */}
        <FieldGroup className="grid gap-5 lg:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="advanced-restart-condition">
              Restart policy
            </FieldLabel>
            <FieldDescription>
              Control how Swarm recovers failed tasks.
            </FieldDescription>
            <Select
              value={config.restartPolicy.condition}
              onValueChange={(condition) => {
                if (condition && isRestartCondition(condition)) {
                  onChange("restartPolicy", {
                    ...config.restartPolicy,
                    condition,
                  });
                }
              }}
            >
              <SelectTrigger id="advanced-restart-condition">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Always restart</SelectItem>
                <SelectItem value="on-failure">On failure only</SelectItem>
                <SelectItem value="none">Never restart</SelectItem>
              </SelectContent>
            </Select>

            <div className="grid gap-2 sm:grid-cols-3">
              <UnitInput
                id="advanced-restart-attempts"
                placeholder="Unlimited"
                unit="attempts"
                min={0}
                value={config.restartPolicy.maxAttempts}
                onChange={(v) =>
                  onChange("restartPolicy", {
                    ...config.restartPolicy,
                    maxAttempts: v,
                  })
                }
              />
              <UnitInput
                id="advanced-restart-delay"
                placeholder="Default"
                unit="s delay"
                min={0}
                value={config.restartPolicy.delaySeconds}
                onChange={(v) =>
                  onChange("restartPolicy", {
                    ...config.restartPolicy,
                    delaySeconds: v,
                  })
                }
              />
              <UnitInput
                id="advanced-restart-window"
                placeholder="Default"
                unit="s window"
                min={0}
                value={config.restartPolicy.windowSeconds}
                onChange={(v) =>
                  onChange("restartPolicy", {
                    ...config.restartPolicy,
                    windowSeconds: v,
                  })
                }
              />
            </div>
          </Field>

          {/* ── Replicas + grace ── */}
          <Field>
            <FieldLabel>Service scaling</FieldLabel>
            <FieldDescription>
              Number of concurrent replicas and the stop grace period before
              Swarm forcefully kills containers.
            </FieldDescription>
            <div className="grid gap-2 sm:grid-cols-2">
              <UnitInput
                id="advanced-replicas"
                placeholder="1"
                unit="replicas"
                min={0}
                value={config.replicas}
                onChange={(v) => onChange("replicas", v)}
              />
              <UnitInput
                id="advanced-stop-grace"
                placeholder="Default"
                unit="s grace"
                min={0}
                value={config.stopGracePeriodSeconds}
                onChange={(v) => onChange("stopGracePeriodSeconds", v)}
              />
            </div>
          </Field>
        </FieldGroup>

        {/* ── Placement constraints ── */}
        <Field className="lg:col-span-2">
          <FieldLabel htmlFor="advanced-placement">
            Placement constraints
          </FieldLabel>
          <FieldDescription>
            One Docker Swarm constraint per line, for example{" "}
            <span className="font-mono text-xs">node.labels.region == eu</span>.
          </FieldDescription>
          <Textarea
            id="advanced-placement"
            data-slot="input-group-control"
            rows={Math.max(3, config.placementConstraints.length + 1)}
            className="w-full flex-1 resize-none px-3 py-2 font-mono text-sm"
            placeholder={"node.role == worker\nnode.labels.region == eu"}
            value={config.placementConstraints.join("\n")}
            onChange={(e) =>
              onChange(
                "placementConstraints",
                e.target.value
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean),
              )
            }
            aria-label="Placement constraints"
          />
        </Field>
      </CardContent>
    </Card>
  );
}
