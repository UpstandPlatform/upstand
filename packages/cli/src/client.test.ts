import { describe, expect, test } from "bun:test";
import { UpstandClient } from "./client";

describe("UpstandClient", () => {
  test("maps queries to the generated REST endpoint and bearer auth", async () => {
    let request: Request | undefined;
    const client = new UpstandClient(
      {
        apiUrl: "https://example.test",
        token: "upk_test",
        output: "json",
        yes: false,
      },
      async (input, init) => {
        request = new Request(String(input), init);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    );

    await client.query("project.list", {
      organizationId: "org_1",
      includeArchived: false,
    });

    expect(request?.url).toBe(
      "https://example.test/api/project/list?organizationId=org_1&includeArchived=false",
    );
    expect(request?.headers.get("authorization")).toBe("Bearer upk_test");
  });

  test("maps mutations to JSON requests", async () => {
    let request: Request | undefined;
    const client = new UpstandClient(
      { apiUrl: "https://example.test", output: "json", yes: false },
      async (input, init) => {
        request = new Request(String(input), init);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    );

    await client.mutate("resource.deploy", { id: "resource_1" });

    expect(request?.method).toBe("POST");
    expect(request?.headers.get("content-type")).toContain("application/json");
    expect(await request?.json()).toEqual({ id: "resource_1" });
  });

  test("rejects non-procedure paths", async () => {
    const client = new UpstandClient({
      apiUrl: "https://example.test",
      output: "json",
      yes: false,
    });
    await expect(client.query("project/list")).rejects.toThrow(
      "Expected namespace.action",
    );
  });
});
