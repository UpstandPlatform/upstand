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
import { toast } from "sonner";
import { Loader2 } from "@/components/huge-icons";
import { trpc } from "@/utils/trpc";
import {
  DEFAULT_PROVIDER_FORM_VALUES,
  ProviderFormFields,
} from "./provider-form-fields";
import { useProviderForm } from "./use-provider-form";

type Props = {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

export function AddProviderDialog({
  organizationId,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const {
    values,
    setValues,
    modelSuggestions,
    setModelSuggestions,
    test,
    handleChange,
  } = useProviderForm(organizationId, DEFAULT_PROVIDER_FORM_VALUES);

  const add = useMutation({
    ...trpc.ai.addProvider.mutationOptions(),
    onSuccess: () => {
      toast.success("Provider added");
      setValues(DEFAULT_PROVIDER_FORM_VALUES);
      setModelSuggestions([]);
      onOpenChange(false);
      onCreated();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to add provider");
    },
  });

  function handleSave() {
    if (!values.name.trim()) {
      toast.error("Please enter a name for this provider.");
      return;
    }
    add.mutate({
      organizationId,
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
    test.mutate({
      organizationId,
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
          <DialogTitle>Add AI provider</DialogTitle>
          <DialogDescription>
            Configure a new AI provider. API keys are encrypted server-side and
            never sent back to the browser.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <ProviderFormFields
            values={values}
            onChange={handleChange}
            modelSuggestions={modelSuggestions}
            idPrefix="add-provider"
          />
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={test.isPending || add.isPending}
          >
            {test.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {test.isPending ? "Testing…" : "Test connection"}
          </Button>
          <Button onClick={handleSave} disabled={add.isPending}>
            {add.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {add.isPending ? "Adding…" : "Add provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
