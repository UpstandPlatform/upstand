import type { ScimMembershipRecord } from "@upstand/domain";
import { ScimConflictError, ScimNotFoundError } from "@upstand/usecases";
import { ScimUseCaseToken } from "@upstand/usecases/tokens";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { createHttpRateLimitMiddleware } from "../rate-limit";
import type { AppEnv } from "../types";

const SCIM_STATUS_CODES = [400, 401, 404, 405, 409, 422, 429, 500] as const;
type ScimStatus = (typeof SCIM_STATUS_CODES)[number];

export function registerScimRoutes(app: Hono<AppEnv>): void {
  app.use(
    "/api/scim/*",
    createHttpRateLimitMiddleware({
      path: "scim",
      profile: "scim",
      onRejected: (c, message) => scimError(c, 429, message),
    }),
  );

  const SCIM_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0";
  const SCIM_MESSAGES_SCHEMA = `${SCIM_SCHEMA}:messages:2.0`;

  function scimError(c: Context<AppEnv>, status: ScimStatus, detail: string) {
    return c.json(
      {
        schemas: [`${SCIM_MESSAGES_SCHEMA}:Error`],
        status: String(status),
        detail,
      },
      status,
    );
  }

  function scimRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  function getScimUseCase(c: Context<AppEnv>) {
    return c.get("scope").resolve(ScimUseCaseToken);
  }

  async function authorizeScim(c: Context<AppEnv>, organizationId: string) {
    return getScimUseCase(c).authorize(
      organizationId,
      c.req.header("authorization") ?? "",
    );
  }

  function toScimUser(row: ScimMembershipRecord, baseUrl: string) {
    const displayName = row.member.scimDisplayName ?? row.user.name;
    return {
      schemas: [SCIM_SCHEMA],
      id: row.user.id,
      externalId: row.member.scimExternalId ?? undefined,
      userName: row.user.email,
      active: row.member.scimActive ?? true,
      displayName,
      name: { formatted: displayName },
      emails: [{ value: row.user.email, type: "work", primary: true }],
      meta: {
        resourceType: "User",
        created: row.user.createdAt.toISOString(),
        lastModified: row.user.updatedAt.toISOString(),
        location: `${baseUrl}/Users/${row.user.id}`,
      },
    };
  }

  async function handleScimCreateUser(c: Context<AppEnv>) {
    const organizationId = c.req.param("organizationId") as string;
    const provider = await authorizeScim(c, organizationId);
    if (!provider) return scimError(c, 401, "Invalid SCIM bearer token");
    const body = scimRecord(await c.req.json().catch(() => null));
    const email =
      typeof body.userName === "string"
        ? body.userName.trim().toLowerCase()
        : typeof body.emails === "object" && Array.isArray(body.emails)
          ? String(scimRecord(body.emails[0]).value ?? "")
              .trim()
              .toLowerCase()
          : "";
    const parsedEmail = z.email().safeParse(email);
    if (!parsedEmail.success) {
      return scimError(c, 400, "SCIM userName must be an email");
    }

    const displayName =
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim().slice(0, 120)
        : null;
    const active = body.active !== false;
    const externalId =
      typeof body.externalId === "string"
        ? body.externalId.slice(0, 255)
        : null;

    let row: ScimMembershipRecord;
    try {
      row = await getScimUseCase(c).createUser({
        organizationId,
        email,
        displayName,
        active,
        externalId,
      });
    } catch (error) {
      if (error instanceof ScimConflictError) {
        return scimError(c, 409, "SCIM user already exists");
      }
      c.get("log").error(error instanceof Error ? error : String(error), {
        message: "Failed to provision SCIM user membership",
        organizationId,
      });
      return scimError(c, 500, "Unable to provision SCIM user");
    }

    const baseUrl = `${new URL(c.req.url).origin}/api/scim/v2.0/${organizationId}`;
    return c.json(toScimUser(row, baseUrl), 201);
  }

  async function handleScimPatchUser(c: Context<AppEnv>) {
    const organizationId = c.req.param("organizationId") as string;
    const userId = c.req.param("userId") as string;
    const provider = await authorizeScim(c, organizationId);
    if (!provider) return scimError(c, 401, "Invalid SCIM bearer token");
    const existing = await getScimUseCase(c).findMembership(
      organizationId,
      userId,
    );
    if (!existing) return scimError(c, 404, "SCIM user not found");

    const body = scimRecord(await c.req.json().catch(() => null));
    if (c.req.method === "PUT") {
      if (typeof body.userName !== "string") {
        return scimError(c, 400, "SCIM PUT requires userName");
      }
      if (
        body.userName.trim().toLowerCase() !== existing.user.email.toLowerCase()
      ) {
        return scimError(c, 422, "SCIM userName cannot be changed");
      }
    }

    const operations = Array.isArray(body.Operations) ? body.Operations : [];
    let active: boolean | undefined;
    let displayName: string | null | undefined;
    let externalId: string | null | undefined;
    for (const operation of operations) {
      const item = scimRecord(operation);
      const operationName = String(item.op ?? "replace").toLowerCase();
      const path = String(item.path ?? "").toLowerCase();
      const value = item.value;
      if (path === "active") {
        if (typeof value === "boolean") active = value;
        else {
          const record = scimRecord(value);
          if (typeof record.active === "boolean") active = record.active;
        }
      } else if (path === "" && typeof value === "object") {
        const record = scimRecord(value);
        if (typeof record.active === "boolean") active = record.active;
      } else if (path === "externalid" && operationName === "remove") {
        externalId = null;
      } else if (path === "displayname" && operationName === "remove") {
        displayName = null;
      } else if (path === "displayname" && typeof value === "string") {
        displayName = value.trim().slice(0, 120);
      } else if (path === "externalid" && typeof value === "string") {
        externalId = value.slice(0, 255);
      }
    }
    if (typeof body.active === "boolean") active = body.active;
    if (c.req.method === "PUT" && active === undefined) active = true;
    if (typeof body.displayName === "string") {
      displayName = body.displayName.trim().slice(0, 120);
    }
    if (typeof body.externalId === "string") {
      externalId = body.externalId.slice(0, 255);
    }
    if (body.externalId === null) externalId = null;

    try {
      const row = await getScimUseCase(c).updateUser(organizationId, userId, {
        ...(active === undefined ? {} : { scimActive: active }),
        ...(externalId === undefined ? {} : { scimExternalId: externalId }),
        ...(displayName === undefined ? {} : { scimDisplayName: displayName }),
      });
      const baseUrl = `${new URL(c.req.url).origin}/api/scim/v2.0/${organizationId}`;
      return c.json(toScimUser(row, baseUrl));
    } catch (error) {
      if (error instanceof ScimNotFoundError) {
        return scimError(c, 404, "SCIM user not found");
      }
      c.get("log").error(error instanceof Error ? error : String(error), {
        message: "Failed to update SCIM user",
        organizationId,
        userId,
      });
      return scimError(c, 500, "Unable to update SCIM user");
    }
  }

  app.get("/api/scim/v2.0/:organizationId/ServiceProviderConfig", async (c) => {
    const organizationId = c.req.param("organizationId") as string;
    const provider = await authorizeScim(c, organizationId);
    if (!provider) return scimError(c, 401, "Invalid SCIM bearer token");
    return c.json({
      schemas: [`${SCIM_SCHEMA}:ServiceProviderConfig`],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 1000 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "SCIM bearer token",
          description: "Organization-scoped Upstand SCIM token",
          primary: true,
        },
      ],
    });
  });

  app.get("/api/scim/v2.0/:organizationId/ResourceTypes", async (c) => {
    const organizationId = c.req.param("organizationId") as string;
    const provider = await authorizeScim(c, organizationId);
    if (!provider) return scimError(c, 401, "Invalid SCIM bearer token");
    const base = `${new URL(c.req.url).origin}/api/scim/v2.0/${organizationId}`;
    return c.json({
      schemas: [`${SCIM_MESSAGES_SCHEMA}:ListResponse`],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: [
        {
          schemas: [`${SCIM_SCHEMA}:ResourceType`],
          id: "User",
          name: "User",
          endpoint: `${base}/Users`,
          schema: SCIM_SCHEMA,
          meta: { resourceType: "ResourceType" },
        },
        {
          schemas: [`${SCIM_SCHEMA}:ResourceType`],
          id: "Group",
          name: "Group",
          endpoint: `${base}/Groups`,
          schema: `${SCIM_SCHEMA}:Group`,
          meta: { resourceType: "ResourceType" },
        },
      ],
    });
  });

  app.get("/api/scim/v2.0/:organizationId/Schemas", async (c) => {
    const organizationId = c.req.param("organizationId") as string;
    const provider = await authorizeScim(c, organizationId);
    if (!provider) return scimError(c, 401, "Invalid SCIM bearer token");
    return c.json({
      schemas: [`${SCIM_MESSAGES_SCHEMA}:ListResponse`],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [
        {
          schemas: [`${SCIM_SCHEMA}:Schema`],
          id: SCIM_SCHEMA,
          name: "User",
          description: "Upstand organization member",
          attributes: [
            {
              name: "userName",
              type: "string",
              required: true,
              multiValued: false,
            },
            {
              name: "displayName",
              type: "string",
              required: false,
              multiValued: false,
            },
            {
              name: "active",
              type: "boolean",
              required: false,
              multiValued: false,
            },
            {
              name: "externalId",
              type: "string",
              required: false,
              multiValued: false,
            },
          ],
        },
      ],
    });
  });

  app.get("/api/scim/v2.0/:organizationId/Users", async (c) => {
    const organizationId = c.req.param("organizationId") as string;
    const provider = await authorizeScim(c, organizationId);
    if (!provider) return scimError(c, 401, "Invalid SCIM bearer token");
    const requestedStart = Number(c.req.query("startIndex") || 1);
    const startIndex = Number.isFinite(requestedStart)
      ? Math.max(1, Math.trunc(requestedStart))
      : 1;
    const requestedCount = Number(c.req.query("count") || 100);
    const countLimit = Math.min(
      1000,
      Number.isFinite(requestedCount)
        ? Math.max(1, Math.trunc(requestedCount))
        : 100,
    );
    const filter = c.req.query("filter") || "";
    const match = filter.match(
      /^(userName|externalId|active)\s+eq\s+["']?([^"']+)["']?$/i,
    );
    let scimFilter:
      | { attribute: "userName"; value: string }
      | { attribute: "externalId"; value: string }
      | { attribute: "active"; value: boolean }
      | undefined;
    if (match) {
      const attribute = (match[1] ?? "").toLowerCase();
      const expected = (match[2] ?? "").trim().toLowerCase();
      if (attribute === "username") {
        scimFilter = { attribute: "userName", value: expected };
      } else if (attribute === "externalid") {
        scimFilter = { attribute: "externalId", value: expected };
      } else {
        scimFilter = { attribute: "active", value: expected === "true" };
      }
    }
    const { rows, total: totalResults } = await getScimUseCase(
      c,
    ).listMemberships(organizationId, {
      filter: scimFilter,
      limit: countLimit,
      offset: startIndex - 1,
    });
    const resources = rows.map((row) =>
      toScimUser(
        row,
        `${new URL(c.req.url).origin}/api/scim/v2.0/${organizationId}`,
      ),
    );
    return c.json({
      schemas: [`${SCIM_MESSAGES_SCHEMA}:ListResponse`],
      totalResults,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    });
  });

  app.get("/api/scim/v2.0/:organizationId/Users/:userId", async (c) => {
    const organizationId = c.req.param("organizationId") as string;
    const provider = await authorizeScim(c, organizationId);
    if (!provider) return scimError(c, 401, "Invalid SCIM bearer token");
    const row = await getScimUseCase(c).findMembership(
      organizationId,
      c.req.param("userId") as string,
    );
    if (!row) return scimError(c, 404, "SCIM user not found");
    return c.json(
      toScimUser(
        row,
        `${new URL(c.req.url).origin}/api/scim/v2.0/${organizationId}`,
      ),
    );
  });

  app.post("/api/scim/v2.0/:organizationId/Users", handleScimCreateUser);
  app.on(
    ["PATCH", "PUT"],
    "/api/scim/v2.0/:organizationId/Users/:userId",
    handleScimPatchUser,
  );
  app.delete("/api/scim/v2.0/:organizationId/Users/:userId", async (c) => {
    const organizationId = c.req.param("organizationId") as string;
    const provider = await authorizeScim(c, organizationId);
    if (!provider) return scimError(c, 401, "Invalid SCIM bearer token");
    const userId = c.req.param("userId") as string;
    try {
      await getScimUseCase(c).deleteUser(organizationId, userId);
    } catch (error) {
      if (error instanceof ScimNotFoundError) {
        return scimError(c, 404, "SCIM user not found");
      }
      throw error;
    }
    return c.body(null, 204);
  });

  app.get("/api/scim/v2.0/:organizationId/Groups", async (c) => {
    const organizationId = c.req.param("organizationId") as string;
    const provider = await authorizeScim(c, organizationId);
    if (!provider) return scimError(c, 401, "Invalid SCIM bearer token");
    const { rows } = await getScimUseCase(c).listMemberships(organizationId, {
      filter: { attribute: "active", value: true },
      limit: 1000,
    });
    return c.json({
      schemas: [`${SCIM_MESSAGES_SCHEMA}:ListResponse`],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [
        {
          schemas: [`${SCIM_SCHEMA}:Group`],
          id: organizationId,
          displayName: "Organization members",
          members: rows.map((row) => ({ value: row.user.id, type: "User" })),
        },
      ],
    });
  });
}
