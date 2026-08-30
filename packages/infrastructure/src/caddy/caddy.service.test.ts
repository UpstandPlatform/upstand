import { describe, expect, test } from "bun:test";
import { parseDomainMappings } from "@upstand/domain";
import {
  CaddyService,
  generateCaddyfileContent,
  hasPinnedImage,
} from "./caddy.service";

test("recognizes only the pinned Caddy image digest", () => {
  const reference = "caddy:2.8-alpine@sha256:abc123";
  expect(
    hasPinnedImage({ RepoDigests: ["caddy@sha256:abc123"] }, reference),
  ).toBe(true);
  expect(
    hasPinnedImage({ RepoDigests: ["caddy@sha256:other"] }, reference),
  ).toBe(false);
  expect(hasPinnedImage({ RepoTags: ["caddy:2.8-alpine"] }, reference)).toBe(
    false,
  );
});

test("uses the typed broker for local Caddy provisioning", async () => {
  let provisioningInput: Record<string, unknown> | undefined;
  const service = new CaddyService({} as never, ["localhost"], {
    ensureCaddyContainer: async (input) => {
      provisioningInput = input as unknown as Record<string, unknown>;
    },
  });

  await service.initializeCaddy();

  expect(provisioningInput).toMatchObject({
    networkName: "upstand-network",
    forceRecreate: false,
    ports: [
      { protocol: "tcp", targetPort: 80, publishedPort: 80 },
      { protocol: "tcp", targetPort: 443, publishedPort: 443 },
      { protocol: "udp", targetPort: 443, publishedPort: 443 },
    ],
  });
  expect(provisioningInput?.caddyfileBase64).toBeString();
  expect(provisioningInput?.environment).toEqual([
    expect.stringContaining("UPSTAND_CADDYFILE_B64="),
  ]);
});

test("uses the typed broker for control-plane IP access", async () => {
  let enabled: boolean | undefined;
  const service = new CaddyService({} as never, ["localhost"], {
    ensureCaddyContainer: async () => {},
    setControlPlaneIpAccess: async (value) => {
      enabled = value;
    },
  });

  await service.setControlPlaneIpAccess(false);

  expect(enabled).toBe(false);
});

test("uses the typed broker for local Caddy configuration sync", async () => {
  let configurationInput:
    | { caddyfileBase64: string; certificates: unknown[] }
    | undefined;
  const service = new CaddyService(
    { listNetworks: async () => [] } as never,
    ["localhost"],
    {
      ensureCaddyContainer: async () => undefined,
      applyCaddyConfiguration: async (input) => {
        configurationInput = input;
        return { changed: true };
      },
    },
  );

  const result = await service.syncResourceConfigs([], {}, []);

  expect(result).toMatchObject({ success: true, changed: true, domains: [] });
  expect(configurationInput?.caddyfileBase64).toBeString();
  expect(configurationInput?.certificates).toEqual([]);
});

