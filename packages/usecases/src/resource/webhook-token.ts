import { createHash, randomBytes } from "node:crypto";

export interface GeneratedWebhookToken {
  token: string;
  hash: string;
  prefix: string;
}

export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateWebhookToken(): GeneratedWebhookToken {
  const token = `upw_${randomBytes(32).toString("base64url")}`;
  return {
    token,
    hash: hashWebhookToken(token),
    prefix: token.slice(0, 12),
  };
}
