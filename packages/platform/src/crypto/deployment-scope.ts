import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";

const DEPLOYMENT_SCOPE_VERSION = "v1";
const DEPLOYMENT_SCOPE_TTL_MS = 24 * 60 * 60 * 1_000;
const MINIMUM_SCOPE_SECRET_BYTES = 32;
const deploymentScopeStorage = new AsyncLocalStorage<{
  token?: string;
}>();

export type DeploymentScopeClaims = {
  resourceId: string;
  deploymentId: string;
  serverId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function readScopeSecret(): Buffer | undefined {
  const secretFile =
    process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET_FILE?.trim();
  const value = secretFile
    ? fs.readFileSync(secretFile)
    : process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET;
  if (!value) return undefined;
  const secret = Buffer.isBuffer(value)
    ? value
    : Buffer.from(value.trim(), "utf8");
  if (secret.length < MINIMUM_SCOPE_SECRET_BYTES) {
    throw new Error(
      "UPSTAND_DOCKER_BROKER_SCOPE_SECRET must contain at least 32 bytes",
    );
  }
  return secret;
}

/**
 * Creates a short-lived grant for one deployment and resource. The private
 * secret is intentionally read only by the control-plane queueing processes;
 * deployment workers receive the resulting grant through the queue payload.
 */
export function createDeploymentScopeToken(input: {
  resourceId: string;
  deploymentId: string;
  serverId: string;
  now?: number;
}): string | undefined {
  const secret = readScopeSecret();
  if (!secret) return undefined;
  const issuedAt = input.now ?? Date.now();
  const claims: DeploymentScopeClaims = {
    resourceId: input.resourceId,
    deploymentId: input.deploymentId,
    serverId: input.serverId,
    issuedAt,
    expiresAt: issuedAt + DEPLOYMENT_SCOPE_TTL_MS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret)
    .update(`${DEPLOYMENT_SCOPE_VERSION}.${payload}`)
    .digest("base64url");
  return `${DEPLOYMENT_SCOPE_VERSION}.${payload}.${signature}`;
}

/** Returns the signed scope attached to the current asynchronous deployment. */
export function readDeploymentScopeToken(): string | undefined {
  const scoped = deploymentScopeStorage.getStore();
  if (scoped) return scoped.token;
  return process.env.UPSTAND_DEPLOYMENT_SCOPE_TOKEN?.trim() || undefined;
}

/**
 * Returns the signed grant and its routing claims for broker transports.
 * Claims are only used to mirror the grant binding into request headers; the
 * broker remains the authority that verifies the signature and lifetime.
 */
export function readDeploymentScopeHeaders(): Record<string, string> {
  const token = readDeploymentScopeToken();
  if (!token) return {};

  const parts = token.split(".");
  const payload = parts[1];
  if (
    parts.length !== 3 ||
    parts[0] !== DEPLOYMENT_SCOPE_VERSION ||
    payload === undefined
  ) {
    return { "X-Upstand-Docker-Scope": token };
  }

  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<DeploymentScopeClaims>;
    const headers: Record<string, string> = {
      "X-Upstand-Docker-Scope": token,
    };
    if (typeof claims.deploymentId === "string" && claims.deploymentId) {
      headers["X-Upstand-Deployment-ID"] = claims.deploymentId;
    }
    if (typeof claims.serverId === "string" && claims.serverId) {
      headers["X-Upstand-Server-ID"] = claims.serverId;
    }
    return headers;
  } catch {
    return { "X-Upstand-Docker-Scope": token };
  }
}

/** Runs a deployment while making its grant available to broker transports. */
export async function withDeploymentScopeToken<T>(
  token: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  return deploymentScopeStorage.run({ token }, operation);
}
