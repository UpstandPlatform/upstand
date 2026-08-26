import { randomUUID } from "node:crypto";
import {
  createUpGalResponse,
  createUpGalTools,
  executeUpGalReadTool,
  getConversationForUser,
  getUpGalToolInputSchemaJson,
  getUpGalToolNamesForUser,
  isUpGalToolName,
  saveIncomingMessages,
  UPGAL_MAX_CHAT_TOTAL_TOKENS,
  UPGAL_TOOL_METADATA,
  type UpGalUIMessage,
  validateAndRecoverUpGalMessages,
} from "@upstand/api/ai/upgal";
import { classifyUpGalError } from "@upstand/api/ai/upgal-errors";
import { UpGalPageContextSchema } from "@upstand/api/ai/upgal-page-context";
import {
  authenticateApiKey,
  setApiKeyRateLimitHeaders,
} from "@upstand/api/api-key-auth";
import { auth } from "@upstand/api/auth";
import { authorizeMcpTool, checkPermission } from "@upstand/api/permissions";
import { normalizeDirectIpAuthRequest } from "@upstand/auth";
import { isJsonObject } from "@upstand/domain";
import { env } from "@upstand/env/server";
import { redis } from "@upstand/redis";
import { AIRepositoryToken } from "@upstand/repositories/tokens";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { createHttpRateLimitMiddleware } from "../rate-limit";
import type { AppEnv } from "../types";
import {
  incrementUpGalDailyBudget,
  reserveUpGalDailyCostBudget,
  reserveUpGalDailyTokenBudget,
  upGalCostCentsForTokens,
} from "./ai-budget";
import {
  type McpConnectionLease,
  RedisMcpConnectionLimiter,
} from "./mcp-connection-limiter";

