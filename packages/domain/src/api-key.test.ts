import { describe, expect, test } from "bun:test";
import {
  API_KEY_PRESETS,
  hasApiKeyPermission,
  hasMcpPermission,
  statementsToApiKeyPermissions,
} from "./api-key";

describe("API-key permissions", () => {
  test("presets produce least-privilege read and deployment capabilities", () => {
    expect(
      hasApiKeyPermission(API_KEY_PRESETS["read-only"], "resource:view"),
    ).toBe(true);
    expect(
      hasApiKeyPermission(API_KEY_PRESETS["read-only"], "resource:update"),
    ).toBe(false);
    expect(
      hasApiKeyPermission(API_KEY_PRESETS.deployment, "deployment:manage"),
    ).toBe(true);
  });

  test("wildcards and MCP tool permissions are evaluated consistently", () => {
    expect(
      hasApiKeyPermission(API_KEY_PRESETS["full-access"], "server:delete"),
    ).toBe(true);
    expect(
      hasMcpPermission(
        { upstand: [], mcp: ["tool:resource.list"] },
        "resource.list",
      ),
    ).toBe(true);
    expect(
      hasMcpPermission(
        { upstand: [], mcp: ["tool:resource.list"] },
        "resource.delete",
      ),
    ).toBe(false);
  });

  test("normalizes plugin statements without accepting unrelated resources", () => {
    expect(
      statementsToApiKeyPermissions({
        upstand: ["project:view"],
        unrelated: ["write"],
      }),
    ).toEqual({ upstand: ["project:view"], mcp: [] });
  });
});
