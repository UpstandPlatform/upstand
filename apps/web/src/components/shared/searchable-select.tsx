"use client";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@upstand/ui/components/combobox";
import { cn } from "@upstand/ui/lib/utils";

type Props = {
  value: string;
  options: readonly string[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  ariaLabel?: string;
  className?: string;
};

export function SearchableSelect({
  value,
  options,
  onValueChange,
  placeholder = "Select an option…",
  emptyLabel = "No matching options",
  ariaLabel,
  className,
}: Props) {
  return (
    <Combobox
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next);
      }}
    >
      <ComboboxInput
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        showClear
        className={cn("w-full", className)}
      />
      <ComboboxContent>
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          {(option) => (
            <ComboboxItem key={option} value={option}>
              {option}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
