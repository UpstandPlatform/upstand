import { describe, expect, test } from "bun:test";
import { matchesSafeGlob } from "./safe-glob";

describe("matchesSafeGlob", () => {
  test("supports recursive and single-segment wildcards", () => {
    expect(matchesSafeGlob("apps/api/**", "apps/api/src/index.ts")).toBe(true);
    expect(matchesSafeGlob("apps/*/index.ts", "apps/api/index.ts")).toBe(true);
    expect(matchesSafeGlob("apps/*/index.ts", "apps/api/src/index.ts")).toBe(
      false,
    );
    expect(matchesSafeGlob("release-*", "release-v1.2.3")).toBe(true);
    expect(
      matchesSafeGlob("feature/*", "feature/release/v1", {
        starMatchesSlash: true,
      }),
    ).toBe(true);
  });

  test("treats glob metacharacters other than stars literally", () => {
    expect(matchesSafeGlob("release.+(stable)", "release.+(stable)")).toBe(
      true,
    );
    expect(matchesSafeGlob("release.+(stable)", "release-stable")).toBe(false);
  });

  test("handles repeated wildcards without regex backtracking", () => {
    const pattern = `${"*".repeat(512)}!`;
    const value = `${"a".repeat(4096)}?`;
    expect(matchesSafeGlob(pattern, value)).toBe(false);
  });

  test("fails closed for oversized patterns and values", () => {
    expect(matchesSafeGlob("a".repeat(513), "a")).toBe(false);
    expect(matchesSafeGlob("*", "a".repeat(4097))).toBe(false);
  });
});
