import { z } from "zod";
import {
  type Capability,
  isCapability,
  MCP_READ_ONLY_TOOL_NAMES,
  MCP_TOOL_CAPABILITIES,
} from "./authorization";
import { API_KEY_SCOPE_ACTIONS } from "./permission-scopes";

export const API_KEY_CONFIG_ID = "upstand" as const;

/** Backwards-compatible name for the canonical API-key permission scope. */
export const API_KEY_PERMISSION_ACTIONS = API_KEY_SCOPE_ACTIONS;

export type ApiKeyPermissionAction = Capability;

const apiKeyPermissionValues = [
  ...API_KEY_PERMISSION_ACTIONS,
  "*",
] as unknown as [Capability | "*", ...(Capability | "*")[]];

export const ApiKeyPermissionsSchema = z.object({
  upstand: z.array(z.enum(apiKeyPermissionValues)).default([]),
  mcp: z.array(z.string().min(1)).default([]),
});

export type ApiKeyPermissions = z.infer<typeof ApiKeyPermissionsSchema>;

export const ApiKeyPresetSchema = z.enum([
  "read-only",
  "deployment",
  "operations",
  "mcp-read-only",
  "full-access",
]);

export type ApiKeyPreset = z.infer<typeof ApiKeyPresetSchema>;

export const API_KEY_PRESETS: Record<ApiKeyPreset, ApiKeyPermissions> = {
  "read-only": {
    upstand: API_KEY_PERMISSION_ACTIONS.filter((action) =>
      action.endsWith(":view"),
    ),
    mcp: ["read"],
  },
  deployment: {
    upstand: [
      "project:view",
      "environment:view",
      "resource:view",
      "resource:update",
      "deployment:view",
      "deployment:manage",
    ],
    mcp: ["read"],
  },
  operations: {
    upstand: [
      "project:view",
      "environment:view",
      "resource:view",
      "resource:update",
      "deployment:view",
      "deployment:manage",
      "backup:view",
      "backup:manage",
      "swarm:view",
      "swarm:manage",
    ],
    mcp: ["read"],
  },
  "mcp-read-only": {
    upstand: [
      ...new Set(
        MCP_READ_ONLY_TOOL_NAMES.map(
          (toolName) => MCP_TOOL_CAPABILITIES[toolName],
        ),
      ),
    ],
    mcp: ["read"],
  },
  "full-access": { upstand: ["*"], mcp: ["*"] },
};

export function apiKeyPermissionsToStatements(
  permissions: ApiKeyPermissions,
): Record<string, string[]> {
  return {
    upstand: [...new Set(permissions.upstand)],
    mcp: [...new Set(permissions.mcp)],
  };
}

export function statementsToApiKeyPermissions(
  permissions: Record<string, string[]> | null | undefined,
): ApiKeyPermissions {
  return ApiKeyPermissionsSchema.parse({
    upstand: (permissions?.upstand ?? []).filter(
      (permission) => permission === "*" || isCapability(permission),
    ),
    mcp: permissions?.mcp ?? [],
  });
}

export function hasApiKeyPermission(
  permissions: ApiKeyPermissions,
  required: Capability,
): boolean {
  return (
    permissions.upstand.includes("*") || permissions.upstand.includes(required)
  );
}

export function hasMcpPermission(
  permissions: ApiKeyPermissions,
  toolName?: string,
): boolean {
  if (permissions.mcp.includes("*")) return true;
  if (permissions.mcp.includes("read")) return true;
  return Boolean(toolName && permissions.mcp.includes(`tool:${toolName}`));
}