export function registerAiRoutes(app: Hono<AppEnv>): void {
  // Keep the complete prompt history bounded as well as the transport body.
  // This is a cost and availability control: a 512 KiB history can otherwise
  // become a large provider input on every retry/step.
  const MAX_AI_REQUEST_BYTES = 256 * 1024;
  const MAX_AI_INPUT_CHARS = 128 * 1024;
  const MAX_AI_MESSAGES = 100;
  const MAX_MCP_REQUEST_BYTES = 256 * 1024;
  const aiBodyLimit = bodyLimit({
    maxSize: MAX_AI_REQUEST_BYTES,
    onError: (c) => c.json({ error: "UpGal request is too large" }, 413),
  });
  const mcpBodyLimit = bodyLimit({
    maxSize: MAX_MCP_REQUEST_BYTES,
    onError: (c) =>
      c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "MCP request is too large" },
        },
        413,
      ),
  });
  const mcpConnectionLimiter = new RedisMcpConnectionLimiter(redis);

  app.use(
    "/api/ai/chat",
    createHttpRateLimitMiddleware({
      path: "api.ai.chat",
      profile: "default",
      onRejected: (c, message) => c.json({ error: message }, 429),
      resolveIdentity: async (c, ip) => {
        const session = await auth.api.getSession({
          headers: normalizeDirectIpAuthRequest(c.req.raw).headers,
        });
        return {
          identifier: session ? `user:${session.user.id}` : `ip:${ip}`,
          hasSession: Boolean(session),
        };
      },
    }),
  );

  app.use("/api/ai/chat", aiBodyLimit);

  app.post("/api/ai/chat", async (c) => {
    const requestLog = c.get("log");
    const session = await auth.api.getSession({
      headers: normalizeDirectIpAuthRequest(c.req.raw).headers,
    });
    if (!session) return c.json({ error: "Authentication required" }, 401);
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (contentLength > MAX_AI_REQUEST_BYTES) {
      return c.json({ error: "UpGal request is too large" }, 413);
    }
    const rawBody = await c.req.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_AI_REQUEST_BYTES) {
      return c.json({ error: "UpGal request is too large" }, 413);
    }
    if (rawBody.length > MAX_AI_INPUT_CHARS) {
      return c.json({ error: "UpGal conversation is too large" }, 413);
    }
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "Invalid UpGal request" }, 400);
    }
    const bodyResult = z
      .object({
        organizationId: z.string().min(1),
        conversationId: z.string().min(1).optional(),
        page: UpGalPageContextSchema.optional(),
        messages: z.unknown(),
      })
      .safeParse(parsedBody);
    if (!bodyResult.success)
      return c.json({ error: "Invalid UpGal request" }, 400);
    const body = bodyResult.data;
    if (
      !Array.isArray(body.messages) ||
      body.messages.length > MAX_AI_MESSAGES
    ) {
      return c.json({ error: "UpGal conversation is too large" }, 413);
    }
    await checkPermission(session.user.id, body.organizationId, "ai:view");

    const conversationId = body.conversationId || randomUUID();
    const ownedConversation = await getConversationForUser(
      conversationId,
      body.organizationId,
      session.user.id,
      c.get("scope").resolve(AIRepositoryToken),
    );
    if (body.conversationId && !ownedConversation)
      return c.json({ error: "Conversation not found" }, 404);
    const context = {
      actorKind: "session" as const,
      organizationId: body.organizationId,
      userId: session.user.id,
      userName: session.user.name?.trim() || undefined,
      page: body.page,
      conversationId,
      runId: randomUUID(),
      scope: c.get("scope"),
      log: c.get("log"),
      allowedToolNames: await getUpGalToolNamesForUser(
        session.user.id,
        body.organizationId,
      ),
    };
    const tools = createUpGalTools(context);
    let messages: UpGalUIMessage[];
    try {
      messages = await validateAndRecoverUpGalMessages(body.messages, tools);
    } catch (error) {
      requestLog.warn(
        "Rejected UpGal request with unrecoverable UI message history",
        {
          organizationId: body.organizationId,
          conversationId,
          messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
          err: error,
        },
      );
      return c.json(
        {
          error:
            "UpGal could not read this conversation history. Start a new message to continue.",
        },
        400,
      );
    }
    try {
      if (env.NODE_ENV !== "test") {
        const now = new Date();
        let runCount: number;
        try {
          runCount = await incrementUpGalDailyBudget(
            redis,
            body.organizationId,
            now,
          );
        } catch (error) {
          requestLog.error(error instanceof Error ? error : String(error), {
            message: "Unable to enforce UpGal daily budget",
            organizationId: body.organizationId,
          });
          return c.json({ error: "UpGal is temporarily unavailable" }, 503);
        }
        if (runCount > env.UPGAL_DAILY_RUN_LIMIT) {
          return c.json(
            { error: "UpGal daily organization run limit exceeded" },
            429,
          );
        }
        let reservation: Awaited<
          ReturnType<typeof reserveUpGalDailyTokenBudget>
        >;
        try {
          reservation = await reserveUpGalDailyTokenBudget(
            redis,
            body.organizationId,
            UPGAL_MAX_CHAT_TOTAL_TOKENS,
            env.UPGAL_DAILY_TOKEN_LIMIT,
            now,
          );
        } catch (error) {
          requestLog.error(error instanceof Error ? error : String(error), {
            message: "Unable to enforce UpGal daily token budget",
            organizationId: body.organizationId,
          });
          return c.json({ error: "UpGal is temporarily unavailable" }, 503);
        }
        if (!reservation) {
          return c.json(
            { error: "UpGal daily organization token limit exceeded" },
            429,
          );
        }
        let costReservation: Awaited<
          ReturnType<typeof reserveUpGalDailyCostBudget>
        >;
        try {
          costReservation = await reserveUpGalDailyCostBudget(
            redis,
            body.organizationId,
            upGalCostCentsForTokens(
              UPGAL_MAX_CHAT_TOTAL_TOKENS,
              env.UPGAL_MAX_COST_PER_MILLION_TOKENS_USD,
            ),
            Math.round(env.UPGAL_DAILY_COST_LIMIT_USD * 100),
            now,
          );
        } catch (error) {
          requestLog.error(error instanceof Error ? error : String(error), {
            message: "Unable to enforce UpGal daily cost budget",
            organizationId: body.organizationId,
          });
          return c.json({ error: "UpGal is temporarily unavailable" }, 503);
        }
        if (!costReservation) {
          return c.json(
            { error: "UpGal daily organization cost limit exceeded" },
            429,
          );
        }
      }
      // Reserve the AI run before creating persistent conversation state. This
      // prevents rejected or over-quota requests from becoming unbounded rows.
      if (!ownedConversation) {
        await c
          .get("scope")
          .resolve(AIRepositoryToken)
          .createConversation({
            id: conversationId,
            organizationId: body.organizationId,
            userId: session.user.id,
            context: body.page ? { page: body.page } : {},
          });
      }
      await saveIncomingMessages(
        conversationId,
        messages,
        c.get("scope").resolve(AIRepositoryToken),
        body.organizationId,
        session.user.id,
      );
      return await createUpGalResponse(context, messages, c.req.raw);
    } catch (error) {
      const info = classifyUpGalError(error);
      requestLog.error(error instanceof Error ? error : String(error), {
        message: "UpGal request failed before streaming started",
        organizationId: body.organizationId,
        conversationId,
        code: info.code,
        retryable: info.retryable,
      });
      return c.json(
        {
          error: info.userMessage,
          code: info.code,
          retryable: info.retryable,
        },
        info.status,
      );
    }
  });

  app.use(
    "/api/mcp*",
    createHttpRateLimitMiddleware({
      path: "api.mcp",
      profile: "default",
      onRejected: (c, message) =>
        c.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32000, message },
          },
          429,
        ),
      resolveIdentity: async (c, ip) => {
        // Resolve the API key using the same multi-source logic as the MCP handlers.
        const headers = c.req.raw.headers;
        const fromHeaders = await authenticateApiKey(headers);
        if (fromHeaders) {
          return {
            identifier: `apikey:${fromHeaders.keyId}`,
            hasSession: true,
          };
        }
        // No valid key — fall back to IP; the route handler will 401.
        return { identifier: `ip:${ip}`, hasSession: false };
      },
    }),
  );

  app.use("/api/mcp*", mcpBodyLimit);

  // ---------------------------------------------------------------------------
  // MCP endpoint. Authentication accepts only headers. Query-string
  // credentials are intentionally rejected because URLs are copied into
  // browser history, proxy logs, referrers, and telemetry.
  // ---------------------------------------------------------------------------

  /** Resolve an API key from request headers only. */
  const resolveMcpKey = async (c: Context<AppEnv>) => {
    const headers = c.req.raw.headers;
    return authenticateApiKey(headers);
  };

  // GET: establish the server-sent event stream.
  const handleMcpGet = async (c: Context<AppEnv>) => {
    const requestLog = c.get("log");
    const key = await resolveMcpKey(c);
    if (!key) {
      return c.json({ error: "Invalid or expired API key" }, 401);
    }
    let lease: McpConnectionLease | null;
    try {
      lease = await mcpConnectionLimiter.acquire(key.keyId);
    } catch (error) {
      requestLog.error("MCP connection capacity check failed", { err: error });
      return c.json({ error: "MCP temporarily unavailable" }, 503);
    }
    if (!lease) {
      c.header("Retry-After", "30");
      return c.json({ error: "Too many MCP connections" }, 429);
    }
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await lease.release();
    };

    try {
      setApiKeyRateLimitHeaders(key, (name, value) => c.header(name, value));

      const requestUrl = new URL(c.req.url);
      const sessionId = c.req.header("mcp-session-id") || randomUUID();

      const postUrlObj = new URL(
        `${requestUrl.origin}${requestUrl.pathname.replace(/\/+$/, "")}`,
      );
      postUrlObj.searchParams.set("sessionId", sessionId);

      const postUrl = postUrlObj.toString();

      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache, no-transform");
      c.header("Connection", "keep-alive");
      c.header("X-Accel-Buffering", "no");
      c.header("Mcp-Session-Id", sessionId);

      return await streamSSE(c, async (stream) => {
        stream.onAbort(() => void release());
        try {
          // The first event communicates the canonical message endpoint.
          await stream.writeSSE({ event: "endpoint", data: postUrl });

          // Keep the SSE connection alive with periodic heartbeats.
          while (!stream.aborted) {
            await stream.sleep(30_000);
            if (!stream.aborted) {
              if (!(await lease.renew())) {
                requestLog.warn("MCP connection lease expired");
                break;
              }
              await stream.writeSSE({ event: "ping", data: "" });
            }
          }
        } finally {
          await release();
        }
      });
    } catch (error) {
      await release();
      throw error;
    }
  };

  // POST: MCP JSON-RPC messages.
  const handleMcpPost = async (c: Context<AppEnv>) => {
    const requestLog = c.get("log");
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (contentLength > MAX_MCP_REQUEST_BYTES) {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "MCP request is too large" },
        },
        413,
      );
    }
    const key = await resolveMcpKey(c);
    if (!key) {
      return c.json({ error: "Invalid or expired API key" }, 401);
    }
    setApiKeyRateLimitHeaders(key, (name, value) => c.header(name, value));

    const sessionId = c.req.header("mcp-session-id");
    if (sessionId) {
      c.header("Mcp-Session-Id", sessionId);
    }

    // Parse the JSON-RPC envelope.
    const bodyResult = z
      .object({
        jsonrpc: z.literal("2.0").optional(),
        id: z.union([z.string(), z.number(), z.null()]).optional(),
        method: z.string(),
        params: z.record(z.string(), z.json()).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));

    if (!bodyResult.success) {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid MCP request" },
        },
        400,
      );
    }

    const body = bodyResult.data;
    const id = body.id ?? null;

    // -------------------------------------------------------------------------
    // MCP Notifications — fire-and-forget; return 202 No Content (no JSON body).
    // The spec says servers MUST NOT reply to notifications with a response.
    // Clients rely on a clean 2xx status, NOT a JSON-RPC response object.
    // -------------------------------------------------------------------------
    if (
      body.method === "notifications/initialized" ||
      body.method === "notifications/cancelled" ||
      body.method === "notifications/progress" ||
      body.method === "notifications/roots/list_changed" ||
      body.method.startsWith("notifications/")
    ) {
      c.status(202);
      return c.body(null);
    }

    // -------------------------------------------------------------------------
    // MCP ping — simple liveness check.
    // -------------------------------------------------------------------------
    if (body.method === "ping") {
      return c.json({ jsonrpc: "2.0", id, result: {} });
    }

    // -------------------------------------------------------------------------
    // Optional capability methods — return empty collections so clients that
    // probe for resources/prompts don't fail.
    // -------------------------------------------------------------------------
    if (body.method === "resources/list") {
      return c.json({ jsonrpc: "2.0", id, result: { resources: [] } });
    }
    if (body.method === "resources/templates/list") {
      return c.json({ jsonrpc: "2.0", id, result: { resourceTemplates: [] } });
    }
    if (body.method === "prompts/list") {
      return c.json({ jsonrpc: "2.0", id, result: { prompts: [] } });
    }
    if (body.method === "completion/complete") {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: { completion: { values: [] } },
      });
    }

    // -------------------------------------------------------------------------
    // Lazy helper — checks both tool name validity AND API key permission.
    // -------------------------------------------------------------------------
    const canUseMcpTool = async (name: string): Promise<boolean> => {
      if (!isUpGalToolName(name)) return false;
      try {
        await authorizeMcpTool(key, name);
        return true;
      } catch {
        return false;
      }
    };

    // -------------------------------------------------------------------------
    // initialize — MCP handshake.
    // -------------------------------------------------------------------------
    if (body.method === "initialize") {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: { listChanged: false },
            resources: {},
            prompts: {},
          },
          serverInfo: { name: "upstand-upgal", version: "1.0.0" },
        },
      });
    }

    // tools/list — return only externally executable, read-only tools.
    // Mutating tools require the dashboard approval workflow and are not
    // advertised to external MCP clients.
    // -------------------------------------------------------------------------
    if (body.method === "tools/list") {
      const tools = (
        await Promise.all(
          UPGAL_TOOL_METADATA.map(async ([name, description, mutation]) =>
            !mutation && (await canUseMcpTool(name))
              ? { name, description, mutation }
              : null,
          ),
        )
      )
        .filter((tool): tool is NonNullable<typeof tool> => tool !== null)
        .map(({ name, description, mutation }) => ({
          name,
          description,
          annotations: {
            readOnlyHint: !mutation,
            destructiveHint: mutation,
          },
          inputSchema: getUpGalToolInputSchemaJson(name),
        }));

      return c.json({ jsonrpc: "2.0", id, result: { tools } });
    }

    // -------------------------------------------------------------------------
    // tools/call — execute a tool, subject to permission checks.
    // -------------------------------------------------------------------------
    if (body.method === "tools/call") {
      const name = body.params?.name;
      const args = body.params?.arguments ?? {};

      if (typeof name !== "string" || !isJsonObject(args)) {
        return c.json(
          {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: "Tool name and object arguments are required",
            },
          },
          400,
        );
      }

      const metadata = UPGAL_TOOL_METADATA.find(
        ([toolName]) => toolName === name,
      );

      if (!metadata || !isUpGalToolName(name) || !(await canUseMcpTool(name))) {
        return c.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: "Tool is not available for this API key",
          },
        });
      }

      // Mutating tools require dashboard approval — surface this clearly.
      if (metadata[2]) {
        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: "Mutating MCP tools must be approved through the UpGal dashboard.",
              },
            ],
          },
        });
      }

      try {
        const result = await executeUpGalReadTool(name, args, {
          actorKind: "api-key" as const,
          organizationId: key.organizationId,
          userId: key.userId,
          conversationId: randomUUID(),
          runId: randomUUID(),
          scope: c.get("scope"),
          log: requestLog,
        });

        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result) }],
          },
        });
      } catch (error) {
        const info = classifyUpGalError(error);
        requestLog.warn("UpGal MCP tool execution failed", {
          toolName: name,
          organizationId: key.organizationId,
          code: info.code,
        });
        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: info.userMessage }],
          },
        });
      }
    }

    // -------------------------------------------------------------------------
    // Unknown method — return JSON-RPC Method Not Found.
    // -------------------------------------------------------------------------
    return c.json(
      {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not found" },
      },
      404,
    );
  };

  app.get("/api/mcp", handleMcpGet);
  app.post("/api/mcp", handleMcpPost);
  app.options("/api/mcp", (c) => c.body(null, 204));
}
