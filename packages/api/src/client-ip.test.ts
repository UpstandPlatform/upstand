import { describe, expect, test } from "bun:test";
import {
  normalizeIp,
  parseTrustedProxyCidrs,
  resolveClientIp,
} from "./client-ip";

describe("trusted proxy client IP resolution", () => {
  test("normalizes equivalent IPv4 and IPv6 forms", () => {
    expect(normalizeIp("192.168.001.010")).toBe("192.168.1.10");
    expect(normalizeIp("[2001:0DB8:0:0:0:0:0:1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("::ffff:192.0.2.10")).toBe("192.0.2.10");
  });

  test("ignores forwarding headers from an untrusted peer", () => {
    const trusted = parseTrustedProxyCidrs("10.0.0.0/8");
    expect(
      resolveClientIp({
        peerAddress: "203.0.113.10",
        forwardedFor: "198.51.100.10",
        realIp: "198.51.100.11",
        trustedProxyNetworks: trusted,
      }),
    ).toBe("203.0.113.10");
  });

  test("uses the rightmost untrusted address through trusted proxies", () => {
    const trusted = parseTrustedProxyCidrs("10.0.0.0/8,192.0.2.0/24");
    expect(
      resolveClientIp({
        peerAddress: "10.1.0.5",
        forwardedFor: "198.51.100.10, 192.0.2.8, 10.2.0.7",
        trustedProxyNetworks: trusted,
      }),
    ).toBe("198.51.100.10");
  });

  test("falls back to the socket peer for malformed or oversized headers", () => {
    const trusted = parseTrustedProxyCidrs("10.0.0.0/8");
    expect(
      resolveClientIp({
        peerAddress: "10.1.0.5",
        forwardedFor: "not-an-ip",
        realIp: "198.51.100.10",
        trustedProxyNetworks: trusted,
      }),
    ).toBe("10.1.0.5");
    expect(
      resolveClientIp({
        peerAddress: "10.1.0.5",
        forwardedFor: "x".repeat(4097),
        trustedProxyNetworks: trusted,
      }),
    ).toBe("10.1.0.5");
  });

  test("uses the real-ip header only for a trusted peer", () => {
    const trusted = parseTrustedProxyCidrs("10.0.0.0/8");
    expect(
      resolveClientIp({
        peerAddress: "10.1.0.5",
        realIp: "198.51.100.10",
        trustedProxyNetworks: trusted,
      }),
    ).toBe("198.51.100.10");
  });
});
