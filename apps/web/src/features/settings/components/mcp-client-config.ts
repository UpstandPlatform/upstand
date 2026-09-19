export type McpClientConfigTab = {
  id: string;
  label: string;
  description: string;
  language: string;
  filename: string;
  code: string;
};

function quoteShellArgument(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function jsonConfig(endpoint: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        upstand: {
          url: endpoint,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2,
  );
}

/** Build copy-ready configurations for the supported HTTP MCP clients. */
export function createMcpClientConfigTabs(
  endpoint: string,
  token: string,
): McpClientConfigTab[] {
  const authorization = `Bearer ${token}`;

  return [
    {
      id: "claude-code",
      label: "Claude Code",
      description: "Run this command in your terminal.",
      language: "bash",
      filename: "terminal",
      code: `claude mcp add --transport http upstand ${quoteShellArgument(endpoint)} --header ${quoteShellArgument(`Authorization: ${authorization}`)}`,
    },
    {
      id: "codex",
      label: "Codex",
      description: "Add this server to ~/.codex/config.toml.",
      language: "toml",
      filename: "config.toml",
      code: `[mcp_servers.upstand]\nurl = ${JSON.stringify(endpoint)}\nhttp_headers = { Authorization = ${JSON.stringify(authorization)} }`,
    },
    {
      id: "gemini",
      label: "Gemini / Antigravity",
      description: "Add this entry to ~/.gemini/settings.json.",
      language: "json",
      filename: "settings.json",
      code: JSON.stringify(
        {
          mcpServers: {
            upstand: {
              httpUrl: endpoint,
              headers: { Authorization: authorization },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "cursor",
      label: "Cursor",
      description: "Add this server to .cursor/mcp.json.",
      language: "json",
      filename: ".cursor/mcp.json",
      code: jsonConfig(endpoint, token),
    },
    {
      id: "vscode",
      label: "VS Code / Copilot",
      description: "Add this server to .vscode/mcp.json.",
      language: "json",
      filename: ".vscode/mcp.json",
      code: JSON.stringify(
        {
          servers: {
            upstand: {
              type: "http",
              url: endpoint,
              headers: { Authorization: authorization },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "generic",
      label: "Generic MCP",
      description: "Use this JSON with any HTTP MCP-compatible client.",
      language: "json",
      filename: "mcp.json",
      code: jsonConfig(endpoint, token),
    },
  ];
}
