import { auth, stepUp } from "@upstand/api/auth";
import {
  API_KEY_CONFIG_ID,
  CLI_DEVICE_CLIENT_ID,
  CLI_DEVICE_POLL_INTERVAL_SECONDS,
  CliDeviceAuthStore,
  cliDevicePermissions,
  cliDeviceUserCode,
  createCliDeviceAuthorization,
} from "@upstand/api/cli-device-auth";
import { checkPermission } from "@upstand/api/permissions";
import { normalizeDirectIpAuthRequest } from "@upstand/auth";
import { ApiKeyPresetSchema } from "@upstand/domain";
import { env } from "@upstand/env/server";
import { redis } from "@upstand/redis";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AppEnv } from "../types";

const authorizeInput = z.object({
  clientId: z.literal(CLI_DEVICE_CLIENT_ID),
});
const deviceCodeInput = z.object({
  clientId: z.literal(CLI_DEVICE_CLIENT_ID),
  deviceCode: z.string().min(32).max(256),
});
const approveInput = z.object({
  clientId: z.literal(CLI_DEVICE_CLIENT_ID),
  userCode: z.string().min(5).max(16),
  organizationId: z.string().min(1),
  preset: ApiKeyPresetSchema.default("deployment"),
});
const denyInput = z.object({
  clientId: z.literal(CLI_DEVICE_CLIENT_ID),
  userCode: z.string().min(5).max(16),
});

