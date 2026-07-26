"use client";

import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@upstand/ui/components/field";
import { useEffect, useState } from "react";
import {
  type KeyValuePair,
  keyValuePairsToRecord,
  recordToKeyValuePairs,
  KeyValueEditor as SharedKeyValueEditor,
} from "../shared/key-value-editor";

type KeyValueEditorProps = {
  id: string;
  label: string;
  description: string;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
};

export function ResourceKeyValueEditor({
  id,
  label,
  description,
  value,
  onChange,
}: KeyValueEditorProps) {
  const [pairs, setPairs] = useState<KeyValuePair[]>(() =>
    recordToKeyValuePairs(value),
  );

  useEffect(() => {
    const currentRecord = keyValuePairsToRecord(pairs);
    if (JSON.stringify(currentRecord) !== JSON.stringify(value)) {
      setPairs(recordToKeyValuePairs(value));
    }
  }, [pairs, value]);

  return (
    <Field>
      <div>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </div>
      <SharedKeyValueEditor
        value={pairs}
        onChange={(next) => {
          setPairs(next);
          onChange(keyValuePairsToRecord(next));
        }}
        keyPlaceholder="KEY"
        valuePlaceholder="Value"
        addLabel="Add entry"
        keyLabel={label}
      />
    </Field>
  );
}
