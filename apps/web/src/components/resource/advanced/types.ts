import type { ResourceAdvancedConfig } from "@upstand/domain";

// ──────────────────────────────────────────────────────────────────────────────
// Shared prop types
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Props shared by every advanced-settings card.
 * Cards receive the full config snapshot plus a typed setter so they can
 * update individual top-level keys without knowing about sibling keys.
 */
export type AdvancedCardProps = {
  config: ResourceAdvancedConfig;
  resourceType: string;
  onChange: <K extends keyof ResourceAdvancedConfig>(
    key: K,
    value: ResourceAdvancedConfig[K],
  ) => void;
  composeFile?: string;
  organizationId?: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Line-splitting utility
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Splits a multi-line string into a trimmed, non-empty array of tokens.
 * Used throughout the advanced settings to convert code-editor text into
 * arrays stored in the config schema.
 */
export function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
