import { createHash, createHmac } from "node:crypto";
import type {
  SecretProviderConfiguration,
  SecretProviderType,
} from "@upstand/domain";
import type { ExternalSecretProviderPort } from "@upstand/usecases";

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function objectToValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export class SecretProviderRegistry implements ExternalSecretProviderPort {
  async read(
    provider: SecretProviderType,
    configuration: SecretProviderConfiguration,
  ): Promise<Record<string, string>> {
    if (provider === "vault") return this.readVault(configuration);
    if (provider === "onepassword") return this.readOnePassword(configuration);
    return this.readAws(configuration);
  }

  async testConnection(
    provider: SecretProviderType,
    configuration: SecretProviderConfiguration,
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (provider === "vault") {
        const address = stringValue(configuration.address)?.replace(/\/$/, "");
        const path = stringValue(configuration.path);
        const token = stringValue(configuration.token);
        if (!address || !path || !token) {
          return {
            success: false,
            message:
              "Vault requires Vault Address, Secret Path, and Vault Token.",
          };
        }
        const response = await fetch(`${address}/v1/${path}`, {
          headers: { "X-Vault-Token": token, Accept: "application/json" },
        }).catch((err: unknown) => {
          throw new Error(
            `Unable to connect to Vault at ${address}. If Upstand is running in Docker, use http://host.docker.internal:8200 instead of http://localhost:8200 (${errorMessage(err)}).`,
          );
        });
        if (response.status === 403 || response.status === 401) {
          return {
            success: false,
            message: `Vault returned HTTP ${response.status}: Invalid Vault Token or insufficient permissions.`,
          };
        }
        if (!response.ok && response.status !== 404) {
          return {
            success: false,
            message: `Vault returned HTTP ${response.status}`,
          };
        }
        return {
          success: true,
          message: "Successfully connected to Vault server!",
        };
      }

      if (provider === "onepassword") {
        const host = stringValue(configuration.connectHost)?.replace(/\/$/, "");
        const token = stringValue(configuration.connectToken);
        const vaultId = stringValue(configuration.vaultId);
        const itemId = stringValue(configuration.itemId);
        if (!host || !token || !vaultId || !itemId) {
          return {
            success: false,
            message:
              "1Password Connect requires Connect Host, Token, Vault ID, and Item ID.",
          };
        }
        const response = await fetch(
          `${host}/v1/vaults/${encodeURIComponent(vaultId)}/items/${encodeURIComponent(itemId)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          },
        ).catch((err: unknown) => {
          throw new Error(
            `Unable to connect to 1Password Connect at ${host} (${errorMessage(err)}).`,
          );
        });
        if (!response.ok) {
          return {
            success: false,
            message: `1Password Connect returned HTTP ${response.status}`,
          };
        }
        return {
          success: true,
          message: "Successfully connected to 1Password Connect!",
        };
      }

      // AWS Secrets Manager
      const region = stringValue(configuration.region);
      const accessKeyId = stringValue(configuration.accessKeyId);
      const secretAccessKey = stringValue(configuration.secretAccessKey);
      const secretId = stringValue(configuration.path);
      if (!region || !accessKeyId || !secretAccessKey || !secretId) {
        return {
          success: false,
          message:
            "AWS Secrets Manager requires Region, Access Key ID, Secret Access Key, and Secret Path.",
        };
      }
      await this.readAws(configuration);
      return {
        success: true,
        message: "Successfully connected to AWS Secrets Manager!",
      };
    } catch (err: unknown) {
      return {
        success: false,
        message: errorMessage(err) || "Failed to connect to secret provider.",
      };
    }
  }

  private async readVault(
    config: SecretProviderConfiguration,
  ): Promise<Record<string, string>> {
    const address = stringValue(config.address)?.replace(/\/$/, "");
    const path = stringValue(config.path);
    const token = stringValue(config.token);
    if (!address || !path || !token)
      throw new Error("Vault requires address, path, and token");
    const response = await fetch(`${address}/v1/${path}`, {
      headers: { "X-Vault-Token": token, Accept: "application/json" },
    }).catch((err: unknown) => {
      throw new Error(
        `Unable to connect to Vault at ${address}. If Upstand is running in Docker, try using http://host.docker.internal:8200 instead of http://localhost:8200 (${errorMessage(err)}).`,
      );
    });
    if (!response.ok) throw new Error(`Vault returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!isRecord(body)) return {};
    const data: unknown = body.data;
    if (!isRecord(data)) return {};
    return objectToValues(data.data ?? data);
  }

  private async readOnePassword(
    config: SecretProviderConfiguration,
  ): Promise<Record<string, string>> {
    const host = stringValue(config.connectHost)?.replace(/\/$/, "");
    const token = stringValue(config.connectToken);
    const vaultId = stringValue(config.vaultId);
    const itemId = stringValue(config.itemId);
    if (!host || !token || !vaultId || !itemId)
      throw new Error(
        "1Password Connect requires connectHost, connectToken, vaultId, and itemId",
      );
    const response = await fetch(
      `${host}/v1/vaults/${encodeURIComponent(vaultId)}/items/${encodeURIComponent(itemId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );
    if (!response.ok)
      throw new Error(`1Password Connect returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.fields)) return {};

    const values: Array<readonly [string, string]> = [];
    for (const field of body.fields) {
      if (!isRecord(field)) continue;
      const label: unknown = field.label;
      const value: unknown = field.value;
      if (
        typeof label === "string" &&
        label.length > 0 &&
        typeof value === "string"
      ) {
        values.push([label, value]);
      }
    }
    return Object.fromEntries(values);
  }

  private async readAws(
    config: SecretProviderConfiguration,
  ): Promise<Record<string, string>> {
    const region = stringValue(config.region);
    const accessKeyId = stringValue(config.accessKeyId);
    const secretAccessKey = stringValue(config.secretAccessKey);
    const secretId = stringValue(config.path);
    if (!region || !accessKeyId || !secretAccessKey || !secretId)
      throw new Error(
        "AWS Secrets Manager requires region, accessKeyId, secretAccessKey, and path",
      );
    const service = "secretsmanager";
    const host = `${service}.${region}.amazonaws.com`;
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const target = "secretsmanager.GetSecretValue";
    const body = JSON.stringify({ SecretId: secretId });
    const payloadHash = createHash("sha256").update(body).digest("hex");
    const canonicalHeaders = `content-type:application/x-amz-json-1.1\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:${target}\n`;
    const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
    const canonicalRequest = [
      "POST",
      "/",
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const signingKey = createHmac("sha256", `AWS4${secretAccessKey}`)
      .update(dateStamp)
      .digest();
    const regionKey = createHmac("sha256", signingKey).update(region).digest();
    const serviceKey = createHmac("sha256", regionKey).update(service).digest();
    const finalKey = createHmac("sha256", serviceKey)
      .update("aws4_request")
      .digest();
    const signature = createHmac("sha256", finalKey)
      .update(stringToSign)
      .digest("hex");
    const response = await fetch(`https://${host}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        Host: host,
        "X-Amz-Date": amzDate,
        "X-Amz-Target": target,
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body,
    });
    if (!response.ok)
      throw new Error(`AWS Secrets Manager returned HTTP ${response.status}`);
    const result = (await response.json()) as { SecretString?: string };
    if (!result.SecretString)
      throw new Error("AWS secret has no SecretString payload");
    try {
      return objectToValues(JSON.parse(result.SecretString));
    } catch {
      return { SECRET: result.SecretString };
    }
  }
}
