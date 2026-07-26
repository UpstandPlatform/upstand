import { isIP } from "node:net";
import { env } from "@upstand/env/server";

const MAX_FORWARDED_FOR_LENGTH = 4096;
const MAX_PROXY_HOPS = 20;

type IpFamily = 4 | 6;

export type TrustedProxyNetwork = {
  family: IpFamily;
  address: string;
  prefixLength: number;
};

export type ClientIpInput = {
  peerAddress: string | null | undefined;
  forwardedFor?: string | null;
  realIp?: string | null;
  trustedProxyNetworks?: readonly TrustedProxyNetwork[];
};

function normalizeIpv4(value: string): string | null {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !/^\d{1,3}$/.test(part) || Number(part) < 0 || Number(part) > 255,
    )
  )
    return null;
  return parts.map((part) => String(Number(part))).join(".");
}

function parseIpv6Groups(value: string): number[] | null {
  const [leftText, rightText, extra] = value.split("::");
  if (extra !== undefined) return null;
  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const groups = side.split(":");
    const result: number[] = [];
    for (const group of groups) {
      if (!group) return null;
      if (group.includes(".")) {
        const ipv4 = normalizeIpv4(group);
        if (!ipv4) return null;
        const octets = ipv4.split(".").map(Number);
        const [first, second, third, fourth] = octets;
        if (
          first === undefined ||
          second === undefined ||
          third === undefined ||
          fourth === undefined
        )
          return null;
        result.push((first << 8) | second);
        result.push((third << 8) | fourth);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
        result.push(Number.parseInt(group, 16));
      }
    }
    return result;
  };

  const left = parseSide(leftText ?? "");
  const right = parseSide(rightText ?? "");
  if (!left || !right) return null;
  if (value.includes("::")) {
    if (left.length + right.length >= 8) return null;
    return [
      ...left,
      ...Array(8 - left.length - right.length).fill(0),
      ...right,
    ];
  }
  return left.length === 8 ? left : null;
}

function ipv6GroupsToString(groups: number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length; index += 1) {
    if (groups[index] !== 0) continue;
    let end = index;
    while (end < groups.length && groups[end] === 0) end += 1;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end - 1;
  }
  if (bestLength < 2) {
    return groups.map((group) => group.toString(16)).join(":");
  }
  const left = groups
    .slice(0, bestStart)
    .map((group) => group.toString(16))
    .join(":");
  const right = groups
    .slice(bestStart + bestLength)
    .map((group) => group.toString(16))
    .join(":");
  if (left && right) return `${left}::${right}`;
  if (left) return `${left}::`;
  return `::${right}`;
}

function stripAddressPort(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const closingBracket = trimmed.indexOf("]");
    if (closingBracket > 0) return trimmed.slice(1, closingBracket);
  }
  if (isIP(trimmed)) return trimmed;
  const separator = trimmed.lastIndexOf(":");
  if (separator > 0 && /^\d+$/.test(trimmed.slice(separator + 1))) {
    return trimmed.slice(0, separator);
  }
  return trimmed;
}

export function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = stripAddressPort(value);
  if (/^\d+(?:\.\d+){3}$/.test(candidate)) {
    return normalizeIpv4(candidate);
  }
  const version = isIP(candidate);
  if (version === 4) return normalizeIpv4(candidate);
  if (version !== 6 || candidate.includes("%")) return null;
  const groups = parseIpv6Groups(candidate.toLowerCase());
  if (!groups) return null;
  const mappedHigh = groups[6];
  const mappedLow = groups[7];
  if (
    groups.slice(0, 5).every((group) => group === 0) &&
    groups[5] === 0xffff &&
    mappedHigh !== undefined &&
    mappedLow !== undefined
  ) {
    return [
      mappedHigh >> 8,
      mappedHigh & 0xff,
      mappedLow >> 8,
      mappedLow & 0xff,
    ].join(".");
  }
  return ipv6GroupsToString(groups);
}

function ipToGroups(ip: string): { family: IpFamily; groups: number[] } | null {
  const normalized = normalizeIp(ip);
  if (!normalized) return null;
  if (isIP(normalized) === 4) {
    return {
      family: 4,
      groups: normalized.split(".").map(Number),
    };
  }
  const groups = parseIpv6Groups(normalized);
  if (!groups) return null;
  return { family: 6, groups };
}

export function parseTrustedProxyCidrs(
  value?: string | null,
): TrustedProxyNetwork[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const parts = item.split("/");
      const [addressText, prefixText] = parts;
      const address = addressText ? normalizeIp(addressText) : null;
      if (
        !address ||
        parts.length > 2 ||
        (prefixText && !/^\d+$/.test(prefixText))
      ) {
        throw new Error(`Invalid trusted proxy CIDR: ${item}`);
      }
      const family = isIP(address) as IpFamily;
      const bits = family === 4 ? 32 : 128;
      const prefixLength = prefixText ? Number.parseInt(prefixText, 10) : bits;
      if (prefixLength < 0 || prefixLength > bits) {
        throw new Error(`Invalid trusted proxy CIDR prefix: ${item}`);
      }
      return {
        family,
        address,
        prefixLength,
      };
    });
}

function isTrustedProxy(
  address: string,
  networks: readonly TrustedProxyNetwork[],
): boolean {
  const parsed = ipToGroups(address);
  if (!parsed) return false;
  return networks.some((network) => {
    if (network.family !== parsed.family) return false;
    const networkGroups = ipToGroups(network.address)?.groups;
    if (!networkGroups) return false;
    const bitsPerGroup = parsed.family === 4 ? 8 : 16;
    const completeGroups = Math.floor(network.prefixLength / bitsPerGroup);
    const remainder = network.prefixLength % bitsPerGroup;
    for (let index = 0; index < completeGroups; index += 1) {
      if (parsed.groups[index] !== networkGroups[index]) return false;
    }
    if (remainder === 0) return true;
    const mask = (2 ** bitsPerGroup - 1) << (bitsPerGroup - remainder);
    const parsedGroup = parsed.groups[completeGroups];
    const networkGroup = networkGroups[completeGroups];
    return (
      parsedGroup !== undefined &&
      networkGroup !== undefined &&
      (parsedGroup & mask) === (networkGroup & mask)
    );
  });
}

const configuredTrustedProxyNetworks = parseTrustedProxyCidrs(
  env.TRUSTED_PROXY_CIDRS,
);

export function resolveClientIp({
  peerAddress,
  forwardedFor,
  realIp,
  trustedProxyNetworks = configuredTrustedProxyNetworks,
}: ClientIpInput): string {
  const peer = normalizeIp(peerAddress);
  if (!peer) return "unknown";
  if (!isTrustedProxy(peer, trustedProxyNetworks)) return peer;

  if (forwardedFor && forwardedFor.length <= MAX_FORWARDED_FOR_LENGTH) {
    const forwardedAddresses = forwardedFor.split(",");
    if (forwardedAddresses.length <= MAX_PROXY_HOPS) {
      const normalized = forwardedAddresses.map((address) =>
        normalizeIp(address),
      );
      if (normalized.every((address): address is string => address !== null)) {
        let current = peer;
        for (let index = normalized.length - 1; index >= 0; index -= 1) {
          if (!isTrustedProxy(current, trustedProxyNetworks)) break;
          current = normalized[index] ?? current;
        }
        return current;
      }
    }
    return peer;
  }

  return normalizeIp(realIp) ?? peer;
}
