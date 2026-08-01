import { z } from "zod";

const SERVICE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const MIDDLEWARE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const SAFE_PATH_PATTERN = /^\/[A-Za-z0-9._~!$&'()+,;=:@%/-]*$/;
const SAFE_REDIRECT_TARGET_PATTERN = /^(?:https?:\/\/[^\r\n\s]+|\/[^\r\n]*)$/i;

export function normalizeDomainHost(value: string): string {
  const suppliedHost = value.trim().replace(/\.$/, "");

  if (
    !suppliedHost ||
    /[/:?#@[\]\\\s]/.test(suppliedHost.replace(/^\*\./, "")) ||
    suppliedHost.includes("..")
  ) {
    throw new Error("Enter a valid public hostname without a protocol or port");
  }

  const isWildcard = suppliedHost.startsWith("*.");
  const hostToTest = isWildcard ? suppliedHost.slice(2) : suppliedHost;

  let hostname: string;
  try {
    hostname = new URL(`https://${hostToTest}`).hostname.toLowerCase();
  } catch {
    throw new Error("Enter a valid public hostname");
  }

  const finalHost = isWildcard ? `*.${hostname}` : hostname;

  if (!HOSTNAME_PATTERN.test(finalHost)) {
    throw new Error(
      "Domains must be fully-qualified hostnames or valid wildcard hostnames (*.example.com)",
    );
  }

  return finalHost;
}

export function normalizeDomainPath(value: string): string {
  const path = value.trim() || "/";

  if (
    !SAFE_PATH_PATTERN.test(path) ||
    path.includes("//") ||
    /(?:^|\/)\.\.?(?:\/|$)/.test(path)
  ) {
    throw new Error(
      "Paths must start with / and cannot contain query strings, fragments, or traversal segments",
    );
  }

  return path.length > 1 ? path.replace(/\/+$/, "") : "/";
}

const DomainMappingInputSchema = z.object({
  /** Disabled routes remain stored but are excluded from the active Caddy config. */
  enabled: z.boolean().optional().default(true),
  host: z.string().min(1).max(253),
  /** Public request path. */
  path: z.string().max(2048).optional().default("/"),
  /** Path prefix expected by the upstream application. */
  internalPath: z.string().max(2048).optional().default("/"),
  stripPath: z.boolean().optional().default(false),
  /** Internal Docker/Swarm service port. */
  port: z.coerce.number().int().min(1).max(65535).optional().default(80),
  /** Required for a compose resource unless its service name is supplied manually. */
  serviceName: z.string().regex(SERVICE_NAME_PATTERN).optional(),
  /** true uses Caddy Automatic HTTPS; false serves HTTP only. */
  https: z.boolean().optional().default(true),
  /** Certificate strategy used by Caddy for HTTPS routes. */
  certificateType: z
    .enum(["letsencrypt", "zerossl", "internal", "custom", "cloudflare"])
    .optional()
    .default("letsencrypt"),
  certificateId: z.string().min(1).optional(),
  /** Names of administrator-defined Caddy snippets to import for this route. */
  middlewares: z
    .array(z.string().regex(MIDDLEWARE_NAME_PATTERN))
    .max(16)
    .optional()
    .default([]),
  /** Optional terminal redirect instead of proxying to the service. */
  redirectTo: z
    .string()
    .max(2048)
    .refine((value) => SAFE_REDIRECT_TARGET_PATTERN.test(value), {
      message: "Redirects must target a relative path or an HTTP(S) URL",
    })
    .optional(),
  redirectStatus: z.enum(["301", "302", "307", "308"]).optional(),
  forwardAuth: z
    .object({
      address: z
        .string()
        .url("Forward-auth address must be a valid URL")
        .refine((value) => {
          try {
            const url = new URL(value);
            return (
              (url.protocol === "http:" || url.protocol === "https:") &&
              !url.username &&
              !url.password &&
              !url.hash
            );
          } catch {
            return false;
          }
        }, "Forward-auth address must use HTTP(S) without credentials or fragments"),
      uri: z
        .string()
        .trim()
        .regex(
          /^\/[A-Za-z0-9._~!$&'()+,;=:@%/?-]*$/,
          "Auth URI must be a safe path",
        )
        .default("/verify"),
      copyHeaders: z
        .array(
          z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/),
        )
        .max(32)
        .default([]),
    })
    .optional(),
  basicAuth: z
    .object({
      username: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._-]{1,128}$/, "Basic-auth username is invalid"),
      passwordHash: z
        .string()
        .trim()
        .min(20)
        .max(512)
        .refine(
          (value) => value.startsWith("$") && !/[\s\r\n]/.test(value),
          "Use a Caddy-compatible password hash, never a plaintext password",
        ),
    })
    .optional(),
  securityHeaders: z
    .object({
      hsts: z.boolean().default(false),
      nosniff: z.boolean().default(true),
      frameDeny: z.boolean().default(false),
      referrerPolicy: z
        .enum([
          "no-referrer",
          "same-origin",
          "strict-origin",
          "strict-origin-when-cross-origin",
        ])
        .nullable()
        .default("strict-origin-when-cross-origin"),
    })
    .optional(),
});

