import { describe, expect, test } from "bun:test";
import { assertPublicHttpUrl, isBlockedAddress } from "./outbound";

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
});
