import { isIP } from "node:net";
import type { GitProvider } from "@upstand/domain";
import { env } from "@upstand/env/server";

const REDACTED = "[configured]";

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|metadata\.google\.internal)$/i;
const TRUSTED_PUBLIC_HOSTS = new Set([
  "api.github.com",
  "github.com",
  "api.bitbucket.org",
  "gitlab.com",
  "gitea.com",
  "gitea.com",
]);

export function assertSafeProviderUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Git provider URL is invalid");
  }
  if (url.protocol !== "https:") {
    throw new Error("Git provider URLs must use HTTPS");
  }
  if (url.username || url.password || url.pathname.includes("\\")) {
    throw new Error(
      "Git provider URL contains unsupported credentials or path",
    );
  }
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host)) {
    throw new Error("Git provider URL points to a private or local host");
  }
  if (isIP(host)) {
    throw new Error("Git provider URLs must use a verified hostname");
  }
  const allowlisted = (env.UPSTAND_GIT_PROVIDER_ALLOWED_HOSTS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (
    allowlisted.length &&
    !allowlisted.includes(host) &&
    !TRUSTED_PUBLIC_HOSTS.has(host)
  ) {
    throw new Error("Git provider host is not in the operator allowlist");
  }
  return url.origin;
}

export function validateGitProviderConfig(
  provider: string,
  config: string,
): void {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(config);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error();
    }
    parsed = value as Record<string, unknown>;
  } catch {
    throw new Error("Git provider configuration must be valid JSON");
  }
  const urlKey =
    provider === "gitlab"
      ? "gitlabUrl"
      : provider === "gitea"
        ? "giteaUrl"
        : null;
  if (urlKey && typeof parsed[urlKey] !== "string") {
    throw new Error(`Git provider configuration requires ${urlKey}`);
  }
  if (urlKey) assertSafeProviderUrl(parsed[urlKey] as string);
}

const isSecretKey = (key: string): boolean =>
  /(secret|token|password|private.?key|pem|api.?key)/i.test(key);

const redactValue = (value: unknown, key?: string): unknown => {
  if (key && isSecretKey(key)) {
    if (value === null || value === undefined || value === "") return value;
    return REDACTED;
  }

  if (Array.isArray(value)) return value.map((item) => redactValue(item));

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey),
      ]),
    );
  }

  return value;
};

/**
 * Return provider metadata safe for browser/API responses. OAuth and deploy
 * paths use the repository's decrypted internal entity; this representation
 * intentionally preserves only non-secret settings and configured markers.
 */
export function redactGitProviderConfig(config: string): string {
  try {
    return JSON.stringify(redactValue(JSON.parse(config)));
  } catch {
    return JSON.stringify({});
  }
}

export function redactGitProvider(provider: GitProvider): GitProvider {
  return { ...provider, config: redactGitProviderConfig(provider.config) };
}

/** Merge a browser payload without allowing redacted markers to erase secrets. */
export function restoreGitProviderConfig(
  existingConfig: string,
  incomingConfig: string,
): string {
  try {
    const existing = JSON.parse(existingConfig) as unknown;
    const incoming = JSON.parse(incomingConfig) as unknown;
    const restore = (current: unknown, next: unknown): unknown => {
      if (next === REDACTED) return current;
      if (Array.isArray(next))
        return next.map((item) => restore(undefined, item));
      if (next && typeof next === "object") {
        const currentRecord =
          current && typeof current === "object" && !Array.isArray(current)
            ? (current as Record<string, unknown>)
            : {};
        return Object.fromEntries(
          Object.entries(next).map(([key, value]) => [
            key,
            restore(currentRecord[key], value),
          ]),
        );
      }
      return next;
    };
    return JSON.stringify(restore(existing, incoming));
  } catch {
    return incomingConfig;
  }
}
