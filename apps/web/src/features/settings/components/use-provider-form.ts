import { useMutation } from "@tanstack/react-query";
import type { AIProvider } from "@upstand/domain";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/utils/trpc";
import {
  DEFAULT_PROVIDER_FORM_VALUES,
  type ProviderFormValues,
} from "./provider-form-fields";

export function useProviderForm(
  organizationId: string,
  initialValues: ProviderFormValues = DEFAULT_PROVIDER_FORM_VALUES,
) {
  const [values, setValues] = useState<ProviderFormValues>(initialValues);
  const [modelSuggestions, setModelSuggestions] = useState<
    Array<{
      id: string;
      name: string;
      reasoning?: boolean;
      contextLength?: number;
    }>
  >([]);

  const test = useMutation({
    ...trpc.ai.testProvider.mutationOptions(),
    onSuccess: (data) => toast.success(`Connection works · ${data.model}`),
    onError: (err) => toast.error(err.message || "Connection test failed"),
  });

  const listModels = useMutation({
    ...trpc.ai.listModels.mutationOptions(),
    onSuccess: (models) => setModelSuggestions(models),
  });

  function handleChange(next: Partial<ProviderFormValues>) {
    setValues((prev) => {
      const updated = { ...prev, ...next };
      if (next.provider && next.provider !== prev.provider) {
        listModels.mutate({
          organizationId,
          provider: next.provider as AIProvider,
        });
      }
      return updated;
    });
  }

  return {
    values,
    setValues,
    modelSuggestions,
    setModelSuggestions,
    test,
    handleChange,
  };
}
