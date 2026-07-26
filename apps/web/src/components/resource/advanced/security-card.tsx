"use client";

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
import { Switch } from "@upstand/ui/components/switch";
import { ResourceKeyValueEditor } from "@/components/resource/key-value-editor";
import { CodeEditor, CodeSurface } from "@/components/shared/code-editor";
import { type AdvancedCardProps, splitLines } from "./types";

// ──────────────────────────────────────────────────────────────────────────────
// Security & Capabilities Card
// ──────────────────────────────────────────────────────────────────────────────

type SecurityKey = "init" | "readOnlyRootFilesystem" | "tty";

const SECURITY_TOGGLES: ReadonlyArray<{
  key: SecurityKey;
  label: string;
  description: string;
}> = [
  {
    key: "init",
    label: "Init process",
    description:
      "Run a lightweight init process (e.g. tini) as PID 1 to properly handle signal forwarding and zombie reaping.",
  },
  {
    key: "readOnlyRootFilesystem",
    label: "Read-only root filesystem",
    description:
      "Mount the container root filesystem as read-only. Writes are only possible inside explicitly mounted volumes.",
  },
  {
    key: "tty",
    label: "Allocate TTY",
    description:
      "Allocate a pseudo-terminal for interactive workloads that require a TTY (e.g. shell sessions).",
  },
] as const;

/**
 * Groups all security-relevant knobs:
 *   • Security mode toggles (init, read-only FS, TTY)
 *   • Dropped Linux capabilities (capDrop)
 *   • Kernel parameter overrides (sysctls)
 */
export function SecurityCard({ config, onChange }: AdvancedCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Security &amp; capabilities</CardTitle>
        <CardDescription>
          Container security profile — Linux capabilities, kernel parameters,
          and runtime security modes. Privileged mode and added capabilities are
          disabled to preserve workload isolation.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 border-t pt-5">
        {/* ── Security toggles ── */}
        <FieldGroup className="grid gap-4 md:grid-cols-2">
          {SECURITY_TOGGLES.map(({ key, label, description }) => (
            <Field orientation="horizontal" key={key}>
              <FieldContent>
                <FieldLabel htmlFor={`advanced-${key}`}>{label}</FieldLabel>
                <FieldDescription>{description}</FieldDescription>
              </FieldContent>
              <Switch
                id={`advanced-${key}`}
                checked={config[key]}
                onCheckedChange={(value) => onChange(key, value)}
              />
            </Field>
          ))}
        </FieldGroup>

        {/* ── Capabilities ── */}
        <FieldGroup className="grid gap-5">
          <Field>
            <FieldLabel htmlFor="advanced-cap-drop">
              Dropped capabilities
            </FieldLabel>
            <FieldDescription>
              One Linux capability per line to remove from the default
              capability set.
            </FieldDescription>
            <CodeSurface>
              <CodeEditor
                id="advanced-cap-drop"
                language="shell"
                allowLanguageChange={false}
                height="100px"
                value={config.capDrop.join("\n")}
                onChange={(value) => onChange("capDrop", splitLines(value))}
                aria-label="Dropped capabilities"
              />
            </CodeSurface>
          </Field>
        </FieldGroup>

        {/* ── Sysctls ── */}
        <ResourceKeyValueEditor
          id="advanced-sysctls"
          label="Kernel parameters (sysctls)"
          description="Key-value kernel parameters passed to the container, e.g. net.core.somaxconn = 1024."
          value={config.sysctls}
          onChange={(sysctls) => onChange("sysctls", sysctls)}
        />
      </CardContent>
    </Card>
  );
}
