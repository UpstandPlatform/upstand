import { describe, expect, test } from "bun:test";
import {
  assertSafeUpGalMCPServerUrl,
  createUpGalMCPFetch,
  UPGAL_MCP_REQUEST_TIMEOUT_MS,
} from "./mcp-apps";

describe("UpGal MCP transport", () => {
  test("aborts a stalled MCP request at the configured deadline", async () => {
    const timedFetch = createUpGalMCPFetch(
      5,
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );

    await expect(timedFetch("https://mcp.example.test")).rejects.toThrow(
      "aborted",
    );
  });

  test("uses the documented default request deadline", () => {
    expect(UPGAL_MCP_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  test("allows the explicit self-hosted localhost exception", async () => {
    await expect(
      assertSafeUpGalMCPServerUrl("http://localhost:8787/mcp"),
    ).resolves.toBeInstanceOf(URL);
  });

  test("rejects an HTTPS MCP server that resolves to a private address", async () => {
    await expect(
      assertSafeUpGalMCPServerUrl("https://mcp.example.test/mcp", async () => [
        { address: "10.0.0.8" },
      ]),
    ).rejects.toThrow("public addresses");
  });

  test("rejects credential-bearing MCP URLs", async () => {
    await expect(
      assertSafeUpGalMCPServerUrl("https://user:secret@mcp.example.test/mcp"),
    ).rejects.toThrow("credentials");
  });
});
