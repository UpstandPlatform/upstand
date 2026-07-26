"use client";

import { useMutation } from "@tanstack/react-query";
import { Button } from "@upstand/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import { useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "@/components/huge-icons";
import { trpc } from "@/utils/trpc";
import type { ProviderView } from "./provider-card";
import {
  DEFAULT_PROVIDER_FORM_VALUES,
  ProviderFormFields,
} from "./provider-form-fields";
import { useProviderForm } from "./use-provider-form";

type Props = {
  organizationId: string;
  provider: ProviderView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
};

export function EditProviderDialog({
  organizationId,
  provider,
  open,
  onOpenChange,
  onUpdated,
}: Props) {
  const {
    values,
    setValues,
    modelSuggestions,
    setModelSuggestions,
    test,
    handleChange,
  } = useProviderForm(organizationId, DEFAULT_PROVIDER_FORM_VALUES);

  // Sync form when the provider being edited changes
  useEffect(() => {
    if (!provider) return;
    setValues({
      name: provider.name,
      provider: provider.provider,
      model: provider.model,
      apiKey: "",
      baseUrl: provider.baseUrl ?? "",
      temperature: provider.temperature,
      reasoningEnabled: provider.reasoningEnabled,
      maxOutputTokens: provider.maxOutputTokens,
    });
    setModelSuggestions([]);
  }, [provider, setValues, setModelSuggestions]);

  const update = useMutation({
    ...trpc.ai.updateProvider.mutationOptions(),
    onSuccess: () => {
      toast.success("Provider updated");
      onOpenChange(false);
      onUpdated();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update provider");
    },
  });

  function handleSave() {
    if (!provider) return;
    if (!values.name.trim()) {
      toast.error("Please enter a name for this provider.");
      return;
    }
    update.mutate({
      organizationId,
      id: provider.id,
      name: values.name.trim(),
      provider: values.provider,
      model: values.model,
      apiKey: values.apiKey || undefined,
      baseUrl: values.baseUrl || undefined,
      temperature: values.temperature,
      reasoningEnabled: values.reasoningEnabled,
      maxOutputTokens: values.maxOutputTokens,
    });
  }

  function handleTest() {
    if (!provider) return;
    test.mutate({
      organizationId,
      id: provider.id,
      provider: values.provider,
      model: values.model,
      apiKey: values.apiKey || undefined,
      baseUrl: values.baseUrl || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit provider</DialogTitle>
          <DialogDescription>
            Update this provider&apos;s settings. Leave the API key blank to
            keep the currently saved key.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <ProviderFormFields
            values={values}
            onChange={handleChange}
            hasExistingKey={provider?.configured ?? false}
            modelSuggestions={modelSuggestions}
            idPrefix="edit-provider"
          />
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={test.isPending || update.isPending}
          >
            {test.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {test.isPending ? "Testing…" : "Test connection"}
          </Button>
          <Button onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
