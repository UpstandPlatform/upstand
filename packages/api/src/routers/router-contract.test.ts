import { describe, expect, test } from "bun:test";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.REDIS_URL ??= "redis://localhost:6379";

type ProcedureDefinition = {
  type?: "query" | "mutation" | "subscription";
};

type ProcedureNode = { _def?: ProcedureDefinition };
interface RouterRecord {
  [name: string]: RouterNode;
}
type RouterNode = ProcedureNode | RouterRecord;

const { appRouter } = await import("./index");
const root = appRouter._def.record as RouterNode;

function isProcedureNode(node: RouterNode): node is ProcedureNode {
  return "_def" in node;
}

function collectProcedurePaths(node: RouterNode, prefix = ""): string[] {
  if (isProcedureNode(node)) return node._def?.type ? [prefix] : [];

  return Object.entries(node).flatMap(([name, child]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    return collectProcedurePaths(child, path);
  });
}

describe("API router contract", () => {
  test("registers every supported top-level router", () => {
    const record = root as Record<string, RouterNode>;
    const expectedRouters = [
      "healthCheck",
      "project",
      "environment",
      "resource",
      "application",
      "database",
      "domain",
      "sshKey",
      "gitProvider",
      "compose",
      "port",
      "mount",
      "s3Destination",
      "auth",
      "webServer",
      "swarm",
      "deployment",
      "dockerRegistry",
      "server",
      "notification",
      "outbox",
      "member",
      "customRole",
      "backup",
      "certificate",
      "ai",
      "apiKey",
      "auditLog",
      "tag",
      "template",
      "search",
      "scim",
      "schedule",
      "secret",
      "sso",
      "containerFileManager",
    ];

    expect(Object.keys(record).sort()).toEqual(expectedRouters.sort());
  });

  test("exposes a callable procedure for every router branch", () => {
    const paths = collectProcedurePaths(root);

    expect(paths).toContain("healthCheck");
    expect(paths).toContain("project.create");
    expect(paths).toContain("resource.deploy");
    expect(paths).toContain("deployment.getQueue");
    expect(paths).toContain("webServer.getSettings");
    expect(paths).toContain("ai.generateTemplate");

    const branches = new Set(paths.map((path) => path.split(".")[0]));
    expect(branches.size).toBe(Object.keys(root).length);
    expect(paths.length).toBeGreaterThan(150);
  });

  test("does not expose direct user creation procedures", () => {
    expect(collectProcedurePaths(root)).not.toContain("createUser");
    expect(collectProcedurePaths(root)).not.toContain("user.create");
  });
});
