import {
  createMCPClient,
  type MCPClient,
  mcpAppClientCapabilities,
  splitMCPAppTools,
} from "@ai-sdk/mcp";
import { env } from "@upstand/env/server";
import type { Tool } from "ai";
import { z } from "zod";
import type { RequestLog } from "../context";

const serverSchema = z.object({
  id: z.string().trim().min(1).max(40),
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
});

const serversSchema = z.array(serverSchema).max(10);
type MCPAppTools = Record<string, Tool<unknown, unknown>>;

export type UpGalMCPAppConnection = {
  tools: MCPAppTools;
  close: () => Promise<void>;
};

function configuredServers(logger: Pick<RequestLog, "warn">) {
  const raw = env.UPGAL_MCP_SERVERS?.trim();
  if (!raw) return [];

  try {
    const parsed = serversSchema.parse(JSON.parse(raw));
    return parsed.filter((server) => {
      const url = new URL(server.url);
      return url.protocol === "https:" || url.hostname === "localhost";
    });
  } catch (error) {
    logger.warn("Ignoring invalid UPGAL_MCP_SERVERS configuration", {
      err: error,
    });
    return [];
  }
}

function toolKey(serverId: string, toolName: string) {
  const safeServerId = serverId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp_${safeServerId}_${safeToolName}`;
}

function prefixedTools(
  serverId: string,
  tools: Record<string, Tool<unknown, unknown>>,
): MCPAppTools {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      toolKey(serverId, name),
      {
        ...tool,
        description: `[MCP app: ${serverId}] ${tool.description ?? name}`,
      },
    ]),
  ) as unknown as MCPAppTools;
}

/**
 * Load optional operator-configured MCP servers for one agent run.
 * External servers are opt-in, HTTPS/localhost-only, namespaced, and
 * approval-gated by the UpGal agent.
 */
export async function connectUpGalMCPApps(
  requestLog: Pick<RequestLog, "warn">,
): Promise<UpGalMCPAppConnection> {
  const logger = requestLog;
  const clients: MCPClient[] = [];
  const tools: MCPAppTools = {};

  for (const server of configuredServers(logger)) {
    try {
      const client = await createMCPClient({
        clientName: "upgal",
        version: "1.0.0",
        capabilities: mcpAppClientCapabilities,
        maxRetries: 1,
        transport: {
          type: "http",
          url: server.url,
          headers: server.headers,
          redirect: "error",
        },
      });
      clients.push(client);

      const definitions = await client.listTools();
      const { modelVisible } = splitMCPAppTools(definitions);
      Object.assign(
        tools,
        prefixedTools(
          server.id,
          client.toolsFromDefinitions(modelVisible) as unknown as Record<
            string,
            Tool<unknown, unknown>
          >,
        ),
      );
    } catch (error) {
      logger.warn("UpGal MCP app connection unavailable", {
        serverId: server.id,
        err: error,
      });
    }
  }

  return {
    tools,
    close: async () => {
      await Promise.all(
        clients.map(async (client) => {
          try {
            await client.close();
          } catch (error) {
            logger.warn("Failed to close UpGal MCP app connection", {
              err: error,
            });
          }
        }),
      );
    },
  };
}
