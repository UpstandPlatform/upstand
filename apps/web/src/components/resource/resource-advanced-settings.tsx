"use client";

import { useMutation } from "@tanstack/react-query";
import {
  parseResourceAdvancedConfig,
  type ResourceAdvancedConfig,
  ResourceAdvancedConfigSchema,
} from "@upstand/domain";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import { Card } from "@upstand/ui/components/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@upstand/ui/components/tabs";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Code,
  Cpu,
  Globe,
  HardDrive,
  Save,
  Settings,
  Shield,
  Terminal,
} from "@/components/huge-icons";
import { trpc } from "@/utils/trpc";
import {
  EnvLabelsCard,
  GeneralCard,
  HealthcheckDeploymentCard,
  PortsVolumesCard,
  RawJsonCard,
  ResourcesCard,
  SecurityCard,
} from "./advanced";

// ──────────────────────────────────────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────────────────────────────────────

type Props = {
  resourceId: string;
  resourceType: string;
  advancedConfig?: string | null;
  organizationId?: string;
  composeFile?: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Tab definitions
// ──────────────────────────────────────────────────────────────────────────────

const TABS = [
  { value: "general", label: "General", icon: Settings },
  { value: "resources", label: "Resources", icon: Cpu },
  { value: "ports", label: "Ports & Storage", icon: HardDrive },
  { value: "health", label: "Health & Deploy", icon: Globe },
  { value: "security", label: "Security", icon: Shield },
  { value: "env", label: "Env & Labels", icon: Terminal },
  { value: "json", label: "Raw JSON", icon: Code },
] as const;

type TabValue = (typeof TABS)[number]["value"];

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function validateRawJson(
  raw: string,
): { valid: true; data: ResourceAdvancedConfig } | { valid: false } {
  try {
    const result = ResourceAdvancedConfigSchema.safeParse(JSON.parse(raw));
    if (result.success) return { valid: true, data: result.data };
  } catch {
    // JSON.parse failure
  }
  return { valid: false };
}

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Tabbed orchestrator for all resource advanced settings.
 *
 * State shape:
 *   • `config`   – the authoritative in-memory config object used by all cards.
 *   • `rawJson`  – the JSON string displayed in the "Raw JSON" tab. Kept in
 *                  sync with `config` whenever the user saves via a card, and
 *                  used to write back to `config` when the user saves from the
 *                  JSON tab.
 *   • `jsonValid` – derived validity flag for the JSON tab UI.
 *
 * The single `updateConfig` callback is passed to every card.  It updates the
 * `config` slice and re-serialises the `rawJson` preview so the JSON tab always
 * reflects the latest visual edits.
 */
export function ResourceAdvancedSettings({
  resourceId,
  resourceType,
  advancedConfig,
  organizationId,
  composeFile,
}: Props) {
  // ── Initial state ──
  const initial = useMemo(
    () => parseResourceAdvancedConfig(advancedConfig),
    [advancedConfig],
  );

  const [config, setConfig] = useState<ResourceAdvancedConfig>(initial);
  const [rawJson, setRawJson] = useState<string>(() =>
    JSON.stringify(initial, null, 2),
  );
  const [activeTab, setActiveTab] = useState<TabValue>("general");

  const update = useMutation(trpc.resource.update.mutationOptions());

  const visibleTabs = useMemo(() => {
    return TABS;
  }, []);

  const visibleTabValues = useMemo(() => {
    return new Set<string>(visibleTabs.map((t) => t.value));
  }, [visibleTabs]);

  // Re-initialise when the server prop changes (e.g. after a refetch).
  useEffect(() => {
    setConfig(initial);
    setRawJson(JSON.stringify(initial, null, 2));
  }, [initial]);

  // ── Config update ──
  const updateConfig = <K extends keyof ResourceAdvancedConfig>(
    key: K,
    value: ResourceAdvancedConfig[K],
  ) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      // Keep raw JSON in sync so the JSON tab is always fresh.
      setRawJson(JSON.stringify(next, null, 2));
      return next;
    });
  };

  // ── Persist ──
  const saveConfig = (next: ResourceAdvancedConfig = config) => {
    const parsed = ResourceAdvancedConfigSchema.safeParse(next);
    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message ?? "Invalid advanced configuration",
      );
      return;
    }
    const serialized = JSON.stringify(parsed.data);
    // Canonical round-trip: update local state to reflect normalised values.
    setConfig(parsed.data);
    setRawJson(JSON.stringify(parsed.data, null, 2));
    update.mutate(
      { id: resourceId, advancedConfig: serialized },
      {
        onSuccess: () => toast.success("Advanced settings saved"),
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const saveRawJson = () => {
    const result = validateRawJson(rawJson);
    if (!result.valid) {
      toast.error(
        "Advanced configuration must be valid JSON that matches the schema",
      );
      return;
    }
    saveConfig(result.data);
  };

  // ── JSON tab validity (derived, cheap) ──
  const isJsonValid = validateRawJson(rawJson).valid;

  // ── Card props factory ──
  const cardProps = {
    config,
    resourceType,
    onChange: updateConfig,
    composeFile,
    organizationId,
  };

  return (
    <div className="flex flex-col gap-6">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
      >
        {/* Tab list — scrolls horizontally on mobile */}
        <div className="overflow-x-auto">
          <TabsList variant="line" className="w-max min-w-full">
            {visibleTabs.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value}>
                <Icon data-icon="inline-start" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ── General & Runtime ── */}
        {visibleTabValues.has("general") && (
          <TabsContent value="general" className="mt-4 outline-none">
            <GeneralCard {...cardProps} />
          </TabsContent>
        )}

        {/* ── Resources & Limits ── */}
        {visibleTabValues.has("resources") && (
          <TabsContent value="resources" className="mt-4 outline-none">
            <ResourcesCard {...cardProps} />
          </TabsContent>
        )}

        {/* ── Ports & Storage ── */}
        {visibleTabValues.has("ports") && (
          <TabsContent value="ports" className="mt-4 outline-none">
            <PortsVolumesCard {...cardProps} />
          </TabsContent>
        )}

        {/* ── Health & Deployment ── */}
        {visibleTabValues.has("health") && (
          <TabsContent value="health" className="mt-4 outline-none">
            <HealthcheckDeploymentCard {...cardProps} />
          </TabsContent>
        )}

        {/* ── Security ── */}
        {visibleTabValues.has("security") && (
          <TabsContent value="security" className="mt-4 outline-none">
            <SecurityCard {...cardProps} />
          </TabsContent>
        )}

        {/* ── Environment & Labels ── */}
        {visibleTabValues.has("env") && (
          <TabsContent value="env" className="mt-4 outline-none">
            <EnvLabelsCard {...cardProps} />
          </TabsContent>
        )}

        {/* ── Raw JSON ── */}
        {visibleTabValues.has("json") && (
          <TabsContent value="json" className="mt-4 outline-none">
            <RawJsonCard
              rawJson={rawJson}
              isValid={isJsonValid}
              isSaving={update.isPending}
              onChange={setRawJson}
              onSave={saveRawJson}
            />
          </TabsContent>
        )}
      </Tabs>

      {/* ── Global save footer (visible on all non-JSON tabs) ── */}
      {activeTab !== "json" && (
        <Card className="flex flex-row items-center justify-between gap-3 px-4 py-3 shadow-sm">
          <Badge variant="outline">Applies on next deploy</Badge>
          <Button
            type="button"
            onClick={() => saveConfig()}
            disabled={update.isPending}
          >
            <Save data-icon="inline-start" />
            {update.isPending ? "Saving…" : "Save advanced settings"}
          </Button>
        </Card>
      )}
    </div>
  );
}
