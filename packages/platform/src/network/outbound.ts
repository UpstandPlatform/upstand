import { lookup } from "node:dns/promises";
import net from "node:net";

function ipv4Parts(address: string): number[] | null {
  if (net.isIP(address) !== 4) return null;
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => part >= 0 && part <= 255)
    ? parts
    : null;
}

function isMappedIpv4(address: string): string | null {
  const normalized = address.toLowerCase();
  if (!normalized.startsWith("::ffff:")) return null;
  const suffix = normalized.slice("::ffff:".length);
  if (net.isIP(suffix) === 4) return suffix;
  return null;
}

export function isBlockedAddress(address: string): boolean {
  const normalizedAddress = address.replace(/^\[|\]$/g, "");
  const mapped = isMappedIpv4(normalizedAddress);
  if (mapped) return isBlockedAddress(mapped);

  const ipv4 = ipv4Parts(normalizedAddress);
  if (ipv4) {
    const [a = -1, b = -1] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0) ||
      a >= 224
    );
  }

  if (net.isIP(normalizedAddress) !== 6) return false;
  const normalized = normalizedAddress.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  );
}

export function isRestrictedSshAddress(address: string): boolean {
  const normalizedAddress = address.replace(/^\[|\]$/g, "");
  const mapped = isMappedIpv4(normalizedAddress);
  if (mapped) return isRestrictedSshAddress(mapped);

  const ipv4 = ipv4Parts(normalizedAddress);
  if (ipv4) {
    const [a = -1, b = -1, c = -1, d = -1] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && b === 18) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 169 && b === 254 && c === 169 && d === 254) ||
      a >= 224
    );
  }

  if (net.isIP(normalizedAddress) !== 6) return false;
  const normalized = normalizedAddress.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  );
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Endpoint must be a valid public HTTPS URL");
  }

  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username ||
    url.password ||
    !url.hostname ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    isBlockedAddress(url.hostname)
  ) {
    throw new Error("Endpoint must be a valid public HTTPS URL on port 443");
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Endpoint hostname could not be resolved");
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedAddress(address))
  ) {
    throw new Error("Endpoint must resolve only to public addresses");
  }

  return url;
}

export async function assertSafeSshTarget(host: string): Promise<string> {
  const normalized = host.trim().toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    isRestrictedSshAddress(normalized)
  ) {
    throw new Error("SSH target is not allowed");
  }
  if (net.isIP(normalized)) return normalized;

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(normalized, { all: true, verbatim: true });
  } catch {
    throw new Error("SSH target hostname could not be resolved");
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isRestrictedSshAddress(address))
  ) {
    throw new Error("SSH target resolves to a restricted address");
  }
  return addresses[0]?.address || normalized;
}
