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
import { isJsonObject } from "@upstand/domain";
import { AIRepositoryToken } from "@upstand/repositories/tokens";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { createHttpRateLimitMiddleware } from "../rate-limit";
import type { AppEnv } from "../types";

export function registerAiRoutes(app: Hono<AppEnv>): void {
  app.use(
    "/api/ai/chat",
    createHttpRateLimitMiddleware({
      path: "api.ai.chat",
      profile: "default",
      onRejected: (c, message) => c.json({ error: message }, 429),
      resolveIdentity: async (c, ip) => {
        const session = await auth.api.getSession({
          headers: c.req.raw.headers,
        });
        return {
          identifier: session ? `user:${session.user.id}` : `ip:${ip}`,
          hasSession: Boolean(session),
        };
      },
    }),
  );

  app.post("/api/ai/chat", async (c) => {
    const requestLog = c.get("log");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Authentication required" }, 401);
    const bodyResult = z
      .object({
        organizationId: z.string().min(1),
        conversationId: z.string().min(1).optional(),
        page: UpGalPageContextSchema.optional(),
        messages: z.unknown(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!bodyResult.success)
      return c.json({ error: "Invalid UpGal request" }, 400);
    const body = bodyResult.data;
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
    if (!ownedConversation)
      await c
        .get("scope")
        .resolve(AIRepositoryToken)
        .createConversation({
          id: conversationId,
          organizationId: body.organizationId,
          userId: session.user.id,
          context: body.page ? { page: body.page } : {},
        });
    const context = {
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
        const qp =
          c.req.query("api_key") ||
          c.req.query("token") ||
          c.req.query("apiKey");
        if (qp) {
          const fromQp = await authenticateApiKey(
            new Headers({ "x-api-key": qp }),
          );
          if (fromQp) {
            return { identifier: `apikey:${fromQp.keyId}`, hasSession: true };
          }
        }
        // No valid key — fall back to IP; the route handler will 401.
        return { identifier: `ip:${ip}`, hasSession: false };
      },
    }),
  );

  // ---------------------------------------------------------------------------
  // MCP Endpoints — supports both transports & all endpoint path aliases:
  //   • GET  /api/mcp, /api/mcp/sse  → SSE (legacy transport, EventSource)
  //   • POST /api/mcp, /api/mcp/sse  → Streamable HTTP / SSE message endpoint
  //
  // Authentication accepts:
  //   1. Authorization: Bearer <key>   (standard)
  //   2. X-Api-Key: <key>             (explicit header)
  //   3. ?api_key=<key> or ?token=<key> or ?apiKey=<key> (query param)
  // ---------------------------------------------------------------------------

  /** Resolve an API key from request headers OR query params (EventSource compat). */
  const resolveMcpKey = async (c: Context<AppEnv>) => {
    const headers = c.req.raw.headers;
    // Try header-based auth first (covers Authorization: Bearer and X-Api-Key).
    const fromHeaders = await authenticateApiKey(headers);
    if (fromHeaders) return fromHeaders;
    // Fall back to query param for clients that cannot set request headers (EventSource).
    const qp =
      c.req.query("api_key") || c.req.query("token") || c.req.query("apiKey");
    if (qp) {
      return authenticateApiKey(new Headers({ "x-api-key": qp }));
    }
    return null;
  };

  // GET: legacy SSE transport — MCP 2024-11-05 and older clients.
  const handleMcpGet = async (c: Context<AppEnv>) => {
    const key = await resolveMcpKey(c);
    if (!key) {
      return c.json({ error: "Invalid or expired API key" }, 401);
    }
    setApiKeyRateLimitHeaders(key, (name, value) => c.header(name, value));

    const requestUrl = new URL(c.req.url);
    const sessionId =
      c.req.query("sessionId") || c.req.query("session_id") || randomUUID();

    const postUrlObj = new URL(
      `${requestUrl.origin}${requestUrl.pathname.replace(/\/+$/, "")}`,
    );
    postUrlObj.searchParams.set("sessionId", sessionId);

    // Preserve all query parameters (e.g. api_key, token) so POST requests
    // from EventSource clients carry the authentication parameters cleanly.
    for (const [k, v] of requestUrl.searchParams.entries()) {
      if (k !== "sessionId" && k !== "session_id") {
        postUrlObj.searchParams.set(k, v);
      }
    }
    const postUrl = postUrlObj.toString();

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("Connection", "keep-alive");
    c.header("X-Accel-Buffering", "no");
    c.header("Mcp-Session-Id", sessionId);

    return streamSSE(c, async (stream) => {
      // MCP legacy SSE transport: first event must be "endpoint".
      await stream.writeSSE({ event: "endpoint", data: postUrl });

      // Keep the SSE connection alive with periodic heartbeats.
      while (!stream.aborted) {
        await stream.sleep(30_000);
        if (!stream.aborted) {
          await stream.writeSSE({ event: "ping", data: "" });
        }
      }
    });
  };

  // POST: Streamable HTTP transport + legacy SSE message endpoint.
  const handleMcpPost = async (c: Context<AppEnv>) => {
    const requestLog = c.get("log");
    const key = await resolveMcpKey(c);
    if (!key) {
      return c.json({ error: "Invalid or expired API key" }, 401);
    }
    setApiKeyRateLimitHeaders(key, (name, value) => c.header(name, value));

    const sessionId =
      c.req.query("sessionId") ||
      c.req.query("session_id") ||
      c.req.header("mcp-session-id");
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

    // tools/list — return every tool this API key has access to (all 63 tools).
    // Mutating tools carry destructiveHint: true & readOnlyHint: false.
    // -------------------------------------------------------------------------
    if (body.method === "tools/list") {
      const tools = (
        await Promise.all(
          UPGAL_TOOL_METADATA.map(async ([name, description, mutation]) =>
            (await canUseMcpTool(name))
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

  // Register route handlers across all path aliases (/api/mcp, /api/mcp/sse, /api/mcp/messages, etc.)
  const mcpGetPaths = ["/api/mcp", "/api/mcp/sse", "/api/mcp/*"];
  for (const path of mcpGetPaths) {
    app.get(path, handleMcpGet);
  }

  const mcpPostPaths = [
    "/api/mcp",
    "/api/mcp/sse",
    "/api/mcp/messages",
    "/api/mcp/*",
  ];
  for (const path of mcpPostPaths) {
    app.post(path, handleMcpPost);
    app.options(path, (c) => c.body(null, 204));
  }
}