const store = new CliDeviceAuthStore(redis);
const rateLimitScript = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return count`;

async function rateLimited(key: string, limit: number, ttlSeconds: number) {
  try {
    const count = await redis.eval(
      rateLimitScript,
      1,
      `upstand:rate:${key}`,
      String(ttlSeconds),
    );
    return Number(count) <= limit;
  } catch {
    // Device authorization mints credentials; an unavailable limiter must
    // fail closed instead of allowing an unbounded polling or approval loop.
    return false;
  }
}

async function parseJson<T>(request: Request, schema: z.ZodType<T>) {
  try {
    return schema.parse(await request.json());
  } catch {
    return null;
  }
}

function verificationUri(userCode: string): string {
  const origin = env.CORS_ORIGIN || env.APP_URL || env.BETTER_AUTH_URL;
  const url = new URL("/login", origin);
  url.searchParams.set("cli", CLI_DEVICE_CLIENT_ID);
  url.searchParams.set("user_code", userCode);
  return url.toString();
}

/**
 * Implements the OAuth device authorization shape used by the CLI. The
 * device secret is encrypted before it enters Redis and is deleted atomically
 * on the first successful poll.
 */
export function registerCliDeviceAuthRoutes(app: Hono<AppEnv>): void {
  app.use(
    "/api/cli/device/*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) =>
        c.json({ error: "Device authorization request is too large" }, 413),
    }),
  );

  app.post("/api/cli/device/authorize", async (c) => {
    const input = await parseJson(c.req.raw, authorizeInput);
    if (!input)
      return c.json({ error: "Invalid device authorization request" }, 400);
    if (!(await rateLimited("cli-device-authorize", 20, 60))) {
      return c.json({ error: "Too many authorization requests" }, 429);
    }

    const authorization = createCliDeviceAuthorization();
    await store.create(authorization);
    return c.json({
      deviceCode: authorization.deviceCode,
      userCode: authorization.userCode,
      verificationUri: verificationUri(authorization.userCode),
      expiresIn: 600,
      interval: CLI_DEVICE_POLL_INTERVAL_SECONDS,
    });
  });

  app.post("/api/cli/device/token", async (c) => {
    const input = await parseJson(c.req.raw, deviceCodeInput);
    if (!input) return c.json({ error: "Invalid device token request" }, 400);
    if (
      !(await rateLimited(`cli-device-token:${input.deviceCode}`, 120, 600))
    ) {
      return c.json({ error: "Too many token requests" }, 429);
    }

    const result = await store.poll(input.deviceCode);
    if (result.status === "approved") return c.json(result);
    if (result.status === "authorization_pending") {
      return c.json(result, 428);
    }
    if (result.status === "access_denied") return c.json(result, 403);
    return c.json(result, 400);
  });

  app.post("/api/cli/device/approve", async (c) => {
    const input = await parseJson(c.req.raw, approveInput);
    if (!input)
      return c.json({ error: "Invalid device approval request" }, 400);
    if (
      !(await rateLimited(
        `cli-device-approve:${cliDeviceUserCode(input.userCode)}`,
        10,
        60,
      ))
    ) {
      return c.json({ error: "Too many approval attempts" }, 429);
    }
    const session = await auth.api.getSession({
      headers: normalizeDirectIpAuthRequest(c.req.raw).headers,
    });
    if (!session) return c.json({ error: "Authentication required" }, 401);
    if (!(await stepUp.isStepUpAuthenticationSatisfied(session))) {
      return c.json({ error: "2FA verification required" }, 403);
    }

    let createdKeyId: string | undefined;
    try {
      await checkPermission(
        session.user.id,
        input.organizationId,
        "api_key:manage",
      );
      // Claim the one-time request before minting a credential so races cannot
      // create API keys for an expired or already-consumed device flow.
      const claimed = await store.claim({
        userCode: cliDeviceUserCode(input.userCode),
        userId: session.user.id,
        organizationId: input.organizationId,
        preset: input.preset,
      });
      if (!claimed) {
        return c.json(
          {
            error: "This CLI authorization request is expired or already used",
          },
          400,
        );
      }
      const result = await auth.api.createApiKey({
        body: {
          configId: API_KEY_CONFIG_ID,
          organizationId: input.organizationId,
          userId: session.user.id,
          name: "Upstand CLI",
          expiresIn: 90 * 24 * 60 * 60,
          rateLimitEnabled: true,
          rateLimitTimeWindow: 3_600_000,
          rateLimitMax: 1_000,
          permissions: cliDevicePermissions(input.preset),
          metadata: {
            createdBy: session.user.id,
            createdAt: new Date().toISOString(),
            source: "upstand-cli-device-auth",
          },
        },
      });
      const keyId = result.id;
      createdKeyId = keyId;
      const approved = await store.completeApproval({
        userCode: cliDeviceUserCode(input.userCode),
        userId: session.user.id,
        organizationId: input.organizationId,
        preset: input.preset,
        accessToken: result.key,
      });
      if (!approved) {
        await auth.api.deleteApiKey({
          headers: normalizeDirectIpAuthRequest(c.req.raw).headers,
          body: { configId: API_KEY_CONFIG_ID, keyId },
        });
        await store.releaseClaim({
          userCode: cliDeviceUserCode(input.userCode),
          userId: session.user.id,
        });
        return c.json(
          {
            error: "This CLI authorization request is expired or already used",
          },
          400,
        );
      }
      return c.json({ approved: true });
    } catch (error) {
      if (createdKeyId) {
        await auth.api
          .deleteApiKey({
            headers: normalizeDirectIpAuthRequest(c.req.raw).headers,
            body: { configId: API_KEY_CONFIG_ID, keyId: createdKeyId },
          })
          .catch(() => undefined);
      }
      await store
        .releaseClaim({
          userCode: cliDeviceUserCode(input.userCode),
          userId: session.user.id,
        })
        .catch(() => undefined);
      const message =
        error instanceof Error
          ? error.message
          : "Unable to approve CLI authorization";
      return c.json({ error: message }, 403);
    }
  });

  app.post("/api/cli/device/deny", async (c) => {
    const input = await parseJson(c.req.raw, denyInput);
    if (!input) return c.json({ error: "Invalid device denial request" }, 400);
    if (
      !(await rateLimited(
        `cli-device-deny:${cliDeviceUserCode(input.userCode)}`,
        10,
        60,
      ))
    ) {
      return c.json({ error: "Too many denial attempts" }, 429);
    }
    const session = await auth.api.getSession({
      headers: normalizeDirectIpAuthRequest(c.req.raw).headers,
    });
    if (!session) return c.json({ error: "Authentication required" }, 401);
    const denied = await store.deny(cliDeviceUserCode(input.userCode));
    if (!denied)
      return c.json(
        { error: "This CLI authorization request is expired or already used" },
        400,
      );
    return c.json({ denied: true });
  });
}
