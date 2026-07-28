import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// 1. Configure environment variables for mock modules and schema loaders
process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
process.env.CORS_ORIGIN ??= "http://localhost:3000";

// Mocking schema fields so references don't fail
mock.module("@upstand/db/schema/auth", () => {
  return {
    member: {
      userId: "userId",
      organizationId: "organizationId",
      scimActive: "scimActive",
      role: "role",
      permissions: "permissions",
    },
    user: {
      id: "id",
      createdAt: "createdAt",
    },
  };
});

// Dynamic mock storage for database queries
let mockDbRows: unknown[] = [];
const dbSelectSpy = mock((..._args: unknown[]) => {});
const dbWhereSpy = mock((..._args: unknown[]) => {});

mock.module("@upstand/db", () => {
  const chain = {
    from: mock(() => chain),
    where: mock((...args: unknown[]) => {
      dbWhereSpy(...args);
      return chain;
    }),
    orderBy: mock(() => chain),
    limit: mock(() => chain),
    // biome-ignore lint/suspicious/noThenProperty: mock thenable object
    then: mock((callback: (rows: unknown[]) => unknown) =>
      Promise.resolve(callback(mockDbRows)),
    ),
  };

  return {
    db: {
      select: mock((...args: unknown[]) => {
        dbSelectSpy(...args);
        return chain;
      }),
    },
  };
});

// 2. Import modules after mocks have been established
const { ensureOrganizationAccess } = await import("./access-control");
const { checkPermission } = await import("./permissions");
const { requireInstanceOwner, requireInstanceOwnerContext } = await import(
  "./instance-access"
);

