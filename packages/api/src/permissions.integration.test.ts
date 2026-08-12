import { describe, expect, test } from "bun:test";
import type { ApiKeyPrincipal } from "./api-key-auth";
import { AuthorizationService } from "./permissions";

const principal: ApiKeyPrincipal = {
  kind: "api-key",
  keyId: "key-1",
  organizationId: "org-1",
  userId: "user-1",
  name: "automation",
  permissions: {
    upstand: ["project:view", "resource:view"],
    mcp: ["tool:get_project"],
  },
  rateLimit: {
    enabled: true,
    max: 1_000,
    windowMs: 60_000,
    remaining: 999,
    lastRequest: null,
  },
};

describe("central authorization service", () => {
  const authorizationService = new AuthorizationService(
    async (userId, organizationId) => {
      if (userId === "user-1" && organizationId === "org-1") {
        return { role: "owner" } as never;
      }
      throw new Error("membership denied");
    },
  );

  test("evaluates API-key capabilities through the catalog", async () => {
    await expect(
      authorizationService.authorize({
        principal,
        organizationId: "org-1",
        capability: "resource:view",
      }),
    ).resolves.toMatchObject({ kind: "api-key" });
    await expect(
      authorizationService.authorize({
        principal,
        organizationId: "org-1",
        capability: "resource:update",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("uses one MCP tool grant and capability decision", async () => {
    await expect(
      authorizationService.authorizeMcpTool(principal, "get_project"),
    ).resolves.toBeUndefined();
    await expect(
      authorizationService.authorizeMcpTool(principal, "get_resource"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("rejects organization mismatches before capability evaluation", async () => {
    await expect(
      authorizationService.authorize({
        principal,
        organizationId: "org-2",
        capability: "project:view",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
