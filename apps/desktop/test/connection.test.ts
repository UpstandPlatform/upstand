import { describe, expect, test } from "bun:test";
import {
  getApiOriginForDashboardOrigin,
  isAllowedNavigation,
  normalizeUpstandOrigin,
} from "../src/shared/connection";

describe("desktop connection policy", () => {
  test("normalizes safe instance origins", () => {
    expect(normalizeUpstandOrigin("https://upstand.example.com/")).toBe(
      "https://upstand.example.com",
    );
    expect(normalizeUpstandOrigin("http://localhost:3001")).toBe(
      "http://localhost:3001",
    );
  });

  test("rejects credentials, paths, unsafe schemes, and insecure remote origins", () => {
    for (const candidate of [
      "ftp://upstand.example.com",
      "https://user:pass@upstand.example.com",
      "https://upstand.example.com/projects",
      "http://upstand.example.com",
    ]) {
      expect(() => normalizeUpstandOrigin(candidate)).toThrow();
    }
  });

  test("keeps in-app navigation on the configured origin", () => {
    const connection = { origin: "https://upstand.example.com" };
    expect(
      isAllowedNavigation("https://upstand.example.com/projects", connection),
    ).toBe(true);
    expect(
      isAllowedNavigation("https://attacker.example.com", connection),
    ).toBe(false);
  });

  test("maps dashboard origins to their API origins", () => {
    expect(getApiOriginForDashboardOrigin("https://upstand.dev")).toBe(
      "https://api.upstand.dev",
    );
    expect(
      getApiOriginForDashboardOrigin("https://dashboard.example.com"),
    ).toBe("https://api.example.com");
  });
});
