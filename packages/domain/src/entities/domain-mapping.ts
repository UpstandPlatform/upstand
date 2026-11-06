import { z } from "zod";

const SERVICE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const MIDDLEWARE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const SAFE_PATH_PATTERN = /^\/[A-Za-z0-9._~!$&'()+,;=:@%/-]*$/;
const SAFE_REDIRECT_TARGET_PATTERN = /^(?:https?:\/\/[^\r\n\s]+|\/[^\r\n]*)$/i;

function isIpv4Address(value: string): boolean {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every(
      (octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255,
    )
  );
}

function isIpv6Address(value: string): boolean {
  if (!value.includes(":")) return false;

  let address = value;
  if (address.includes(".")) {
    const separator = address.lastIndexOf(":");
    if (separator < 0) return false;
    const ipv4Tail = address.slice(separator + 1);
    if (!isIpv4Address(ipv4Tail)) return false;
    const octets = ipv4Tail.split(".").map(Number);
    const firstGroup = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const secondGroup = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    address = `${address.slice(0, separator)}:${firstGroup.toString(16)}:${secondGroup.toString(16)}`;
  }

  if (!/^[a-fA-F0-9:]+$/.test(address)) return false;
  const compressionIndex = address.indexOf("::");
  if (
    address.includes(":::") ||
    (compressionIndex !== -1 && compressionIndex !== address.lastIndexOf("::"))
  ) {
    return false;
  }

  const groups = address.split(":").filter(Boolean);
  if (groups.some((group) => !/^[a-fA-F0-9]{1,4}$/.test(group))) {
    return false;
  }
  return compressionIndex === -1 ? groups.length === 8 : groups.length < 8;
}

/** Validate an IPv4/IPv6 address or CIDR range without runtime-specific APIs. */
export function isValidIpRange(value: string): boolean {
  const parts = value.trim().split("/");
  if (parts.length > 2 || !parts[0]) return false;

  const address = parts[0];
  const isIpv4 = isIpv4Address(address);
  const isIpv6 = !isIpv4 && isIpv6Address(address);
  if (!isIpv4 && !isIpv6) return false;
  if (parts.length === 1) return true;

  const prefix = parts[1];
  if (!prefix || !/^\d{1,3}$/.test(prefix)) return false;
  const prefixLength = Number(prefix);
  return prefixLength <= (isIpv4 ? 32 : 128);
}

const IpRangeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidIpRange, "Use a valid IPv4 or IPv6 address or CIDR range");

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

const BlockedUserAgentSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine(
    (value) =>
      ![...value].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      }),
    "User-agent filters cannot contain control characters",
  );

export const DOMAIN_HTTP_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

export const DomainHttpMethodSchema = z.enum(DOMAIN_HTTP_METHODS);

export type DomainHttpMethod = z.infer<typeof DomainHttpMethodSchema>;

export const DomainRequestFiltersInputSchema = z.object({
  blockedIpRanges: z.array(IpRangeSchema).max(64),
  blockedUserAgents: z.array(BlockedUserAgentSchema).max(32),
  allowedMethods: z
    .array(DomainHttpMethodSchema)
    .max(DOMAIN_HTTP_METHODS.length)
    .optional()
    .default([]),
  denyEmptyUserAgent: z.boolean().optional().default(false),
  /** Reject requests that carry a Referer from another hostname. */
  hotlinkProtection: z.boolean().optional().default(false),
});

export const DomainRequestFiltersSchema =
  DomainRequestFiltersInputSchema.default({
    blockedIpRanges: [],
    blockedUserAgents: [],
    allowedMethods: [],
    denyEmptyUserAgent: false,
    hotlinkProtection: false,
  });

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

export function isLocalOrInternalHost(host: string): boolean {
  const normalized = host.toLowerCase().trim().replace(/^\*\./, "");
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".test") ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".sslip.io") ||
    normalized.endsWith(".nip.io")
  ) {
    return true;
  }

  if (
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(normalized) ||
    /^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(normalized)
  ) {
    return true;
  }

  return false;
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
  /** Native Caddy filters applied before route middleware and proxying. */
  requestFilters: DomainRequestFiltersSchema.optional().default({
    blockedIpRanges: [],
    blockedUserAgents: [],
    allowedMethods: [],
    denyEmptyUserAgent: false,
    hotlinkProtection: false,
  }),
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
        requestFilters: {
          blockedIpRanges: [...new Set(mapping.requestFilters.blockedIpRanges)],
          blockedUserAgents: uniqueCaseInsensitive(
            mapping.requestFilters.blockedUserAgents,
          ),
          allowedMethods: [...new Set(mapping.requestFilters.allowedMethods)],
          denyEmptyUserAgent: mapping.requestFilters.denyEmptyUserAgent,
          hotlinkProtection: mapping.requestFilters.hotlinkProtection,
        },
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
  requestFilters: {
    blockedIpRanges: string[];
    blockedUserAgents: string[];
    allowedMethods: DomainHttpMethod[];
    denyEmptyUserAgent: boolean;
    hotlinkProtection: boolean;
  };
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

/** Parse and validate the persisted domain mapping document. */
export function parseDomainMappings(domainsJson: string): DomainMapping[] {
  let rawMappings: unknown;
  try {
    rawMappings = JSON.parse(domainsJson || "[]");
  } catch {
    throw new Error("Stored domain mappings are not valid JSON");
  }

  const mappings = z.array(DomainMappingSchema).safeParse(rawMappings);
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
