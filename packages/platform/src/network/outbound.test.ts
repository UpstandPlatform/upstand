import { describe, expect, test } from "bun:test";
import {
  assertConfiguredHttpUrl,
  assertConfiguredHttpUrlSyntax,
  assertPublicHttpUrl,
  assertSafeSshTarget,
  isBlockedAddress,
  isHardBlockedAddress,
} from "./outbound";

describe("outbound network policy", () => {
  test("blocks loopback, private, link-local, and metadata addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.8",
      "172.16.0.4",
      "192.168.1.4",
      "169.254.169.254",
      "::1",
      "fc00::1",
      "fe80::1",
    ]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
  });

  test("rejects non-HTTPS and local HTTP endpoints", async () => {
    await expect(
      assertPublicHttpUrl("http://127.0.0.1:8080/health"),
    ).rejects.toThrow("public HTTPS");
    await expect(
      assertPublicHttpUrl("https://localhost:8443/health"),
    ).rejects.toThrow("public HTTPS");
    await expect(
      assertPublicHttpUrl("https://127.0.0.1/health"),
    ).rejects.toThrow("public HTTPS");
  });

  test("requires an explicit allowlist for private endpoints", async () => {
    await expect(
      assertConfiguredHttpUrl("http://127.0.0.1:8080/health"),
    ).rejects.toThrow();
    await expect(
      assertConfiguredHttpUrl(
        "http://minio.internal:9000",
        ["minio.internal"],
        async () => [{ address: "10.0.0.8" }],
      ),
    ).resolves.toEqual(new URL("http://minio.internal:9000"));
  });

  test("resolves allowlisted private endpoints and still blocks unsafe answers", async () => {
    expect(isHardBlockedAddress("127.0.0.1")).toBe(true);
    expect(isHardBlockedAddress("169.254.169.254")).toBe(true);
    expect(isHardBlockedAddress("10.0.0.8")).toBe(false);
    await expect(
      assertConfiguredHttpUrl(
        "http://minio.internal:9000",
        ["minio.internal"],
        async () => [{ address: "127.0.0.1" }],
      ),
    ).rejects.toThrow("blocked address");
  });

  test("applies the same structural policy to synchronous consumers", () => {
    expect(() =>
      assertConfiguredHttpUrlSyntax("http://127.0.0.1:9000"),
    ).toThrow();
    expect(
      assertConfiguredHttpUrlSyntax("http://minio.internal:9000", [
        "minio.internal",
      ]).toString(),
    ).toBe("http://minio.internal:9000/");
  });

  test("re-resolves allowlisted SSH hosts and rejects unsafe answers", async () => {
    await expect(
      assertSafeSshTarget("git.internal", ["git.internal"], async () => [
        { address: "169.254.169.254" },
      ]),
    ).rejects.toThrow("blocked address");
    await expect(
      assertSafeSshTarget("git.internal", ["git.internal"], async () => [
        { address: "10.0.0.8" },
      ]),
    ).resolves.toBe("10.0.0.8");
  });
});
