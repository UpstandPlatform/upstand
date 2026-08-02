import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { requireScheduleResourceId } from "./schedule.router";

describe("schedule log authorization boundary", () => {
  test("rejects schedules without a resource scope", () => {
    expect(() => requireScheduleResourceId({ resourceId: null })).toThrow(
      TRPCError,
    );
    try {
      requireScheduleResourceId({ resourceId: null });
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("NOT_FOUND");
    }
  });

  test("returns the resource scope for authorized lookup", () => {
    expect(requireScheduleResourceId({ resourceId: "resource-1" })).toBe(
      "resource-1",
    );
  });
});
