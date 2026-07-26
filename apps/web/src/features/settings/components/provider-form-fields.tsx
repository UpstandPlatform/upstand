"use client";

import { type AIProvider, isAIProvider } from "@upstand/domain";
import { Field, FieldGroup, FieldLabel } from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Switch } from "@upstand/ui/components/switch";

export type ProviderFormValues = {
  name: string;
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number | null;
  reasoningEnabled: boolean;
  maxOutputTokens: number | null;
};

export const DEFAULT_PROVIDER_FORM_VALUES: ProviderFormValues = {
  name: "",
  provider: "openai",
  model: "gpt-4o-mini",
  apiKey: "",
  baseUrl: "",
  temperature: 0.5,
  reasoningEnabled: false,
  maxOutputTokens: null,
};

type Props = {
  values: ProviderFormValues;
  onChange: (next: Partial<ProviderFormValues>) => void;
  /** When true the API key label shows a "leave blank to keep" hint */
  hasExistingKey?: boolean;
  /** Model suggestions for the autocomplete datalist */
  modelSuggestions?: Array<{
    id: string;
    name: string;
    reasoning?: boolean;
    contextLength?: number;
  }>;
  /** Prefix added to id attributes to avoid collisions when rendered multiple times */
  idPrefix?: string;
};

const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
  gateway: "OpenAI-compatible / Gateway",
};

export function ProviderFormFields({
  values,
  onChange,
  hasExistingKey = false,
  modelSuggestions = [],
  idPrefix = "provider-form",
}: Props) {
  const datalistId = `${idPrefix}-model-list`;

  return (
    <>
      <FieldGroup className="flex flex-row">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-name`}>Provider name</FieldLabel>
          <Input
            id={`${idPrefix}-name`}
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. My GPT-4o"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor={`${idPrefix}-provider`}>
            Provider type
          </FieldLabel>
          <Select
            items={(
              Object.entries(PROVIDER_LABELS) as [AIProvider, string][]
            ).map(([value, label]) => ({ value, label }))}
            value={values.provider}
            onValueChange={(value) => {
              if (value && isAIProvider(value)) {
                onChange({ provider: value });
              }
            }}
          >
            <SelectTrigger id={`${idPrefix}-provider`} className="w-full">
              <SelectValue placeholder="Select a provider">
                {PROVIDER_LABELS[values.provider] ?? "Select a provider"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(PROVIDER_LABELS) as [AIProvider, string][]).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-model`}>Model</FieldLabel>
        <Input
          id={`${idPrefix}-model`}
          value={values.model}
          onChange={(e) => onChange({ model: e.target.value })}
          placeholder={
            values.provider === "openrouter"
              ? "provider/model (or custom)"
              : "e.g. gpt-4o-mini"
          }
          list={datalistId}
        />
        <datalist id={datalistId}>
          {modelSuggestions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </datalist>
        <p className="text-muted-foreground text-xs">
          Models come from the shared TokenLens catalog. You can also enter any
          custom model ID.
        </p>
      </Field>

      <FieldGroup className="flex flex-row">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-temperature`}>
            Temperature
          </FieldLabel>
          <Input
            id={`${idPrefix}-temperature`}
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={values.temperature ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              onChange({ temperature: value === "" ? null : Number(value) });
            }}
            placeholder="0.5"
          />
          <p className="text-muted-foreground text-xs">
            Lower values make agent responses more deterministic.
          </p>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-max-output-tokens`}>
            Output token limit
          </FieldLabel>
          <Input
            id={`${idPrefix}-max-output-tokens`}
            type="number"
            min={256}
            max={1_000_000}
            step={256}
            value={values.maxOutputTokens ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              onChange({
                maxOutputTokens: value === "" ? null : Number(value),
              });
            }}
            placeholder="Provider default"
          />
        </Field>
      </FieldGroup>

      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <FieldLabel htmlFor={`${idPrefix}-reasoning`}>
            Enable model reasoning
          </FieldLabel>
          <p className="text-muted-foreground text-xs">
            Sends the provider-default reasoning setting when supported.
          </p>
        </div>
        <Switch
          id={`${idPrefix}-reasoning`}
          checked={values.reasoningEnabled}
          onCheckedChange={(checked) => onChange({ reasoningEnabled: checked })}
        />
      </div>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-api-key`}>
          API key{" "}
          {hasExistingKey ? (
            <span className="font-normal text-muted-foreground">
              (leave blank to keep current)
            </span>
          ) : null}
        </FieldLabel>
        <Input
          id={`${idPrefix}-api-key`}
          type="password"
          value={values.apiKey}
          onChange={(e) => onChange({ apiKey: e.target.value })}
          placeholder="sk-…"
          autoComplete="new-password"
        />
      </Field>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-base-url`}>
          Custom base URL{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </FieldLabel>
        <Input
          id={`${idPrefix}-base-url`}
          value={values.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          placeholder="https://api.example.com/v1"
        />
      </Field>
    </>
  );
}
