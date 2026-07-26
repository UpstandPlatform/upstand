import { afterEach, describe, expect, test } from "bun:test";
import { searchWeb } from "./web-search";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.UPGAL_WEB_SEARCH_API_KEY;
const originalBaseUrl = process.env.UPGAL_WEB_SEARCH_BASE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.UPGAL_WEB_SEARCH_API_KEY;
  else process.env.UPGAL_WEB_SEARCH_API_KEY = originalApiKey;
  if (originalBaseUrl === undefined)
    delete process.env.UPGAL_WEB_SEARCH_BASE_URL;
  else process.env.UPGAL_WEB_SEARCH_BASE_URL = originalBaseUrl;
});

describe("searchWeb", () => {
  test("returns bounded safe HTTP results", async () => {
    process.env.UPGAL_WEB_SEARCH_API_KEY = "test-key";
    process.env.UPGAL_WEB_SEARCH_BASE_URL = "https://search.test/web";
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      expect(String(input)).toContain("q=upstand");
      return new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "<b>Upstand</b>",
                url: "https://example.com/upstand",
                description: "<strong>Deployment</strong> platform",
              },
              {
                title: "Unsafe scheme",
                url: "javascript:alert(1)",
                description: "Should be discarded",
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    await expect(
      searchWeb({ query: "upstand", limit: 5 }),
    ).resolves.toMatchObject({
      results: [
        {
          title: "Upstand",
          description: "Deployment platform",
          url: "https://example.com/upstand",
        },
      ],
    });
  });

  test("fails with actionable configuration guidance", async () => {
    delete process.env.UPGAL_WEB_SEARCH_API_KEY;
    await expect(searchWeb({ query: "upstand", limit: 5 })).rejects.toThrow(
      "UPGAL_WEB_SEARCH_API_KEY",
    );
  });
});
