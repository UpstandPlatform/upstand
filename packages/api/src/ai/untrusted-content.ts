import { z } from "zod";

const MAX_EXTERNAL_OUTPUT_CHARS = 64_000;
const MAX_EXTERNAL_STRING_CHARS = 4_000;
const MAX_EXTERNAL_ARRAY_ITEMS = 20;
const MAX_EXTERNAL_OBJECT_ENTRIES = 48;
const MAX_EXTERNAL_NODES = 4_096;

export const externalUntrustedOutputSchema = z.object({
  provenance: z.literal("external-untrusted"),
  source: z.string().trim().min(1).max(80),
  data: z.unknown(),
});

export type ExternalUntrustedOutput = z.infer<
  typeof externalUntrustedOutputSchema
>;

type BoundState = {
  nodes: number;
  used: number;
};

function reserve(state: BoundState, amount: number): boolean {
  if (state.used + amount > MAX_EXTERNAL_OUTPUT_CHARS) return false;
  state.used += amount;
  return true;
}

/**
 * Convert provider/MCP output into bounded JSON-like data before it reaches
 * the model. This is a data boundary, not an instruction parser: callers
 * must still treat every returned string as untrusted content.
 */
export function boundExternalModelValue(
  value: unknown,
  depth = 0,
  state: BoundState = { nodes: 0, used: 0 },
  seen = new WeakSet<object>(),
): unknown {
  if (depth > 5) return "[output truncated]";
  if (state.nodes >= MAX_EXTERNAL_NODES) return "[output truncated]";
  state.nodes += 1;

  if (typeof value === "string") {
    const bounded = value.slice(0, MAX_EXTERNAL_STRING_CHARS);
    return reserve(state, bounded.length) ? bounded : "[output truncated]";
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : "[unsupported output]";
  }
  if (typeof value !== "object") return "[unsupported output]";
  if (seen.has(value)) return "[circular output]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_EXTERNAL_ARRAY_ITEMS)
      .map((item) => boundExternalModelValue(item, depth + 1, state, seen));
  }

  const bounded: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(
    0,
    MAX_EXTERNAL_OBJECT_ENTRIES,
  )) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    if (state.used >= MAX_EXTERNAL_OUTPUT_CHARS) break;
    bounded[key.slice(0, 200)] = boundExternalModelValue(
      item,
      depth + 1,
      state,
      seen,
    );
  }
  return bounded;
}

export function wrapExternalUntrustedOutput<TSource extends string, TData>(
  source: TSource,
  data: TData,
): {
  provenance: "external-untrusted";
  source: TSource;
  data: TData;
} {
  return externalUntrustedOutputSchema.parse({
    provenance: "external-untrusted",
    source,
    data: boundExternalModelValue(data),
  }) as {
    provenance: "external-untrusted";
    source: TSource;
    data: TData;
  };
}
