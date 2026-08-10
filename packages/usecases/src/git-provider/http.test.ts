import { afterEach, describe, expect, test } from "bun:test";
import { requestJson, requestJsonWithResponse } from "./http";

const originalFetch = globalThis.fetch;
const resolvePublicHost = async () => [{ address: "8.8.8.8" }];

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
        "https://api.github.com",
        undefined,
        () => "request failed",
        resolvePublicHost,
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
      "https://api.github.com",
      undefined,
      () => "request failed",
      resolvePublicHost,
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
        "https://api.github.com",
        undefined,
        (response) => `provider failed: ${response.statusText}`,
        resolvePublicHost,
      ),
    ).rejects.toThrow("provider failed: Bad Request");
  });
});