export const DomainMappingSchema = DomainMappingInputSchema.transform(
  (mapping, ctx) => {
    try {
      const path = normalizeDomainPath(mapping.path);
      const internalPath = normalizeDomainPath(mapping.internalPath);
      if (
        mapping.https &&
        mapping.certificateType === "custom" &&
        !mapping.certificateId
      ) {
        throw new Error(
          "A custom certificate must be selected for HTTPS routes",
        );
      }

      return {
        ...mapping,
        host: normalizeDomainHost(mapping.host),
        path,
        internalPath,
        serviceName: mapping.serviceName?.toLowerCase(),
        certificateType: mapping.https
          ? mapping.certificateType
          : "letsencrypt",
        middlewares: [...new Set(mapping.middlewares)],
      };
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "Invalid domain mapping",
      });
      return z.NEVER;
    }
  },
);

export type DomainMapping = {
  enabled: boolean;
  host: string;
  path: string;
  internalPath: string;
  stripPath: boolean;
  port: number;
  serviceName?: string;
  https: boolean;
  certificateType:
    | "letsencrypt"
    | "zerossl"
    | "internal"
    | "custom"
    | "cloudflare";
  certificateId?: string;
  middlewares: string[];
  redirectTo?: string;
  redirectStatus?: "301" | "302" | "307" | "308";
  forwardAuth?: {
    address: string;
    uri: string;
    copyHeaders: string[];
  };
  basicAuth?: {
    username: string;
    passwordHash: string;
  };
  securityHeaders?: {
    hsts: boolean;
    nosniff: boolean;
    frameDeny: boolean;
    referrerPolicy:
      | "no-referrer"
      | "same-origin"
      | "strict-origin"
      | "strict-origin-when-cross-origin"
      | null;
  };
};

/**
 * Parses both the current mapping format and the former `{ host, port }` format.
 * Persisting the normalized result upgrades legacy data without a destructive migration.
 */
export function parseDomainMappings(domainsJson: string): DomainMapping[] {
  let rawMappings: unknown;
  try {
    rawMappings = JSON.parse(domainsJson || "[]");
  } catch {
    throw new Error("Stored domain mappings are not valid JSON");
  }

  // Older UI versions serialized empty optional middleware objects. Treat
  // those values as absent so a harmless generated route remains deployable.
  const normalizedMappings = Array.isArray(rawMappings)
    ? rawMappings.map((mapping) => {
        if (typeof mapping !== "object" || mapping === null) return mapping;
        const value = { ...(mapping as Record<string, unknown>) };
        if (value.redirectTo === "") delete value.redirectTo;

        const forwardAuth = value.forwardAuth;
        if (
          typeof forwardAuth === "object" &&
          forwardAuth !== null &&
          !(forwardAuth as { address?: unknown }).address
        ) {
          delete value.forwardAuth;
        }

        const basicAuth = value.basicAuth;
        if (
          typeof basicAuth === "object" &&
          basicAuth !== null &&
          !(basicAuth as { username?: unknown }).username &&
          !(basicAuth as { passwordHash?: unknown }).passwordHash
        ) {
          delete value.basicAuth;
        }

        return value;
      })
    : rawMappings;

  const mappings = z.array(DomainMappingSchema).safeParse(normalizedMappings);
  if (!mappings.success) {
    throw new Error(
      mappings.error.issues
        .map((issue) => `${issue.path.join(".") || "domain"}: ${issue.message}`)
        .join("; "),
    );
  }

  return mappings.data;
}

export function serializeDomainMappings(mappings: DomainMapping[]): string {
  return JSON.stringify(mappings);
}
