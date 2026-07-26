import { afterEach, describe, expect, test } from "bun:test";
import { requestJson, requestJsonWithResponse } from "./http";

const originalFetch = globalThis.fetch;

function mockFetch(response: Response): void {
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("git provider HTTP helpers", () => {
  test("returns decoded JSON responses", async () => {
    mockFetch(new Response(JSON.stringify({ value: "ok" }), { status: 200 }));

    await expect(
      requestJson<{ value: string }>(
        "https://example.test",
        undefined,
        () => "request failed",
      ),
    ).resolves.toEqual({ value: "ok" });
  });

  test("preserves the response for pagination metadata", async () => {
    mockFetch(
      new Response(JSON.stringify([{ name: "main" }]), {
        status: 200,
        headers: { "x-total": "1" },
      }),
    );

    const result = await requestJsonWithResponse<{ name: string }[]>(
      "https://example.test",
      undefined,
      () => "request failed",
    );

    expect(result.data).toEqual([{ name: "main" }]);
    expect(result.response.headers.get("x-total")).toBe("1");
  });

  test("uses the provider-specific error factory", async () => {
    mockFetch(
      new Response("bad request", { status: 400, statusText: "Bad Request" }),
    );

    await expect(
      requestJson(
        "https://example.test",
        undefined,
        (response) => `provider failed: ${response.statusText}`,
      ),
    ).rejects.toThrow("provider failed: Bad Request");
  });
});
