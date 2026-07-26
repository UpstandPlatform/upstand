"use client";

import { useMutation } from "@tanstack/react-query";
import type { AIProvider } from "@upstand/domain";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import { Card } from "@upstand/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@upstand/ui/components/dropdown-menu";
import { Spinner } from "@upstand/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import { Edit2, MoreVerticalIcon, Play, Trash2 } from "@/components/huge-icons";
import { trpc } from "@/utils/trpc";

export type ProviderView = {
  id: string;
  name: string;
  provider: AIProvider;
  model: string;
  baseUrl: string | null;
  enabled: boolean;
  configured: boolean;
  temperature: number | null;
  reasoningEnabled: boolean;
  maxOutputTokens: number | null;
};

type Props = {
  organizationId: string;
  provider: ProviderView;
  onEdit: () => void;
  onDeleted: () => void;
};

export function ProviderCard({
  organizationId,
  provider,
  onEdit,
  onDeleted,
}: Props) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const test = useMutation({
    ...trpc.ai.testProvider.mutationOptions(),
    onSuccess: (data) =>
      toast.success(`Connection successful using model: ${data.model}`),
    onError: (err) => toast.error(err.message || "Connection test failed"),
  });

  const remove = useMutation({
    ...trpc.ai.removeProvider.mutationOptions(),
    onSuccess: () => {
      toast.success("Provider deleted");
      onDeleted();
    },
    onError: (err) => toast.error(err.message || "Failed to delete provider"),
  });

  const busy = test.isPending || remove.isPending;

  return (
    <>
      <Card className="px-4 py-2.5">
        <div className="flex w-full items-center justify-between gap-3 text-left">
          <div className="min-w-0 flex-1 space-y-0.5 text-left">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-semibold text-sm leading-tight">
                {provider.name}
              </h3>
              <Badge
                variant={provider.enabled ? "default" : "secondary"}
                className="h-4 shrink-0 rounded px-1.5 text-[10px] leading-none"
              >
                {provider.enabled ? "Active" : "Disabled"}
              </Badge>
            </div>
            <p className="truncate font-mono text-muted-foreground text-xs leading-tight">
              {provider.provider} · {provider.model}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0"
                  disabled={busy}
                  aria-label={`Actions for ${provider.name}`}
                >
                  {busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <MoreVerticalIcon data-icon="inline-start" />
                  )}
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => test.mutate({ organizationId, id: provider.id })}
                disabled={busy}
              >
                <Play data-icon="inline-start" />
                Test connection
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit} disabled={busy}>
                <Edit2 data-icon="inline-start" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDeleteDialogOpen(true)}
                disabled={busy}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 data-icon="inline-start" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>

      <ConfirmActionDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete AI Provider?"
        description={`Are you sure you want to delete "${provider.name}"? Any operations assigned to this provider will lose their configuration.`}
        actionLabel="Delete Provider"
        pending={remove.isPending}
        onConfirm={() => {
          remove.mutate({ organizationId, id: provider.id });
        }}
      />
    </>
  );
}
