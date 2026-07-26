import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { ValidateDomainUseCase } from "./validate-domain.usecase";

mock.module("node:dns/promises", () => {
  return {
    resolve4: async (host: string) => {
      if (host === "cloudflare.example.com") return ["104.16.0.1"];
      if (host === "expected.example.com") return ["192.168.1.1"];
      if (host === "unexpected.example.com") return ["192.168.1.2"];
      if (host === "cname-cf.example.com") return ["1.1.1.1"];
      if (host === "http-cf.example.com") return ["1.1.1.1"];
      if (host === "arvan.example.com") return ["94.101.182.1"];
      if (host === "http-arvan.example.com") return ["1.1.1.1"];
      if (host === "cname-arvan.example.com") return ["1.1.1.1"];
      throw new Error("ENOTFOUND");
    },
    resolve6: async (host: string) => {
      if (host === "ipv6-only.example.com") return ["2001:db8::1"];
      if (host === "expected-ipv6.example.com") return ["2001:db8::1"];
      throw new Error("ENOTFOUND");
    },
    resolveCname: async (host: string) => {
      if (host === "cname-cf.example.com") return ["xyz.cloudfront.net"];
      if (host === "cname-arvan.example.com") return ["xyz.arvancloud.ir"];
      throw new Error("ENODATA");
    },
  };
});

describe("ValidateDomainUseCase", () => {
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    const fetchImplementation = Object.assign(
      async (url: string | URL | Request): Promise<Response> => {
        const parsedUrl = new URL(url.toString());
        const headers = new Headers();

        if (parsedUrl.hostname === "http-cf.example.com") {
          headers.set("cf-ray", "1234567890");
          headers.set("server", "cloudflare");
        }

        if (parsedUrl.hostname === "http-arvan.example.com") {
          headers.set("ar-ray", "abcdef1234");
          headers.set("server", "arvancloud");
        }

        return new Response(null, { headers, status: 200 });
      },
      { preconnect: () => undefined },
    );
    globalThis.fetch = fetchImplementation;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("rejects malformed hostnames before DNS resolution", async () => {
    await expect(
      new ValidateDomainUseCase().execute({
        organizationId: "org-1",
        host: "https://bad..example.com",
      }),
    ).rejects.toThrow("valid domain hostname");
  });

  test("detects CDN via HTTP response headers (Cloudflare)", async () => {
    const result = await new ValidateDomainUseCase().execute({
      organizationId: "org-1",
      host: "http-cf.example.com",
    });
    expect(result.isValid).toBe(true);
    expect(result.cdnProvider).toBe("Cloudflare");
    expect(result.resolvedIps).toEqual(["1.1.1.1"]);
  });

  test("detects CDN via HTTP response headers (Arvancloud)", async () => {
    const result = await new ValidateDomainUseCase().execute({
      organizationId: "org-1",
      host: "http-arvan.example.com",
    });
    expect(result.isValid).toBe(true);
    expect(result.cdnProvider).toBe("Arvancloud");
    expect(result.resolvedIps).toEqual(["1.1.1.1"]);
  });

  test("detects CDN via IP range (Cloudflare)", async () => {
    const result = await new ValidateDomainUseCase().execute({
      organizationId: "org-1",
      host: "cloudflare.example.com",
    });
    expect(result.isValid).toBe(true);
    expect(result.cdnProvider).toBe("Cloudflare");
    expect(result.resolvedIps).toEqual(["104.16.0.1"]);
  });

  test("detects CDN via IP range (Arvancloud)", async () => {
    const result = await new ValidateDomainUseCase().execute({
      organizationId: "org-1",
      host: "arvan.example.com",
    });
    expect(result.isValid).toBe(true);
    expect(result.cdnProvider).toBe("Arvancloud");
    expect(result.resolvedIps).toEqual(["94.101.182.1"]);
  });

  test("detects CDN via CNAME pattern (AWS CloudFront)", async () => {
    const result = await new ValidateDomainUseCase().execute({
      organizationId: "org-1",
      host: "cname-cf.example.com",
    });
    expect(result.isValid).toBe(true);
    expect(result.cdnProvider).toBe("AWS CloudFront");
    expect(result.resolvedIps).toEqual(["1.1.1.1"]);
  });

  test("detects CDN via CNAME pattern (Arvancloud)", async () => {
    const result = await new ValidateDomainUseCase().execute({
      organizationId: "org-1",
      host: "cname-arvan.example.com",
    });
    expect(result.isValid).toBe(true);
    expect(result.cdnProvider).toBe("Arvancloud");
    expect(result.resolvedIps).toEqual(["1.1.1.1"]);
  });

  test("validates expected IP match", async () => {
    const result = await new ValidateDomainUseCase().execute({
      organizationId: "org-1",
      host: "expected.example.com",
      expectedIp: "192.168.1.1",
    });
    expect(result.isValid).toBe(true);
    expect(result.cdnProvider).toBeNull();
    expect(result.resolvedIps).toEqual(["192.168.1.1"]);
  });

  test("validates expected IPv6 match", async () => {
    const result = await new ValidateDomainUseCase().execute({
      organizationId: "org-1",
      host: "expected-ipv6.example.com",
      expectedIp: "2001:db8::1",
    });
    expect(result.isValid).toBe(true);
    expect(result.cdnProvider).toBeNull();
    expect(result.resolvedIps).toEqual(["2001:db8::1"]);
  });

  test("resolves IPv6-only domains", async () => {
    const result = await new ValidateDomainUseCase().execute({
      organizationId: "org-1",
      host: "ipv6-only.example.com",
    });
    expect(result.isValid).toBe(true);
    expect(result.cdnProvider).toBeNull();
    expect(result.resolvedIps).toEqual(["2001:db8::1"]);
  });

  test("detects mismatch in expected IP", async () => {
    const result = await new ValidateDomainUseCase().execute({
      organizationId: "org-1",
      host: "unexpected.example.com",
      expectedIp: "192.168.1.1",
    });
    expect(result.isValid).toBe(false);
    expect(result.cdnProvider).toBeNull();
    expect(result.warning).toContain("192.168.1.2");
  });

  test("handles resolution failure gracefully", async () => {
    const result = await new ValidateDomainUseCase().execute({
      organizationId: "org-1",
      host: "nonexistent.example.com",
    });
    expect(result.isValid).toBe(false);
    expect(result.cdnProvider).toBeNull();
    expect(result.warning).toBe("ENOTFOUND");
  });
});
