import { describe, expect, it } from "bun:test";
import type { ApiKeyPrincipal } from "./api-key-auth";

let enforceApiKeyRoute: typeof import("./api-key-auth").enforceApiKeyRoute;
let requiredApiKeyPermission: typeof import("./api-key-auth").requiredApiKeyPermission;

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
const apiKeyAuth = await import("./api-key-auth");
enforceApiKeyRoute = apiKeyAuth.enforceApiKeyRoute;
requiredApiKeyPermission = apiKeyAuth.requiredApiKeyPermission;

const principal: ApiKeyPrincipal = {
  kind: "api-key",
  keyId: "key-1",
  organizationId: "org-1",
  userId: "user-1",
  name: "automation",
  permissions: { upstand: ["project:view", "resource:view"], mcp: [] },
  rateLimit: {
    enabled: true,
    max: 1_000,
    windowMs: 3_600_000,
    remaining: 999,
    lastRequest: null,
  },
};

describe("API-key endpoint authorization", () => {
  it("maps only explicitly approved routes", () => {
    expect(requiredApiKeyPermission("project.list")).toBe("project:view");
    expect(requiredApiKeyPermission("resource.get")).toBe("resource:view");
    expect(requiredApiKeyPermission("swarm.removeNode")).toBeNull();
  });

  it("allows resource-scoped routes to resolve organization in the router", async () => {
    await expect(
      enforceApiKeyRoute("project.list", principal, {
        organizationId: "org-1",
      }),
    ).resolves.toBeUndefined();

    await expect(
      enforceApiKeyRoute("resource.list", principal, {
        environmentId: "env-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects cross-organization and session-only requests", async () => {
    await expect(
      enforceApiKeyRoute("project.list", principal, {
        organizationId: "org-2",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      enforceApiKeyRoute("apiKey.list", principal, {
        organizationId: "org-1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("supports wildcard permissions without opening session-only routes", async () => {
    await expect(
      enforceApiKeyRoute(
        "notification.list",
        { ...principal, permissions: { upstand: ["*"], mcp: [] } },
        { organizationId: "org-1" },
      ),
    ).resolves.toBeUndefined();

    await expect(
      enforceApiKeyRoute(
        "swarm.getInfo",
        { ...principal, permissions: { upstand: ["*"], mcp: [] } },
        {},
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
