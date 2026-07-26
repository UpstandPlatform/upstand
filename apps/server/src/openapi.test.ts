import { describe, expect, test } from "bun:test";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.REDIS_URL ??= "redis://localhost:6379";

const { serveSwaggerUiAsset, swaggerUiHtml } = await import("./openapi");

describe("Swagger UI assets", () => {
  test("serves the bundled stylesheet", async () => {
    const response = await serveSwaggerUiAsset("swagger-ui.css");

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/css");
  });

  test("loads the generated OpenAPI document", () => {
    expect(swaggerUiHtml).toContain('url: "/api/openapi.json"');
    expect(swaggerUiHtml).toContain("SwaggerUIBundle");
  });
});
