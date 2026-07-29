import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import {
  isExpectedUnauthorizedAuditScopeFailure,
  resolveAuditAction,
  resolveAuditResourceType,
  sanitizeAuditInput,
} from "./audit";

describe("audit event normalization", () => {
  test("maps procedure names to the supported action taxonomy", () => {
    expect(resolveAuditAction("createResource")).toBe("create");
    expect(resolveAuditAction("removeServer")).toBe("revoke");
    expect(resolveAuditAction("rotateJoinToken")).toBe("rotate");
    expect(resolveAuditAction("saveSettings")).toBe("configure");
    expect(resolveAuditResourceType("dockerRegistry")).toBe("registry");
  });

  test("redacts secrets while retaining bounded, useful metadata", () => {
    const metadata = sanitizeAuditInput({
      resourceId: "resource-1",
      environmentId: "environment-1",
      name: "production",
      password: "never-store-me",
      environment: { DATABASE_URL: "never-store-me" },
      options: { replicas: 2, nested: { mode: "safe" } },
      tags: ["one", "two"],
    });

    expect(metadata).toEqual({
      resourceId: "resource-1",
      environmentId: "environment-1",
      name: "production",
      options: { replicas: 2, nested: { mode: "safe" } },
      tags: 2,
    });
  });

  test("does not classify expected non-member denials as audit persistence errors", () => {
    expect(
      isExpectedUnauthorizedAuditScopeFailure(
        new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        }),
        { success: false, errorCode: "FORBIDDEN" },
      ),
    ).toBe(true);

    expect(
      isExpectedUnauthorizedAuditScopeFailure(
        new TRPCError({ code: "FORBIDDEN", message: "Permission denied" }),
        { success: false, errorCode: "FORBIDDEN" },
      ),
    ).toBe(false);
  });
});
