import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { OperationalError } from "@upstand/domain";
import { handleUseCaseError } from "./errors";

describe("use-case error mapping", () => {
  test("maps typed external failures to a client error", () => {
    expect(() =>
      handleUseCaseError(new OperationalError("fetch failed", "NETWORK")),
    ).toThrow(TRPCError);

    try {
      handleUseCaseError(new OperationalError("fetch failed", "NETWORK"));
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("BAD_REQUEST");
      expect((error as TRPCError).message).toBe("fetch failed");
    }
  });

  test("maps typed notification failures to a client error", () => {
    expect(() =>
      handleUseCaseError(
        new OperationalError(
          "Slack rejected the notification (404 Not Found)",
          "NOTIFICATION",
        ),
      ),
    ).toThrow(TRPCError);

    try {
      handleUseCaseError(
        new OperationalError(
          "Slack rejected the notification (404 Not Found)",
          "NOTIFICATION",
        ),
      );
    } catch (error) {
      expect((error as TRPCError).code).toBe("BAD_REQUEST");
      expect((error as TRPCError).message).toContain(
        "Slack rejected the notification",
      );
    }
  });

  test("maps typed Git integration failures to a client error", () => {
    const error = new OperationalError("Git provider is unavailable", "GIT");
    try {
      handleUseCaseError(error);
    } catch (mapped) {
      expect((mapped as TRPCError).code).toBe("BAD_REQUEST");
      expect((mapped as TRPCError).message).toBe(error.message);
    }
  });

  test("does not classify arbitrary error text as an operational failure", () => {
    try {
      handleUseCaseError(new Error("fetch failed"));
    } catch (error) {
      expect((error as TRPCError).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  test("preserves router errors raised inside a handled operation", () => {
    const conflict = new TRPCError({
      code: "CONFLICT",
      message: "Certificate is in use",
    });

    expect(() => handleUseCaseError(conflict)).toThrow(conflict);
  });
});
