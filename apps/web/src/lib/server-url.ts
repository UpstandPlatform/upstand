import { env } from "@upstand/env/web";

const PLACEHOLDER_HOST = /(?:^|\.)example\.invalid$/;

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

function isDirectHost(hostname: string): boolean {
  return isLoopbackHost(hostname) || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
}

function parseConfiguredUrl(configured: string | undefined): URL | null {
  if (!configured) return null;
  try {
    return new URL(configured);
  } catch {
    return null;
  }
}

function isConfiguredOrigin(url: URL | null): url is URL {
  return Boolean(url && !PLACEHOLDER_HOST.test(url.hostname));
}

function isDirectOrigin(url: URL): boolean {
  return (
    isDirectHost(url.hostname) || url.port === "3000" || url.port === "3001"
  );
}

function getDesktopApiOrigin(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const desktop = (
    window as Window & {
      upstandDesktop?: {
        runtime?: { apiOrigin?: unknown; docsOrigin?: unknown };
        local?: { apiOrigin?: unknown };
      };
    }
  ).upstandDesktop;
  // The desktop shell exposes the active profile's API origin synchronously so
  // auth and API clients never accidentally use the embedded API when the
  // window is connected to Cloud or another self-hosted control plane.
  const value = desktop?.runtime?.apiOrigin ?? desktop?.local?.apiOrigin;
  return typeof value === "string" && value ? value : undefined;
}

function getDesktopDocsOrigin(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const desktop = (
    window as Window & {
      upstandDesktop?: { runtime?: { docsOrigin?: unknown } };
    }
  ).upstandDesktop;
  const value = desktop?.runtime?.docsOrigin;
  return typeof value === "string" && value ? value : undefined;
}

function inferApiOrigin(protocol: string, hostname: string, port = ""): string {
  const apiHostname = isDirectHost(hostname)
    ? hostname
    : inferSiblingHostname(hostname, "api");
  const apiPort =
    port === "3001" ? "3000" : isLoopbackHost(hostname) ? "3000" : port;
  const portSuffix = apiPort ? `:${apiPort}` : "";

  return new URL(`${protocol}//${apiHostname}${portSuffix}`).origin;
}

function inferSiblingHostname(hostname: string, sibling: "api" | "docs") {
  if (hostname === "localhost" || isLoopbackHost(hostname)) {
    return hostname;
  }

  if (hostname.startsWith(`${sibling}.`)) {
    return hostname;
  }

  for (const prefix of ["api.", "docs."]) {
    if (hostname.startsWith(prefix)) {
      return `${sibling}.${hostname.slice(prefix.length)}`;
    }
  }

  for (const prefix of ["app.", "dashboard.", "console.", "www."]) {
    if (hostname.startsWith(prefix)) {
      return `${sibling}.${hostname.slice(prefix.length)}`;
    }
  }

  return `${sibling}.${hostname}`;
}

/** Resolve the API origin at runtime for immutable self-hosted web images. */
export function getServerUrl(configured = env.NEXT_PUBLIC_SERVER_URL): string {
  const desktopApiOrigin = getDesktopApiOrigin();
  if (desktopApiOrigin) return desktopApiOrigin;
  const configuredUrl = parseConfiguredUrl(configured);

  if (
    isConfiguredOrigin(configuredUrl) &&
    (typeof window === "undefined" ||
      !isDirectOrigin(configuredUrl) ||
      configuredUrl.hostname === window.location.hostname)
  ) {
    return configuredUrl.origin;
  }

  if (typeof window !== "undefined") {
    return inferApiOrigin(
      window.location.protocol,
      window.location.hostname,
      window.location.port,
    );
  }

  return "http://localhost:3000";
}

/** Resolve the API origin for a dashboard request rendered on the server. */
export function getServerUrlFromHeaders(
  requestHeaders: Headers,
  configured = env.NEXT_PUBLIC_SERVER_URL,
): string {
  const internalUrl = parseConfiguredUrl(env.UPSTAND_SERVER_INTERNAL_URL);
  const configuredUrl = parseConfiguredUrl(configured);
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = (forwardedHost || requestHeaders.get("host") || "localhost:3001")
    .split(",")[0]
    .trim();
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim();
  try {
    const hostUrl = new URL(`http://${host}`);
    // A direct IP request is the user's explicit recovery path. Resolve the
    // sibling API on that same host instead of sending SSR back to a service
    // name that is only reachable inside the container network.
    if (internalUrl && !isDirectHost(hostUrl.hostname)) {
      return internalUrl.origin;
    }
    const protocol =
      forwardedProtocol === "http" || forwardedProtocol === "https"
        ? `${forwardedProtocol}:`
        : isDirectHost(hostUrl.hostname)
          ? "http:"
          : "https:";
    const requestUrl = new URL(`${protocol}//${host}`);
    if (
      isConfiguredOrigin(configuredUrl) &&
      (isDirectOrigin(requestUrl)
        ? isDirectOrigin(configuredUrl) &&
          configuredUrl.hostname === requestUrl.hostname
        : !isDirectOrigin(configuredUrl))
    ) {
      return configuredUrl.origin;
    }
    return inferApiOrigin(
      requestUrl.protocol,
      requestUrl.hostname,
      requestUrl.port,
    );
  } catch {
    return "http://localhost:3000";
  }
}

/** Build an absolute URL for an API route. */
export function getServerApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalizedPath, `${getServerUrl()}/`).toString();
}

/** Resolve the documentation URL (Fumadocs) dynamically for development and production. */
export function getDocsUrl(path = ""): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const docsPath = normalizedPath.startsWith("/docs")
    ? normalizedPath
    : `/docs${normalizedPath}`;

  const desktopDocsOrigin = getDesktopDocsOrigin();
  if (desktopDocsOrigin) {
    return `${desktopDocsOrigin}${docsPath}`;
  }

  if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    if (isDirectHost(hostname) && (port === "3001" || port === "3000")) {
      return `http://${hostname}:4000${docsPath}`;
    }
    return `${protocol}//${inferSiblingHostname(hostname, "docs")}${docsPath}`;
  }

  const configuredServerUrl = parseConfiguredUrl(env.NEXT_PUBLIC_SERVER_URL);
  if (isConfiguredOrigin(configuredServerUrl)) {
    if (isDirectOrigin(configuredServerUrl)) {
      return `${configuredServerUrl.protocol}//${configuredServerUrl.hostname}:4000${docsPath}`;
    }

    const docsHostname = inferSiblingHostname(
      configuredServerUrl.hostname,
      "docs",
    );
    return `${configuredServerUrl.protocol}//${docsHostname}${docsPath}`;
  }

  return `http://localhost:4000${docsPath}`;
}
