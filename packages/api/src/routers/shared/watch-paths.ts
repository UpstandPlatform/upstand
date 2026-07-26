function nonEmptyStrings(value: string[]): string[] {
  return value.filter((item) => item.trim().length > 0);
}

/** Normalizes persisted JSON watch paths and already-parsed request values. */
export function parseWatchPaths(
  value: string[] | string | undefined,
): string[] {
  if (Array.isArray(value)) return nonEmptyStrings(value);
  if (typeof value !== "string") return [];

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? nonEmptyStrings(
          parsed.filter(
            (item): item is string =>
              typeof item === "string" && item.trim().length > 0,
          ),
        )
      : [];
  } catch {
    return [];
  }
}
