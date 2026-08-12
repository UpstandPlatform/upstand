import { describe, expect, test } from "bun:test";
import { getUserFacingError } from "./error-message";

describe("getUserFacingError", () => {
  test("extracts the first useful validation message", () => {
    expect(
      getUserFacingError(
        new Error(
          JSON.stringify([{ code: "too_small", message: "Email is required" }]),
        ),
      ),
    ).toBe("Email is required");
  });

  test("uses a safe fallback for opaque payloads", () => {
    expect(getUserFacingError("x".repeat(500), "Try again later")).toBe(
      "Try again later",
    );
  });
});
