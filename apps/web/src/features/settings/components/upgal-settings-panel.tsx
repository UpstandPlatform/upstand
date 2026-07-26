"use client";

import { useQuery } from "@tanstack/react-query";
import { getUpGalTargetDefinition } from "@upstand/api/ai/upgal-ui-targets";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Spinner } from "@upstand/ui/components/spinner";
import { useState } from "react";
import { Plus, ShieldCheck } from "@/components/huge-icons";
import { UpGalTarget } from "@/components/upgal-target";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";
import { AddProviderDialog } from "./add-provider-dialog";
import { EditProviderDialog } from "./edit-provider-dialog";
import { FeatureAssignmentsSection } from "./feature-assignments-section";
import { ProviderCard, type ProviderView } from "./provider-card";
import { TavilySettingsSection } from "./tavily-settings-section";

type UpGalSettingsPanelProps = {
  embedded?: boolean;
};

const addProviderTarget = getUpGalTargetDefinition("upgal-add-provider");

export function UpGalSettingsPanel(_props: UpGalSettingsPanelProps) {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;

  const providersQuery = useQuery({
    ...trpc.ai.listProviders.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });

  const [addOpen, setAddOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderView | null>(
    null,
  );

  const providers = (providersQuery.data as ProviderView[]) || [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-sm">Configured AI Providers</CardTitle>
            <CardDescription className="text-xs">
              Provider credentials are stored securely and used by selected
              UpGal features.
            </CardDescription>
          </div>
          <UpGalTarget definition={addProviderTarget}>
            <Button
              onClick={() => setAddOpen(true)}
              disabled={!organizationId || providersQuery.isPending}
              size="sm"
            >
              <Plus data-icon="inline-start" />
              Add provider
            </Button>
          </UpGalTarget>
        </CardHeader>
        <CardContent>
          {providersQuery.isPending ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground text-xs">
              <Spinner data-icon="inline-start" />
              <span className="ml-2">Loading providers…</span>
            </div>
          ) : providers.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center">
              <p className="mb-1 font-medium text-foreground text-sm">
                No AI providers configured
              </p>
              <p className="mb-4 max-w-sm text-muted-foreground text-xs">
                Add an AI provider (OpenAI, Anthropic, Google, etc.) to enable
                UpGal agentic capabilities.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddOpen(true)}
                disabled={!organizationId}
              >
                <Plus data-icon="inline-start" />
                Add your first provider
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {providers.map((item) => (
                <ProviderCard
                  key={item.id}
                  organizationId={organizationId}
                  provider={item}
                  onEdit={() => setEditingProvider(item)}
                  onDeleted={() => void providersQuery.refetch()}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!providersQuery.isPending && (
        <>
          <FeatureAssignmentsSection
            organizationId={organizationId}
            providers={providers}
          />
          <TavilySettingsSection organizationId={organizationId} />
        </>
      )}

      <div className="flex items-start gap-2 px-1 text-muted-foreground text-xs">
        <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
        <span>
          All UpGal mutations require explicit approval in chat. Provider keys
          are encrypted server-side and never shown again.
        </span>
      </div>

      {organizationId && (
        <>
          <AddProviderDialog
            organizationId={organizationId}
            open={addOpen}
            onOpenChange={setAddOpen}
            onCreated={() => void providersQuery.refetch()}
          />
          <EditProviderDialog
            organizationId={organizationId}
            provider={editingProvider}
            open={editingProvider !== null}
            onOpenChange={(open) => {
              if (!open) setEditingProvider(null);
            }}
            onUpdated={() => void providersQuery.refetch()}
          />
        </>
      )}
    </div>
  );
}
