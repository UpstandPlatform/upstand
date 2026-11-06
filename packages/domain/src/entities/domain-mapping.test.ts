import { describe, expect, test } from "bun:test";
import { normalizeDomainHost, parseDomainMappings } from "./domain-mapping";

describe("Domain Mapping Wildcard & Cloudflare Support", () => {
  test("normalizes standard fully-qualified hostnames", () => {
    expect(normalizeDomainHost("app.example.com")).toBe("app.example.com");
    expect(normalizeDomainHost("SUB.DOMAIN.ORG.")).toBe("sub.domain.org");
  });

  test("normalizes valid wildcard hostnames", () => {
    expect(normalizeDomainHost("*.example.com")).toBe("*.example.com");
    expect(normalizeDomainHost("*.sub.domain.org")).toBe("*.sub.domain.org");
  });

  test("rejects invalid domains or malformed wildcards", () => {
    expect(() => normalizeDomainHost("invalid..domain")).toThrow();
    expect(() => normalizeDomainHost("http://example.com")).toThrow();
    expect(() => normalizeDomainHost("not a domain")).toThrow();
  });

  test("parses domain mappings with cloudflare certificate strategy", () => {
    const raw = JSON.stringify([
      {
        host: "*.example.com",
        path: "/",
        port: 8080,
        https: true,
        certificateType: "cloudflare",
      },
    ]);
    const mappings = parseDomainMappings(raw);
    expect(mappings.length).toBe(1);
    expect(mappings[0]?.host).toBe("*.example.com");
    expect(mappings[0]?.certificateType).toBe("cloudflare");
  });

  test.each([
    "letsencrypt",
    "zerossl",
    "internal",
    "custom",
    "cloudflare",
  ] as const)("supports the %s certificate provider", (provider) => {
    const mappings = parseDomainMappings(
      JSON.stringify([
        {
          host: `${provider}.example.com`,
          certificateType: provider,
          certificateId: provider === "custom" ? "certificate-1" : undefined,
        },
      ]),
    );

    expect(mappings[0]?.certificateType).toBe(provider);
  });

  test("requires a selected custom certificate for HTTPS routes", () => {
    expect(() =>
      parseDomainMappings(
        JSON.stringify([
          { host: "secure.example.com", certificateType: "custom" },
        ]),
      ),
    ).toThrow("A custom certificate must be selected");
  });

  test("validates and normalizes route request filters", () => {
    const mappings = parseDomainMappings(
      JSON.stringify([
        {
          host: "filters.example.com",
          requestFilters: {
            blockedIpRanges: ["203.0.113.4", "2001:db8::/48", "203.0.113.4"],
            blockedUserAgents: ["ExampleBot", "examplebot", "curl"],
          },
        },
      ]),
    );

    expect(mappings[0]?.requestFilters).toEqual({
      blockedIpRanges: ["203.0.113.4", "2001:db8::/48"],
      blockedUserAgents: ["ExampleBot", "curl"],
      hotlinkProtection: false,
    });
  });

  test("preserves hotlink protection for a route and defaults it for older filters", () => {
    const mappings = parseDomainMappings(
      JSON.stringify([
        {
          host: "assets.example.com",
          requestFilters: {
            blockedIpRanges: [],
            blockedUserAgents: [],
            hotlinkProtection: true,
          },
        },
        {
          host: "legacy.example.com",
          requestFilters: { blockedIpRanges: [], blockedUserAgents: [] },
        },
      ]),
    );

    expect(
      mappings.map((mapping) => mapping.requestFilters.hotlinkProtection),
    ).toEqual([true, false]);
  });

  test.each([
    "256.1.1.1",
    "192.0.2.1/33",
    "2001:db8::/129",
    "2001:::1",
    "192.0.2.1/24/1",
  ])("rejects invalid IP range %s", (blockedIpRange) => {
    expect(() =>
      parseDomainMappings(
        JSON.stringify([
          {
            host: "filters.example.com",
            requestFilters: { blockedIpRanges: [blockedIpRange] },
          },
        ]),
      ),
    ).toThrow("valid IPv4 or IPv6 address or CIDR range");
  });

  test("defaults request filters for routes saved before the feature", () => {
    const mappings = parseDomainMappings(
      JSON.stringify([{ host: "legacy.example.com" }]),
    );

    expect(mappings[0]?.requestFilters).toEqual({
      blockedIpRanges: [],
      blockedUserAgents: [],
      hotlinkProtection: false,
    });
  });

  test("does not require a certificate id for HTTP routes", () => {
    const mappings = parseDomainMappings(
      JSON.stringify([
        {
          host: "insecure.example.com",
          https: false,
          certificateType: "custom",
        },
      ]),
    );

    expect(mappings[0]).toMatchObject({
      https: false,
      certificateType: "letsencrypt",
    });
  });
});
