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
});
