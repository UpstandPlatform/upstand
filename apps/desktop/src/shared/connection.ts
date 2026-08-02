export type DesktopConnectionProfile = {
  id: string;
  name: string;
  mode: "desktop" | "self-hosted" | "cloud";
  origin: string;
  isActive: boolean;
};

export type DesktopConnection = {
  origin: string;
  activeProfileId?: string;
  profiles?: DesktopConnectionProfile[];
};

/**
 * Desktop may connect to a local development/self-hosted instance over HTTP,
 * but remote control planes must use TLS. Credentials and non-web schemes are
 * deliberately rejected before they ever reach Electron navigation APIs.
 */
export function normalizeUpstandOrigin(value: string): string {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Use an http or https Upstand URL.");
  }
  if (url.username || url.password) {
    throw new Error("Connection URLs must not contain credentials.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Enter the Upstand instance origin without a path.");
  }

  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !isLoopback) {
    throw new Error("Remote Upstand instances must use https.");
  }
  return url.origin;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

export function isAllowedNavigation(
  target: string,
  connection: DesktopConnection | null,
): boolean {
  if (!connection) return false;
  try {
    const targetUrl = new URL(target);
    const connectionUrl = new URL(connection.origin);

    if (targetUrl.origin === connectionUrl.origin) return true;

    if (
      isLoopbackHost(targetUrl.hostname) &&
      isLoopbackHost(connectionUrl.hostname) &&
      targetUrl.port === connectionUrl.port &&
      targetUrl.protocol === connectionUrl.protocol
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
