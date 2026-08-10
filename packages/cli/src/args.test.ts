import { afterEach, describe, expect, test } from "bun:test";
import { parseArgs } from "./args";

const originalUrl = process.env.UPSTAND_URL;
const originalToken = process.env.UPSTAND_TOKEN;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.UPSTAND_URL;
  else process.env.UPSTAND_URL = originalUrl;
  if (originalToken === undefined) delete process.env.UPSTAND_TOKEN;
  else process.env.UPSTAND_TOKEN = originalToken;
});

describe("CLI argument parsing", () => {
  test("keeps boolean flags from consuming the next positional", async () => {
    const context = await parseArgs([
      "--json",
      "--include-secrets",
      "control-plane",
      "export",
    ]);

    expect(context.positionals).toEqual(["control-plane", "export"]);
    expect(context.options.output).toBe("json");
    expect(context.flags.has("include-secrets")).toBe(true);
  });

  test("supports explicit options and environment credentials", async () => {
    process.env.UPSTAND_URL = "https://env.example.test/";
    process.env.UPSTAND_TOKEN = "upk_env";
    const context = await parseArgs([
      "project",
      "list",
      "--organization=org_1",
    ]);

    expect(context.options.apiUrl).toBe("https://env.example.test");
    expect(context.options.token).toBe("upk_env");
    expect(context.options.organizationId).toBe("org_1");
  });

  test("recognizes the version flag", async () => {
    const context = await parseArgs(["--version"]);

    expect(context.flags.has("version")).toBe(true);
    expect(context.positionals).toEqual([]);
  });
});