describe("Permissions and Security System Tests", () => {
  beforeEach(() => {
    mockDbRows = [];
    dbSelectSpy.mockClear();
    dbWhereSpy.mockClear();
  });

  describe("Access Control (ensureOrganizationAccess)", () => {
    it("allows access for active organization members", async () => {
      mockDbRows = [
        {
          userId: "user-1",
          organizationId: "org-1",
          role: "member",
          scimActive: true,
        },
      ];
      const membership = await ensureOrganizationAccess("user-1", "org-1");
      expect(membership).toBeDefined();
      expect(membership.role).toBe("member");
    });

    it("denies access if user is not in the organization", async () => {
      mockDbRows = []; // No records returned from DB
      expect(ensureOrganizationAccess("user-1", "org-1")).rejects.toMatchObject(
        {
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        },
      );
    });

    it("denies access if user is in organization but scimActive is false (since DB filters it out)", async () => {
      mockDbRows = []; // DB query filters for scimActive = true, returning empty rows
      expect(ensureOrganizationAccess("user-1", "org-1")).rejects.toMatchObject(
        {
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        },
      );
    });

    it("allows access if allowedRoles matches the member's role", async () => {
      mockDbRows = [
        {
          userId: "user-1",
          organizationId: "org-1",
          role: "admin",
          scimActive: true,
        },
      ];
      const membership = await ensureOrganizationAccess("user-1", "org-1", [
        "admin",
        "owner",
      ]);
      expect(membership.role).toBe("admin");
    });

    it("denies access if allowedRoles is specified but user role is not allowed", async () => {
      mockDbRows = [
        {
          userId: "user-1",
          organizationId: "org-1",
          role: "member",
          scimActive: true,
        },
      ];
      expect(
        ensureOrganizationAccess("user-1", "org-1", ["admin", "owner"]),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Required role not met. Allowed roles: admin, owner",
      });
    });
  });

  describe("Authorization Service & Permissions (checkPermission)", () => {
    it("allows capabilities mapped to default organization roles", async () => {
      // Owner should be allowed to delete project (project:delete)
      mockDbRows = [
        {
          userId: "owner-1",
          organizationId: "org-1",
          role: "owner",
          scimActive: true,
          permissions: null,
        },
      ];
      const access = await checkPermission(
        "owner-1",
        "org-1",
        "project:delete",
      );
      expect(access).toBeDefined();

      // Member should NOT be allowed to delete project (project:delete)
      mockDbRows = [
        {
          userId: "member-1",
          organizationId: "org-1",
          role: "member",
          scimActive: true,
          permissions: null,
        },
      ];
      expect(
        checkPermission("member-1", "org-1", "project:delete"),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message:
          "Required permission not met. Action 'project:delete' is not allowed for role 'member'",
      });
    });

    it("allows custom stored permissions JSON to override defaults", async () => {
      // Normal member cannot delete project, but has stored permission "project:delete"
      mockDbRows = [
        {
          userId: "member-1",
          organizationId: "org-1",
          role: "member",
          scimActive: true,
          permissions: JSON.stringify(["project:delete", "resource:view"]),
        },
      ];
      const access = await checkPermission(
        "member-1",
        "org-1",
        "project:delete",
      );
      expect(access).toBeDefined();
    });

    it("ignores malformed stored permissions and fails securely", async () => {
      // Malformed JSON should fallback to empty permission list
      mockDbRows = [
        {
          userId: "member-1",
          organizationId: "org-1",
          role: "owner", // defaults allow project:delete
          scimActive: true,
          permissions: "{invalid json}",
        },
      ];
      // Since it's invalid, it parses to [] and rejects the action (even though role is owner!)
      expect(
        checkPermission("member-1", "org-1", "project:delete"),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("handles non-array stored permissions safely", async () => {
      // JSON but not an array (e.g. {"foo": "bar"}) -> parseCapabilities returns []
      mockDbRows = [
        {
          userId: "member-1",
          organizationId: "org-1",
          role: "owner",
          scimActive: true,
          permissions: JSON.stringify({ project: "delete" }),
        },
      ];
      expect(
        checkPermission("member-1", "org-1", "project:delete"),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("Instance Access / Ownership Checks", () => {
    let originalEnvOwner: string | undefined;
    let originalEnvOwnerEmail: string | undefined;

    beforeEach(() => {
      originalEnvOwner = process.env.UPSTAND_INSTANCE_OWNER_USER_ID;
      originalEnvOwnerEmail = process.env.UPSTAND_INSTANCE_OWNER_EMAIL;
    });

    afterEach(() => {
      if (originalEnvOwner === undefined) {
        delete process.env.UPSTAND_INSTANCE_OWNER_USER_ID;
      } else {
        process.env.UPSTAND_INSTANCE_OWNER_USER_ID = originalEnvOwner;
      }
      if (originalEnvOwnerEmail === undefined) {
        delete process.env.UPSTAND_INSTANCE_OWNER_EMAIL;
      } else {
        process.env.UPSTAND_INSTANCE_OWNER_EMAIL = originalEnvOwnerEmail;
      }
    });

    it("rejects non-session actor kind", async () => {
      expect(requireInstanceOwner("user-1", "api-key")).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Instance operations require an interactive owner session",
      });

      expect(requireInstanceOwner("user-1", undefined)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("accepts user if user matches UPSTAND_INSTANCE_OWNER_USER_ID env override", async () => {
      process.env.UPSTAND_INSTANCE_OWNER_USER_ID = "env-owner-123";
      await expect(
        requireInstanceOwner("env-owner-123", "session"),
      ).resolves.toBeUndefined();
    });

    it("accepts user if user matches UPSTAND_INSTANCE_OWNER_EMAIL env override", async () => {
      delete process.env.UPSTAND_INSTANCE_OWNER_USER_ID;
      process.env.UPSTAND_INSTANCE_OWNER_EMAIL = "owner@example.com";
      mockDbRows = [{ email: "owner@example.com" }];

      await expect(
        requireInstanceOwner("user-owner-id", "session"),
      ).resolves.toBeUndefined();
    });

    it("rejects user if user does not match UPSTAND_INSTANCE_OWNER_EMAIL env override", async () => {
      delete process.env.UPSTAND_INSTANCE_OWNER_USER_ID;
      process.env.UPSTAND_INSTANCE_OWNER_EMAIL = "owner@example.com";
      mockDbRows = [{ email: "other@example.com" }];

      expect(
        requireInstanceOwner("user-other-id", "session"),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Instance owner permission required",
      });
    });

    it("rejects user if user does not match UPSTAND_INSTANCE_OWNER_USER_ID env override", async () => {
      process.env.UPSTAND_INSTANCE_OWNER_USER_ID = "env-owner-123";
      expect(
        requireInstanceOwner("another-user", "session"),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Instance owner permission required",
      });
    });

    it("falls back to the first database user when env override is not set", async () => {
      delete process.env.UPSTAND_INSTANCE_OWNER_USER_ID;
      mockDbRows = [{ id: "first-registered-user" }];

      // Oldest user in DB is allowed
      await expect(
        requireInstanceOwner("first-registered-user", "session"),
      ).resolves.toBeUndefined();

      // Other user is blocked
      expect(
        requireInstanceOwner("second-registered-user", "session"),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Instance owner permission required",
      });
    });

    it("rejects if database query returns no users when env override is not set", async () => {
      delete process.env.UPSTAND_INSTANCE_OWNER_USER_ID;
      mockDbRows = []; // DB is empty of users
      expect(requireInstanceOwner("user-1", "session")).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Instance owner permission required",
      });
    });

    it("context wrapper requireInstanceOwnerContext calls underlying check correctly", async () => {
      process.env.UPSTAND_INSTANCE_OWNER_USER_ID = "env-owner-123";
      await expect(
        requireInstanceOwnerContext({
          session: { user: { id: "env-owner-123" } },
          actor: { kind: "session" },
        }),
      ).resolves.toBeUndefined();
    });
  });
});
