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