describe("Caddy domain configuration", () => {
  test("normalizes validated mappings and creates an Automatic HTTPS site", () => {
    const mappings = parseDomainMappings(
      JSON.stringify([{ host: "APP.Example.com.", port: 3000 }]),
    );

    expect(mappings).toEqual([
      {
        host: "app.example.com",
        path: "/",
        internalPath: "/",
        stripPath: false,
        port: 3000,
        serviceName: undefined,
        enabled: true,
        certificateType: "letsencrypt",
        https: true,
        middlewares: [],
      },
    ]);

    const caddyfile = generateCaddyfileContent(
      {
        letsEncryptEmail: "ops@example.com",
        caddySnippets: "(security-headers) {\n\theader -Server\n}",
      },
      [
        {
          id: "resource-1",
          name: "Application",
          type: "application",
          appName: "application",
          domains: JSON.stringify(mappings),
        },
      ],
    );

    expect(caddyfile).toContain("email ops@example.com");
    expect(caddyfile).toContain("(security-headers) {");
    expect(caddyfile).toContain("app.example.com {");
    expect(caddyfile).toContain("reverse_proxy application:3000");
    expect(caddyfile).not.toContain("http://app.example.com");
  });

  test("creates an Automatic HTTPS site without email when letsEncryptEmail is not provided", () => {
    const mappings = parseDomainMappings(
      JSON.stringify([{ host: "app.example.com", port: 3000 }]),
    );

    const caddyfile = generateCaddyfileContent({}, [
      {
        id: "resource-1",
        name: "Application",
        type: "application",
        appName: "application",
        domains: JSON.stringify(mappings),
      },
    ]);

    expect(caddyfile).not.toContain("email ");
    expect(caddyfile).toContain("app.example.com {");
    expect(caddyfile).toContain("reverse_proxy application:3000");
  });

  test("keeps disabled domain mappings out of the active Caddy config", () => {
    const caddyfile = generateCaddyfileContent({}, [
      {
        id: "resource-1",
        name: "Application",
        type: "application",
        appName: "application",
        domains: JSON.stringify([
          { host: "disabled.example.com", port: 3000, enabled: false },
          { host: "active.example.com", port: 3000 },
        ]),
      },
    ]);

    expect(caddyfile).not.toContain("disabled.example.com");
    expect(caddyfile).toContain("active.example.com");
  });

  test("preserves route order and compiles rewrites, Caddy snippets, and path stripping", () => {
    const caddyfile = generateCaddyfileContent({}, [
      {
        id: "resource-1",
        name: "API",
        type: "application",
        appName: "api",
        domains: JSON.stringify([
          {
            host: "example.com",
            path: "/api",
            internalPath: "/v1",
            port: 3000,
            serviceName: "api-service",
            https: true,
            middlewares: ["security-headers", "auth"],
          },
          {
            host: "example.com",
            path: "/assets",
            internalPath: "/",
            stripPath: true,
            port: 8080,
            serviceName: "asset-service",
            https: true,
            middlewares: [],
          },
        ]),
      },
    ]);

    expect(caddyfile).toContain("uri replace /api /v1");
    expect(caddyfile).toContain("import security-headers");
    expect(caddyfile).toContain("import auth");
    expect(caddyfile).toContain("reverse_proxy api-service:3000");
    expect(caddyfile).toContain("uri strip_prefix /assets");
    expect(caddyfile).toContain("reverse_proxy asset-service:8080");
    expect(caddyfile).toContain('respond "Not found" 404');
    expect(caddyfile.indexOf("/assets")).toBeLessThan(
      caddyfile.indexOf("/api"),
    );
  });

  test("rejects unsafe mappings and conflicting ownership", () => {
    expect(() =>
      parseDomainMappings(JSON.stringify([{ host: "https://example.com" }])),
    ).toThrow("valid public hostname");
    expect(() =>
      parseDomainMappings(
        JSON.stringify([{ host: "example.com", path: "/admin*" }]),
      ),
    ).toThrow("Paths must start with /");

    expect(() =>
      generateCaddyfileContent({}, [
        {
          id: "resource-1",
          name: "First",
          type: "application",
          appName: "first",
          domains: JSON.stringify([{ host: "example.com", path: "/" }]),
        },
        {
          id: "resource-2",
          name: "Second",
          type: "application",
          appName: "second",
          domains: JSON.stringify([{ host: "example.com", path: "/" }]),
        },
      ]),
    ).toThrow("already assigned");
  });

  test("requires an explicit service for compose resources", () => {
    expect(() =>
      generateCaddyfileContent({}, [
        {
          id: "compose-1",
          name: "Storefront",
          type: "compose",
          appName: "storefront",
          domains: JSON.stringify([{ host: "shop.example.com", port: 3000 }]),
        },
      ]),
    ).toThrow("needs an explicit service name");
  });

  test("uses the Swarm stack service name for Compose routes", () => {
    const caddyfile = generateCaddyfileContent({}, [
      {
        id: "compose-1",
        name: "Storefront",
        type: "compose",
        appName: "storefront",
        domains: JSON.stringify([
          { host: "shop.example.com", port: 3000, serviceName: "web" },
        ]),
      },
    ]);

    expect(caddyfile).toContain("reverse_proxy storefront_web:3000");
  });

  test("uses the Compose service DNS name for standalone Compose routes", () => {
    const caddyfile = generateCaddyfileContent({}, [
      {
        id: "compose-2",
        name: "Storefront",
        type: "compose",
        composeType: "compose",
        appName: "storefront",
        domains: JSON.stringify([
          { host: "shop.example.com", port: 3000, serviceName: "web" },
        ]),
      },
    ]);

    expect(caddyfile).toContain("reverse_proxy web:3000");
    expect(caddyfile).not.toContain("reverse_proxy storefront_web:3000");
  });

  test("does not mix HTTP-only and HTTPS routes on one hostname", () => {
    expect(() =>
      generateCaddyfileContent({}, [
        {
          id: "resource-1",
          name: "Secure API",
          type: "application",
          appName: "secure-api",
          domains: JSON.stringify([
            { host: "example.com", path: "/api", https: true },
          ]),
        },
        {
          id: "resource-2",
          name: "HTTP route",
          type: "application",
          appName: "http-route",
          domains: JSON.stringify([
            { host: "example.com", path: "/http", https: false },
          ]),
        },
      ]),
    ).toThrow("same HTTPS setting");
  });

  test("emits an internal certificate policy for private HTTPS routes", () => {
    const caddyfile = generateCaddyfileContent({}, [
      {
        id: "resource-1",
        name: "Private app",
        type: "application",
        appName: "private-app",
        domains: JSON.stringify([
          {
            host: "private.example.com",
            port: 3000,
            certificateType: "internal",
          },
        ]),
      },
    ]);

    expect(caddyfile).toContain("private.example.com {");
    expect(caddyfile).toContain("tls internal");
  });

  test("renders ZeroSSL ACME configuration with and without an email", () => {
    const withEmail = generateCaddyfileContent(
      { letsEncryptEmail: "ops@example.com" },
      [
        {
          id: "zerossl-email",
          name: "ZeroSSL app",
          type: "application",
          appName: "zerossl-app",
          domains: JSON.stringify([
            {
              host: "zerossl.example.com",
              certificateType: "zerossl",
            },
          ]),
        },
      ],
    );
    const withoutEmail = generateCaddyfileContent({}, [
      {
        id: "zerossl-no-email",
        name: "ZeroSSL app",
        type: "application",
        appName: "zerossl-app",
        domains: JSON.stringify([
          { host: "zerossl.example.com", certificateType: "zerossl" },
        ]),
      },
    ]);

    expect(withEmail).toContain("tls ops@example.com {");
    expect(withoutEmail).toContain("tls {");
    expect(withEmail).toContain("ca https://acme.zerossl.com/v2/DV90");
    expect(withoutEmail).toContain("ca https://acme.zerossl.com/v2/DV90");
  });

  test("renders Cloudflare DNS-01 configuration with a fallback token", () => {
    const caddyfile = generateCaddyfileContent({}, [
      {
        id: "cf-fallback",
        name: "Cloudflare app",
        type: "application",
        appName: "cloudflare-app",
        domains: JSON.stringify([
          { host: "*.example.com", certificateType: "cloudflare" },
        ]),
      },
    ]);

    expect(caddyfile).toContain("dns cloudflare {env.CLOUDFLARE_API_TOKEN}");
  });

  test("rejects conflicting certificate strategies on one HTTPS hostname", () => {
    expect(() =>
      generateCaddyfileContent({}, [
        {
          id: "resource-1",
          name: "First",
          type: "application",
          appName: "first",
          domains: JSON.stringify([
            {
              host: "same.example.com",
              path: "/one",
              certificateType: "letsencrypt",
            },
            {
              host: "same.example.com",
              path: "/two",
              certificateType: "internal",
            },
          ]),
        },
      ]),
    ).toThrow("same certificate strategy");
  });

  test("provisions and references a selected custom certificate", () => {
    const caddyfile = generateCaddyfileContent(
      {},
      [
        {
          id: "resource-custom-cert",
          name: "Custom TLS app",
          type: "application",
          appName: "custom-tls-app",
          domains: JSON.stringify([
            {
              host: "secure.example.com",
              port: 3000,
              https: true,
              certificateType: "custom",
              certificateId: "cert-1",
            },
          ]),
        },
      ],
      [
        {
          id: "cert-1",
          certificatePem: "CERTIFICATE",
          privateKeyPem: "PRIVATE KEY",
        },
      ],
    );

    expect(caddyfile).toContain(
      "tls /etc/caddy/certificates/cert-1.crt /etc/caddy/certificates/cert-1.key",
    );
  });

  test("rejects a custom route whose certificate is not available", () => {
    expect(() =>
      generateCaddyfileContent({}, [
        {
          id: "resource-custom-cert",
          name: "Custom TLS app",
          type: "application",
          appName: "custom-tls-app",
          domains: JSON.stringify([
            {
              host: "secure.example.com",
              port: 3000,
              https: true,
              certificateType: "custom",
              certificateId: "missing",
            },
          ]),
        },
      ]),
    ).toThrow("was not found");
  });

  test("emits validated redirects and security headers for a route", () => {
    const caddyfile = generateCaddyfileContent({}, [
      {
        id: "resource-redirect",
        name: "redirect",
        type: "application",
        appName: "redirect",
        composeType: null,
        domains: JSON.stringify([
          {
            host: "http.example.com",
            path: "/old",
            port: 80,
            https: true,
            certificateType: "letsencrypt",
            middlewares: [],
            redirectTo: "https://example.com{uri}",
            redirectStatus: "308",
            securityHeaders: {
              hsts: true,
              nosniff: true,
              frameDeny: true,
              referrerPolicy: "strict-origin",
            },
          },
        ]),
      },
    ]);

    expect(caddyfile).toContain('redir "https://example.com{uri}" 308');
    expect(caddyfile).toContain("Strict-Transport-Security");
    expect(caddyfile).toContain('X-Frame-Options "DENY"');
  });

  test("emits forward-auth middleware with only validated header names", () => {
    const caddyfile = generateCaddyfileContent({}, [
      {
        id: "resource-auth",
        name: "protected",
        type: "application",
        appName: "protected",
        domains: JSON.stringify([
          {
            host: "protected.example.com",
            forwardAuth: {
              address: "https://auth.example.com",
              uri: "/verify",
              copyHeaders: ["X-User", "X-Email"],
            },
          },
        ]),
      },
    ]);

    expect(caddyfile).toContain('forward_auth "https://auth.example.com" {');
    expect(caddyfile).toContain('uri "/verify"');
    expect(caddyfile).toContain("copy_headers X-User");
    expect(caddyfile).toContain("copy_headers X-Email");
  });

  test("rejects private forward-auth endpoints unless explicitly allowlisted", () => {
    expect(() =>
      generateCaddyfileContent({}, [
        {
          id: "resource-private-auth",
          name: "private auth",
          type: "application",
          appName: "private-auth",
          domains: JSON.stringify([
            {
              host: "private-auth.example.com",
              forwardAuth: {
                address: "http://127.0.0.1:8080/verify",
                uri: "/verify",
                copyHeaders: [],
              },
            },
          ]),
        },
      ]),
    ).toThrow("Forward-auth endpoint is not allowed");

    const previousAllowedHosts = process.env.UPSTAND_OUTBOUND_ALLOWED_HOSTS;
    process.env.UPSTAND_OUTBOUND_ALLOWED_HOSTS = "auth.internal.example.com";
    try {
      expect(() =>
        generateCaddyfileContent({}, [
          {
            id: "resource-allowed-auth",
            name: "allowed auth",
            type: "application",
            appName: "allowed-auth",
            domains: JSON.stringify([
              {
                host: "allowed-auth.example.com",
                forwardAuth: {
                  address: "http://auth.internal.example.com:8080/verify",
                  uri: "/verify",
                  copyHeaders: [],
                },
              },
            ]),
          },
        ]),
      ).not.toThrow();
    } finally {
      if (previousAllowedHosts === undefined) {
        delete process.env.UPSTAND_OUTBOUND_ALLOWED_HOSTS;
      } else {
        process.env.UPSTAND_OUTBOUND_ALLOWED_HOSTS = previousAllowedHosts;
      }
    }
  });

  test("re-resolves allowlisted forward-auth endpoints before live sync", async () => {
    const service = new CaddyService({} as never, ["localhost"]);
    await expect(
      service.syncResourceConfigs([
        {
          id: "resource-runtime-auth",
          name: "runtime auth",
          type: "application",
          appName: "runtime-auth",
          domains: JSON.stringify([
            {
              host: "runtime-auth.example.com",
              forwardAuth: {
                address: "http://localhost:8080/verify",
                uri: "/verify",
                copyHeaders: [],
              },
            },
          ]),
        },
      ]),
    ).rejects.toThrow("blocked address");
  });

  test("renders typed managed middlewares before resource routes", () => {
    const caddyfile = generateCaddyfileContent(
      {
        caddyMiddlewares: JSON.stringify([
          { name: "security-headers", body: "header -Server" },
          { name: "compression", body: "encode zstd gzip" },
        ]),
      },
      [
        {
          id: "resource-managed-middleware",
          name: "managed middleware",
          type: "application",
          appName: "managed-middleware",
          domains: JSON.stringify([
            {
              host: "managed.example.com",
              middlewares: ["security-headers", "compression"],
            },
          ]),
        },
      ],
    );

    expect(caddyfile).toContain("(security-headers) {");
    expect(caddyfile).toContain("(compression) {");
    expect(caddyfile).toContain("import security-headers");
    expect(caddyfile).toContain("import compression");
    expect(caddyfile.indexOf("(security-headers) {")).toBeLessThan(
      caddyfile.indexOf("managed.example.com {"),
    );
  });

  test("emits hashed basic authentication without accepting plaintext", () => {
    const caddyfile = generateCaddyfileContent({}, [
      {
        id: "resource-basic-auth",
        name: "basic protected",
        type: "application",
        appName: "basic-protected",
        domains: JSON.stringify([
          {
            host: "basic.example.com",
            basicAuth: {
              username: "admin",
              passwordHash:
                "$2a$14$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuu",
            },
          },
        ]),
      },
    ]);

    expect(caddyfile).toContain("basic_auth {");
    expect(caddyfile).toContain(
      "admin $2a$14$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuu",
    );
  });

  test("does not allow custom configuration to expose Caddy's admin API", () => {
    expect(() =>
      generateCaddyfileContent({ globalCaddyfile: "admin :2019" }),
    ).toThrow("managed by Upstand");
    expect(() =>
      generateCaddyfileContent({ caddySnippets: "admin :2019" }),
    ).toThrow("managed by Upstand");
    expect(() =>
      generateCaddyfileContent({
        caddyMiddlewares: JSON.stringify([
          { name: "unsafe", body: "admin :2019" },
        ]),
      }),
    ).toThrow("managed by Upstand");
  });

  test("keeps HTTP and HTTPS listeners distinct", () => {
    expect(() =>
      generateCaddyfileContent({ httpPort: 8443, httpsPort: 8443 }),
    ).toThrow("must be different");
    expect(() => generateCaddyfileContent({ httpPort: 2019 })).toThrow(
      "private admin API port",
    );
  });

  test("enables structured access logs only when requested", () => {
    const disabled = generateCaddyfileContent({}, [
      {
        id: "resource-logs",
        name: "Logged app",
        type: "application",
        appName: "logged-app",
        domains: JSON.stringify([{ host: "logs.example.com", port: 3000 }]),
      },
    ]);
    const enabled = generateCaddyfileContent({ accessLogsEnabled: true }, [
      {
        id: "resource-logs",
        name: "Logged app",
        type: "application",
        appName: "logged-app",
        domains: JSON.stringify([{ host: "logs.example.com", port: 3000 }]),
      },
    ]);

    expect(disabled).not.toContain("output file /var/log/caddy/access.log");
    expect(enabled).toContain("format json");
    expect(enabled).toContain("output file /var/log/caddy/access.log");
  });

  test("renders tls block with Cloudflare DNS-01 challenge for wildcard hostnames", () => {
    const caddyfile = generateCaddyfileContent(
      { cloudflareApiToken: "cf-token-secret-123" },
      [
        {
          id: "cf-wildcard",
          name: "Wildcard App",
          type: "application",
          appName: "wildcard-app",
          domains: JSON.stringify([
            {
              host: "*.example.com",
              port: 3000,
              https: true,
              certificateType: "cloudflare",
            },
          ]),
        },
      ],
    );

    expect(caddyfile).toContain("*.example.com {");
    expect(caddyfile).toContain("tls {");
    expect(caddyfile).toContain("dns cloudflare cf-token-secret-123");
  });
});
