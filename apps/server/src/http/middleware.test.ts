import { describe, expect, test } from "bun:test";
import { evlog } from "evlog/hono";
import { Hono } from "hono";
import {
  MAX_HTTP_REQUEST_BYTES,
  registerHttpMiddleware,
  shouldRejectDirectHttpAfterBootstrap,
} from "./middleware";

describe("HTTP middleware request limits", () => {
  test("bounds direct-IP HTTP to the initial self-hosted bootstrap window", () => {
    const request = new Request("http://85.155.230.19/api/auth/sign-in/email");
    const production = {
      request,
      nodeEnv: "production",
      isCloud: false,
      directOrigins: true,
      allowInsecureBootstrap: true,
    };

    expect(
      shouldRejectDirectHttpAfterBootstrap({
        ...production,
        initialAccountPending: true,
      }),
    ).toBe(false);
    expect(
      shouldRejectDirectHttpAfterBootstrap({
        ...production,
        initialAccountPending: false,
      }),
    ).toBe(true);
    expect(
      shouldRejectDirectHttpAfterBootstrap({
        ...production,
        request: new Request("https://dashboard.example.com/api/auth"),
        initialAccountPending: false,
      }),
    ).toBe(false);
    expect(
      shouldRejectDirectHttpAfterBootstrap({
        ...production,
        isCloud: true,
        initialAccountPending: false,
      }),
    ).toBe(false);
  });

  test("does not run authentication identification for public system probes", async () => {
    const identifiedPaths: string[] = [];
    const app = new Hono();
    app.use(evlog({ drain: () => undefined }));
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
    app.use(evlog({ drain: () => undefined }));
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
    app.use(evlog({ drain: () => undefined }));
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
    app.use(evlog({ drain: () => undefined }));
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

  test("allows trusted dashboard and same-host direct origins on state-changing requests", async () => {
    const app = new Hono();
    app.use(evlog({ drain: () => undefined }));
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

    const directIpResponse = await app.request(
      "http://85.155.230.19/trpc/resource.update",
      {
        method: "POST",
        headers: { Origin: "http://85.155.230.19:3001" },
      },
    );

    expect(directIpResponse.status).toBe(200);

    const mismatchedDirectIpResponse = await app.request(
      "http://localhost/trpc/resource.update",
      {
        method: "POST",
        headers: { Origin: "http://85.155.230.19:3001" },
      },
    );
    expect(mismatchedDirectIpResponse.status).toBe(403);
  });

  test("allows direct IP origins on CORS requests with credentials", async () => {
    const app = new Hono();
    app.use(evlog({ drain: () => undefined }));
    registerHttpMiddleware(app as never, {
      getServiceProvider: () =>
        ({
          createScope: () => ({ dispose: async () => undefined }),
        }) as never,
      identifyUser: async () => false,
    });
    app.get("/api/setup/status", (c) => c.json({ ok: true }));

    const response = await app.request(
      "http://85.155.230.19/api/setup/status",
      {
        method: "OPTIONS",
        headers: {
          Origin: "http://85.155.230.19:3001",
          "Access-Control-Request-Method": "GET",
        },
      },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://85.155.230.19:3001",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );

    const invalidIpResponse = await app.request(
      "http://85.155.230.19/api/setup/status",
      {
        method: "OPTIONS",
        headers: {
          Origin: "http://999.999.999.999:3001",
          "Access-Control-Request-Method": "GET",
        },
      },
    );

    expect(invalidIpResponse.headers.get("access-control-allow-origin")).toBe(
      process.env.CORS_ORIGIN ?? "http://localhost:3001",
    );
  });

  test("propagates safe request IDs and replaces unsafe values", async () => {
    const app = new Hono();
    app.use(evlog({ drain: () => undefined }));
    registerHttpMiddleware(app as never, {
      getServiceProvider: () =>
        ({
          createScope: () => ({ dispose: async () => undefined }),
        }) as never,
      identifyUser: async () => false,
    });
    app.get("/request-id", (c) => c.text("ok"));

    const preserved = await app.request("/request-id", {
      headers: { "X-Request-ID": "request-123" },
    });
    expect(preserved.headers.get("x-request-id")).toBe("request-123");

    const replaced = await app.request("/request-id", {
      headers: { "X-Request-ID": "unsafe request id" },
    });
    expect(replaced.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
