import { describe, expect, test } from "bun:test";
import {
  API_KEY_CAPABILITY_ACTIONS,
  API_KEY_ROUTE_CAPABILITIES,
  CAPABILITY_CATALOG,
  CUSTOM_ROLE_CAPABILITY_ACTIONS,
  capabilitiesForRole,
  capabilityRequiresRecentTwoFactor,
  isCapability,
  parseCapabilities,
} from "./authorization";
import {
  MEMBER_SCOPE_ACTIONS,
  MemberPermissionsSchema,
  PERMISSION_SCOPE_ACTIONS,
} from "./permission-scopes";

describe("authorization catalog", () => {
  test("every API-key route points to a catalog capability", () => {
    for (const capability of Object.values(API_KEY_ROUTE_CAPABILITIES)) {
      expect(isCapability(capability)).toBe(true);
      expect(API_KEY_CAPABILITY_ACTIONS).toContain(capability);
    }
  });

  test("derives existing organization role grants from the catalog", () => {
    expect(capabilitiesForRole("owner")).toContain("project:delete");
    expect(capabilitiesForRole("admin")).not.toContain("project:delete");
    expect(capabilitiesForRole("member")).toContain("resource:update");
    expect(capabilitiesForRole("member")).not.toContain("resource:execute");
    expect(capabilitiesForRole("member")).not.toContain("resource:delete");
    expect(CUSTOM_ROLE_CAPABILITY_ACTIONS).toContain("ai:manage");
    expect(CAPABILITY_CATALOG["instance:manage"].scope).toBe("instance");
    expect(capabilitiesForRole("owner")).not.toContain("instance:manage");
    expect(API_KEY_CAPABILITY_ACTIONS).not.toContain("instance:manage");
  });

  test("rejects unknown stored permissions and exposes assurance policy", () => {
    expect(parseCapabilities(["resource:view", "future:grant", 42])).toEqual([
      "resource:view",
    ]);
    expect(capabilityRequiresRecentTwoFactor("resource:delete")).toBe(true);
    expect(capabilityRequiresRecentTwoFactor("resource:view")).toBe(false);
    expect(capabilityRequiresRecentTwoFactor("resource:secrets:view")).toBe(
      true,
    );
    expect(capabilityRequiresRecentTwoFactor("resource:execute")).toBe(true);
    expect(capabilitiesForRole("member")).not.toContain(
      "resource:secrets:view",
    );
    expect(CAPABILITY_CATALOG["resource:secrets:view"]).toMatchObject({
      apiKey: false,
      customRole: false,
      scope: "organization",
    });
    expect(CAPABILITY_CATALOG["resource:execute"]).toMatchObject({
      apiKey: false,
      customRole: false,
      roles: ["owner", "admin"],
      scope: "resource",
    });
  });

  test("keeps exposed permission scopes derived from the catalog", () => {
    expect(PERMISSION_SCOPE_ACTIONS.apiKey).toEqual(API_KEY_CAPABILITY_ACTIONS);
    expect(PERMISSION_SCOPE_ACTIONS.member).toEqual(
      CUSTOM_ROLE_CAPABILITY_ACTIONS,
    );
    expect(MEMBER_SCOPE_ACTIONS).toEqual(CUSTOM_ROLE_CAPABILITY_ACTIONS);
    expect(MemberPermissionsSchema.safeParse(["resource:view"]).success).toBe(
      true,
    );
    expect(MemberPermissionsSchema.safeParse(["instance:manage"]).success).toBe(
      false,
    );
  });

  test("keeps member-role grants assignable through the member schema", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      const roleGrants = capabilitiesForRole(role).filter((capability) =>
        MEMBER_SCOPE_ACTIONS.includes(capability),
      );
      expect(MemberPermissionsSchema.safeParse(roleGrants).success).toBe(true);
    }
  });
});
