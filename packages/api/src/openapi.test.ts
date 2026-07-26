import { describe, expect, test } from "bun:test";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.REDIS_URL ??= "redis://localhost:6379";

const { createOpenApiDocument, openApiRouter } = await import("./openapi");

describe("OpenAPI contract", () => {
  test("documents every query and mutation procedure", () => {
    const document = createOpenApiDocument("http://localhost:3001/api");
    const paths = Object.keys(document.paths ?? {});
    const procedures = Object.keys(openApiRouter._def.procedures);

    expect(paths.length).toBe(procedures.length);
    expect(paths).toContain("/healthCheck");
    expect(paths).toContain("/project/list");
    expect(paths).toContain("/resource/deploy");
  });

  test("publishes both supported authentication schemes", () => {
    const document = createOpenApiDocument("http://localhost:3001/api");
    const schemes = document.components?.securitySchemes ?? {};

    expect(schemes).toHaveProperty("Authorization");
    expect(schemes).toHaveProperty("ApiKey");
  });
});
