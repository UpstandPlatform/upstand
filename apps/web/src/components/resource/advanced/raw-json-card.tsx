"use client";

import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { cn } from "@upstand/ui/lib/utils";
import { CodeEditor, CodeSurface } from "@/components/shared/code-editor";

// ──────────────────────────────────────────────────────────────────────────────
// Raw JSON Card
// ──────────────────────────────────────────────────────────────────────────────

type Props = {
  /** The current raw JSON string value displayed in the editor. */
  rawJson: string;
  /** Whether the contained JSON is currently parseable and schema-valid. */
  isValid: boolean;
  /** Whether the parent save mutation is in-flight. */
  isSaving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
};

/**
 * Power-user escape hatch — renders the full `ResourceAdvancedConfig` as a
 * JSON editor.  Validity is determined by the parent component so this card
 * remains a pure presentational component that never touches the schema itself.
 */
export function RawJsonCard({
  rawJson,
  isValid,
  isSaving,
  onChange,
  onSave,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Raw JSON configuration</CardTitle>
        <CardDescription>
          Power users can edit the complete typed advanced configuration
          directly. Changes are validated against the schema before saving.
        </CardDescription>
      </CardHeader>

      <CardContent className="border-t pt-5">
        <CodeSurface>
          <CodeEditor
            language="json"
            height="420px"
            value={rawJson}
            onChange={onChange}
            aria-label="Advanced resource configuration JSON"
          />
        </CodeSurface>

        <div className={cn("mt-3 flex items-center justify-between gap-3")}>
          {!isValid && (
            <p role="alert" className="text-destructive text-sm">
              JSON does not match the configuration schema — fix errors before
              saving.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            className="ml-auto"
            onClick={onSave}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Validate & save JSON"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
