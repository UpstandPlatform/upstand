import { describe, expect, test } from "bun:test";
import {
  buildServerDomainCaddySnippet,
  SERVER_DOMAIN_MARKER_END,
  SERVER_DOMAIN_MARKER_START,
  syncServerDomainInCaddySnippets,
} from "./server-domain-caddy.helper";

describe("server-domain-caddy.helper", () => {
  test("returns empty string when domain is missing or invalid", () => {
    expect(buildServerDomainCaddySnippet({})).toBe("");
    expect(buildServerDomainCaddySnippet({ serverDomain: "" })).toBe("");
    expect(
      buildServerDomainCaddySnippet({ serverDomain: "invalid domain" }),
    ).toBe("");
  });

  test("generates plain HTTP Caddy block when https is disabled", () => {
    const result = buildServerDomainCaddySnippet({
      serverDomain: "upstand.example.com",
      httpsEnabled: false,
    });

    expect(result).toContain("http://upstand.example.com {");
    expect(result).toContain("reverse_proxy /api/*");
  });

  test("generates Let's Encrypt SSL Caddy block with email", () => {
    const result = buildServerDomainCaddySnippet({
      serverDomain: "upstand.dev",
      httpsEnabled: true,
      certificateProvider: "letsencrypt",
      letsEncryptEmail: "1839491@gmail.com",
    });

    expect(result).toContain("upstand.dev {");
    expect(result).toContain("tls 1839491@gmail.com");
    expect(result).toContain("reverse_proxy /api/*");
  });

  test("generates Let's Encrypt SSL Caddy block without email", () => {
    const result = buildServerDomainCaddySnippet({
      serverDomain: "upstand.dev",
      httpsEnabled: true,
      certificateProvider: "letsencrypt",
    });

    expect(result).toContain("upstand.dev {");
    expect(result).not.toContain("tls ");
    expect(result).toContain("reverse_proxy /api/*");
  });

  test("generates ZeroSSL Caddy block with email", () => {
    const result = buildServerDomainCaddySnippet({
      serverDomain: "upstand.dev",
      httpsEnabled: true,
      certificateProvider: "zerossl",
      letsEncryptEmail: "user@example.com",
    });

    expect(result).toContain("upstand.dev {");
    expect(result).toContain("ca https://acme.zerossl.com/v2/DV90");
  });

  test("generates self-signed internal TLS block", () => {
    const result = buildServerDomainCaddySnippet({
      serverDomain: "local.upstand.test",
      httpsEnabled: true,
      certificateProvider: "self-signed",
    });

    expect(result).toContain("local.upstand.test {");
    expect(result).toContain("tls internal");
  });

  test("generates custom certificate TLS block", () => {
    const result = buildServerDomainCaddySnippet({
      serverDomain: "custom.upstand.test",
      httpsEnabled: true,
      certificateProvider: "custom",
      certificateId: "cert-999-abc",
    });

    expect(result).toContain("custom.upstand.test {");
    expect(result).toContain(
      "tls /etc/caddy/certificates/cert-999-abc.crt /etc/caddy/certificates/cert-999-abc.key",
    );
  });

  test("generates internal TLS block when custom certificateId is missing", () => {
    const result = buildServerDomainCaddySnippet({
      serverDomain: "custom.upstand.test",
      httpsEnabled: true,
      certificateProvider: "custom",
    });

    expect(result).toContain("custom.upstand.test {");
    expect(result).toContain("tls internal");
  });

  test("generates plain HTTP Caddy block when certificateProvider is none", () => {
    const result = buildServerDomainCaddySnippet({
      serverDomain: "upstand.example.com",
      httpsEnabled: true,
      certificateProvider: "none",
    });

    expect(result).toContain("http://upstand.example.com {");
    expect(result).not.toContain("tls");
  });

  test("syncServerDomainInCaddySnippets replaces existing marker block cleanly", () => {
    const existing = `${SERVER_DOMAIN_MARKER_START}\nold.example.com {}\n${SERVER_DOMAIN_MARKER_END}\n\ncustom_snippet {}`;
    const synced = syncServerDomainInCaddySnippets(existing, {
      serverDomain: "new.example.com",
      httpsEnabled: true,
      certificateProvider: "letsencrypt",
    });

    expect(synced).toContain("new.example.com {");
    expect(synced).not.toContain("old.example.com {");
    expect(synced).toContain("custom_snippet {}");
  });
});
