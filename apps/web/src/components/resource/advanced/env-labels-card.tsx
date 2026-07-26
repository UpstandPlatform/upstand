"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { FieldGroup } from "@upstand/ui/components/field";
import { ResourceKeyValueEditor } from "@/components/resource/key-value-editor";
import type { AdvancedCardProps } from "./types";

// ──────────────────────────────────────────────────────────────────────────────
// Environment & Labels Card
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Surfaces the environment variable overrides and Docker Swarm service labels
 * as key-value pair editors. Environment values override whatever is generated
 * for the resource at deploy time; labels are applied to the Swarm service
 * object itself.
 */
export function EnvLabelsCard({ config, onChange }: AdvancedCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Environment &amp; labels</CardTitle>
        <CardDescription>
          Override environment variables generated for this resource and attach
          metadata labels to the deployed Swarm service.
        </CardDescription>
      </CardHeader>

      <CardContent className="border-t pt-5">
        <FieldGroup className="grid gap-5 lg:grid-cols-2">
          <ResourceKeyValueEditor
            id="advanced-environment"
            label="Environment overrides"
            description="Values here override the environment generated for the resource at deploy time."
            value={config.environment}
            onChange={(environment) => onChange("environment", environment)}
          />

          <ResourceKeyValueEditor
            id="advanced-labels"
            label="Service labels"
            description="Labels applied to the deployed Swarm service object. Use for routing rules, monitoring annotations, etc."
            value={config.labels}
            onChange={(labels) => onChange("labels", labels)}
          />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
