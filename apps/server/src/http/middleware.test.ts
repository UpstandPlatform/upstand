import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { MAX_HTTP_REQUEST_BYTES, registerHttpMiddleware } from "./middleware";

describe("HTTP middleware request limits", () => {
  test("does not run authentication identification for public system probes", async () => {
    const identifiedPaths: string[] = [];
    const app = new Hono();
    registerHttpMiddleware(app as never, {
      getServiceProvider: () =>
        ({
          createScope: () => ({ dispose: async () => undefined }),
        }) as never,
      identifyUser: async (_logger, _headers, path) => {
        if (path) identifiedPaths.push(path);
        return false;
      },
    });
    app.get("/health/live", (c) => c.text("alive"));
    app.get("/health/ready", (c) => c.text("ready"));
    app.get("/api/setup/status", (c) => c.text("setup"));
    app.get("/api/protected", (c) => c.text("protected"));

    await app.request("/health/live");
    await app.request("/health/ready");
    await app.request("/api/setup/status");
    await app.request("/api/protected");

    expect(identifiedPaths).toEqual(["/api/protected"]);
  });

  test("rejects oversized request bodies before route handlers run", async () => {
    let handlerCalled = false;
    const app = new Hono();
    registerHttpMiddleware(app as never, {
      getServiceProvider: () =>
        ({
          createScope: () => ({ dispose: async () => undefined }),
        }) as never,
      identifyUser: async () => false,
    });
    app.post("/upload", (c) => {
      handlerCalled = true;
      return c.text("ok");
    });

    const response = await app.request("/upload", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x".repeat(MAX_HTTP_REQUEST_BYTES + 1),
    });

    expect(response.status).toBe(413);
    expect(handlerCalled).toBe(false);
  });

  test("keeps arbitrary-origin MCP CORS responses credentialless", async () => {
    const app = new Hono();
    registerHttpMiddleware(app as never, {
      getServiceProvider: () =>
        ({
          createScope: () => ({ dispose: async () => undefined }),
        }) as never,
      identifyUser: async () => false,
    });

    const response = await app.request("http://localhost/api/mcp", {
      method: "OPTIONS",
      headers: {
        Origin: "https://untrusted.example",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://untrusted.example",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "false",
    );
  });

  test("rejects untrusted origins on state-changing cookie requests", async () => {
    let handlerCalled = false;
    const app = new Hono();
    registerHttpMiddleware(app as never, {
      getServiceProvider: () =>
        ({
          createScope: () => ({ dispose: async () => undefined }),
        }) as never,
      identifyUser: async () => false,
    });
    app.post("/trpc/resource.update", (c) => {
      handlerCalled = true;
      return c.text("ok");
    });

    const response = await app.request(
      "http://localhost/trpc/resource.update",
      {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
      },
    );

    expect(response.status).toBe(403);
    expect(handlerCalled).toBe(false);
  });

  test("allows trusted dashboard origins on state-changing requests", async () => {
    const app = new Hono();
    registerHttpMiddleware(app as never, {
      getServiceProvider: () =>
        ({
          createScope: () => ({ dispose: async () => undefined }),
        }) as never,
      identifyUser: async () => false,
    });
    app.post("/trpc/resource.update", (c) => c.text("ok"));

    const response = await app.request(
      "http://localhost/trpc/resource.update",
      {
        method: "POST",
        headers: { Origin: "http://localhost:3001" },
      },
    );

    expect(response.status).toBe(200);
  });
});
