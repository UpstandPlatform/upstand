import { describe, expect, test } from "bun:test";
import { createMcpClientConfigTabs } from "./mcp-client-config";

describe("MCP client configuration snippets", () => {
  const endpoint = "https://upstand.example/api/mcp";
  const token = "upk_test_secret";

  test("creates copy-ready configurations for supported clients", () => {
    const tabs = createMcpClientConfigTabs(endpoint, token);

    expect(tabs.map((tab) => tab.id)).toEqual([
      "claude-code",
      "codex",
      "gemini",
      "cursor",
      "vscode",
      "generic",
    ]);
    expect(tabs[0]?.code).toContain("claude mcp add --transport http");
    expect(tabs[1]?.code).toContain("[mcp_servers.upstand]");
    expect(tabs[2]?.code).toContain(
      '"httpUrl": "https://upstand.example/api/mcp"',
    );
    expect(tabs[4]?.code).toContain('"type": "http"');
  });

  test("keeps the bearer token in every generated transport configuration", () => {
    const tabs = createMcpClientConfigTabs(endpoint, token);

    for (const tab of tabs) {
      expect(tab.code).toContain("Bearer upk_test_secret");
    }
  });
});
