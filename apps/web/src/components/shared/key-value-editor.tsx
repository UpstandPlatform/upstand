"use client";

import { Delete02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@upstand/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import { Input } from "@upstand/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@upstand/ui/components/input-group";
import { cn } from "@upstand/ui/lib/utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Eye, EyeOff } from "@/components/huge-icons";
import { CodeEditor } from "@/components/shared/code-editor";

export type KeyValuePair = { key: string; value: string };

export function recordToKeyValuePairs(
  record: Record<string, string>,
): KeyValuePair[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

export function keyValuePairsToRecord(
  pairs: KeyValuePair[],
): Record<string, string> {
  return Object.fromEntries(
    pairs
      .map(({ key, value }) => [key.trim(), value] as const)
      .filter(([key]) => key.length > 0),
  );
}

export type KeyValueIssue = {
  index: number;
  message: string;
};

const DEFAULT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateKeyValuePairs(
  pairs: KeyValuePair[],
  options: { keyPattern?: RegExp; keyLabel?: string } = {},
): KeyValueIssue[] {
  const issues: KeyValueIssue[] = [];
  const seen = new Map<string, number>();
  const pattern = options.keyPattern ?? DEFAULT_KEY_PATTERN;
  const label = options.keyLabel ?? "Key";

  pairs.forEach((pair, index) => {
    const key = pair.key.trim();
    if (!key) {
      issues.push({ index, message: `${label} is required` });
      return;
    }
    if (!pattern.test(key)) {
      issues.push({
        index,
        message: `${label} must use letters, numbers, and underscores`,
      });
    }
    const previous = seen.get(key);
    if (previous !== undefined) {
      issues.push({
        index,
        message: `${label} duplicates row ${previous + 1}`,
      });
    } else {
      seen.set(key, index);
    }
  });

  return issues;
}

export function parseBulkEnv(text: string): KeyValuePair[] {
  const lines = text.split("\n");
  const pairs: KeyValuePair[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      pairs.push({ key: trimmed, value: "" });
    } else {
      const key = trimmed.substring(0, eqIdx).trim();
      let val = trimmed.substring(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.substring(1, val.length - 1);
      }
      pairs.push({ key, value: val });
    }
  }
  return pairs;
}

export function formatBulkEnv(pairs: KeyValuePair[]): string {
  return pairs
    .map((p) => {
      const key = p.key.trim();
      if (!key) return "";
      const val = p.value;
      const needsQuotes = /\s|#|=|"|'/.test(val);
      const displayVal = needsQuotes
        ? `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
        : val;
      return `${key}=${displayVal}`;
    })
    .filter(Boolean)
    .join("\n");
}

type Props = {
  value: KeyValuePair[];
  onChange: (value: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  keyLabel?: string;
  keyPattern?: RegExp;
  className?: string;
};

export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = "KEY",
  valuePlaceholder = "Value",
  addLabel = "Add variable",
  keyLabel = "Key",
  keyPattern,
  className,
}: Props) {
  const issues = validateKeyValuePairs(value, { keyPattern, keyLabel });
  const issueFor = (index: number) =>
    issues.find((issue) => issue.index === index);

  const [maskedIndices, setMaskedIndices] = useState<Set<number>>(new Set());
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  // Auto-mask keys that look like secrets
  useEffect(() => {
    setMaskedIndices((prev) => {
      const next = new Set(prev);
      value.forEach((item, index) => {
        const isSecret = /pass|key|secret|token|auth|credential|cert|jwt/i.test(
          item.key,
        );
        if (isSecret && !next.has(index)) {
          next.add(index);
        }
      });
      return next;
    });
  }, [value]);

  const update = (index: number, patch: Partial<KeyValuePair>) => {
    onChange(
      value.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  };

  const toggleMask = (index: number) => {
    setMaskedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = [...value];
    const temp = next[index];
    next[index] = next[index - 1];
    next[index - 1] = temp;
    onChange(next);
  };

  const moveDown = (index: number) => {
    if (index === value.length - 1) return;
    const next = [...value];
    const temp = next[index];
    next[index] = next[index + 1];
    next[index + 1] = temp;
    onChange(next);
  };

  const handleClearAll = () => {
    if (confirmClear) {
      onChange([]);
      setConfirmClear(false);
      toast.success("Cleared all variables");
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
    }
  };

  const openBulkEdit = () => {
    setBulkText(formatBulkEnv(value));
    setIsBulkOpen(true);
  };

  const saveBulkEdit = () => {
    try {
      const parsed = parseBulkEnv(bulkText);
      onChange(parsed);
      setIsBulkOpen(false);
      toast.success("Bulk import applied successfully");
    } catch {
      toast.error("Failed to parse bulk configuration. Check format.");
    }
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openBulkEdit}
            className="h-8 font-semibold text-xs"
          >
            Bulk Import / Export
          </Button>
          {value.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant={confirmClear ? "destructive" : "outline"}
              onClick={handleClearAll}
              className="h-8 font-semibold text-xs transition-all"
            >
              {confirmClear ? "Confirm Clear?" : "Clear All"}
            </Button>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...value, { key: "", value: "" }])}
          className="h-8 font-semibold text-xs"
        >
          <HugeiconsIcon
            icon={PlusSignIcon}
            data-icon="inline-start"
            className="mr-1.5"
          />
          {addLabel}
        </Button>
      </div>

      {value.length === 0 ? (
        <div className="rounded-xl border border-border/60 border-dashed bg-muted/5 p-8 text-center text-muted-foreground text-xs transition-colors hover:bg-muted/10">
          <p className="font-medium text-slate-400">No variables configured</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Click "{addLabel}" or use "Bulk Import / Export" to get started.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {value.map((item, index) => {
            const issue = issueFor(index);
            const isMasked = maskedIndices.has(index);
            return (
              <div
                className="grid grid-cols-[1fr_1.5fr_auto_auto] items-start gap-2"
                key={index}
              >
                {/* Key Input */}
                <div className="flex min-w-0 flex-col gap-1">
                  <Input
                    value={item.key}
                    placeholder={keyPlaceholder}
                    aria-label={`${keyLabel} ${index + 1}`}
                    aria-invalid={Boolean(issue)}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) =>
                      update(index, { key: event.target.value })
                    }
                    className={cn(
                      "h-8 font-mono text-xs uppercase transition-colors",
                      issue &&
                        "border-destructive focus-visible:ring-destructive/30",
                    )}
                  />
                  {issue && (
                    <p className="px-1 text-[10px] text-destructive leading-tight">
                      {issue.message}
                    </p>
                  )}
                </div>

                {/* Value Input */}
                <InputGroup className="h-8 min-w-0">
                  <InputGroupInput
                    value={item.value}
                    type={isMasked ? "password" : "text"}
                    placeholder={valuePlaceholder}
                    aria-label={`Value ${index + 1}`}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) =>
                      update(index, { value: event.target.value })
                    }
                    className="font-mono text-xs"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      onClick={() => toggleMask(index)}
                      aria-label={isMasked ? "Show value" : "Hide value"}
                    >
                      {isMasked ? (
                        <Eye className="size-3.5" />
                      ) : (
                        <EyeOff className="size-3.5" />
                      )}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>

                {/* Reordering */}
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === 0}
                    onClick={() => moveUp(index)}
                    className="h-8 w-8 text-muted-foreground hover:bg-muted"
                    aria-label={`Move row ${index + 1} up`}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === value.length - 1}
                    onClick={() => moveDown(index)}
                    className="h-8 w-8 text-muted-foreground hover:bg-muted"
                    aria-label={`Move row ${index + 1} down`}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                </div>

                {/* Delete */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${item.key || `row ${index + 1}`}`}
                  onClick={() =>
                    onChange(
                      value.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  className="h-8 w-8 text-destructive hover:bg-destructive/10"
                >
                  <HugeiconsIcon icon={Delete02Icon} className="size-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Bulk Import / Export Dialog */}
      <Dialog open={isBulkOpen} onOpenChange={setIsBulkOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Bulk Import / Export</DialogTitle>
            <DialogDescription>
              Paste environment variables in{" "}
              <code className="rounded bg-muted/40 px-1 font-mono text-xs">
                KEY=VALUE
              </code>{" "}
              format (one per line) or copy the formatted text below.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <CodeEditor
              value={bulkText}
              onChange={setBulkText}
              language="shell"
              height="280px"
              mode="editor"
              showToolbar
              showStatusBar
              allowLanguageChange={false}
              placeholder="PORT=3000&#10;NODE_ENV=production&#10;DATABASE_URL=postgres://..."
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsBulkOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={saveBulkEdit}>
              Apply Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
