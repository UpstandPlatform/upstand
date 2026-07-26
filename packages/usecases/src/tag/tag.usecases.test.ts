import { describe, expect, test } from "bun:test";
import { DEFAULT_TAG_COLOR } from "@upstand/domain";
import { CreateTagInputSchema, UpdateTagInputSchema } from "./tag.usecases";

describe("tag color validation", () => {
  test("defaults new tags to the default hex color", () => {
    const result = CreateTagInputSchema.parse({
      organizationId: "org-1",
      name: "production",
    });

    expect(result.color).toBe(DEFAULT_TAG_COLOR);
  });

  test("accepts six-digit hex colors", () => {
    expect(
      CreateTagInputSchema.safeParse({
        organizationId: "org-1",
        name: "production",
        color: "#12aBcD",
      }).success,
    ).toBe(true);
  });

  test("rejects non-hex and short hex colors", () => {
    for (const color of ["primary", "#fff", "12aBcD", "#12aBcDeF"]) {
      expect(
        UpdateTagInputSchema.safeParse({
          id: "tag-1",
          organizationId: "org-1",
          color,
        }).success,
      ).toBe(false);
    }
  });
});
