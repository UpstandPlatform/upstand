import { hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@upstand/env/server";

const STATE_TTL_SECONDS = 10 * 60;
const STATE_VERSION = "v1";
export const GITHUB_MANIFEST_WEBHOOK_TTL_SECONDS = 30 * 24 * 60 * 60;
export type GitProviderOAuthStatePurpose =
  | "provider-oauth"
  | "github-init"
  | "github-install";

function stateSecret(): string {
  const secret = env.ENCRYPTION_KEY_V1;
  if (!secret || secret.length < 32) {
    throw new Error("OAuth state signing secret is not configured");
  }
  return secret;
}

function computeStateMac(tokenPayload: string): string {
  const macBuffer = Buffer.from(
    hkdfSync(
      "sha256",
      tokenPayload,
      stateSecret(),
      "upstand-oauth-state-mac-v1",
      32,
    ),
  );
  return macBuffer.toString("base64url");
}

export function createGitProviderOAuthState(
  providerId: string,
  purpose: GitProviderOAuthStatePurpose,
  binding: { organizationId: string; userId: string },
): {
  state: string;
  expiresAt: number;
} {
  const issuedAt = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(24).toString("base64url");
  const payload = `${STATE_VERSION}.${purpose}.${providerId}.${binding.organizationId}.${binding.userId}.${issuedAt}.${nonce}`;
  return {
    state: `${payload}.${computeStateMac(payload)}`,
    expiresAt: issuedAt + STATE_TTL_SECONDS,
  };
}

export function parseGitProviderOAuthState(state: string): {
  providerId: string;
  purpose: GitProviderOAuthStatePurpose;
  organizationId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
} | null {
  const parts = state.split(".");
  if (parts.length !== 8 || parts[0] !== STATE_VERSION) return null;

  const [
    ,
    purpose,
    providerId,
    organizationId,
    userId,
    issuedAtText,
    nonce,
    receivedSignature,
  ] = parts;
  if (
    purpose !== "provider-oauth" &&
    purpose !== "github-init" &&
    purpose !== "github-install"
  ) {
    return null;
  }
  if (
    !providerId ||
    !organizationId ||
    !userId ||
    !nonce ||
    !/^\d+$/.test(issuedAtText || "")
  )
    return null;

  const issuedAt = Number(issuedAtText);
  const expiresAt = issuedAt + STATE_TTL_SECONDS;
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > Math.floor(Date.now() / 1000) + 30 ||
    expiresAt < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  const payload = parts.slice(0, 7).join(".");
  const expected = Buffer.from(computeStateMac(payload));
  const received = Buffer.from(receivedSignature || "");
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }

  return { providerId, purpose, organizationId, userId, nonce, expiresAt };
}

export function gitProviderOAuthStateKey(state: string): string {
  const derivedKey = Buffer.from(
    hkdfSync(
      "sha256",
      state,
      "upstand-oauth-state-key-salt",
      "upstand-oauth-state-key-v1",
      32,
    ),
  );
  return `oauth:git-provider-state:${derivedKey.toString("hex")}`;
}

export function gitProviderOAuthManifestWebhookKey(state: string): string {
  const derivedKey = Buffer.from(
    hkdfSync(
      "sha256",
      state,
      "upstand-oauth-state-salt",
      "upstand-github-manifest-webhook-v1",
      32,
    ),
  );
  return `webhook:github-manifest:${derivedKey.toString("hex")}`;
}

export const GIT_PROVIDER_OAUTH_STATE_TTL_SECONDS = STATE_TTL_SECONDS;
