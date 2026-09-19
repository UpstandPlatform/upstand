import { createHash, createHmac } from "node:crypto";
import type {
  SecretProviderConfiguration,
  SecretProviderType,
} from "@upstand/domain";
import { env } from "@upstand/env/server";
import { assertConfiguredHttpUrl } from "@upstand/platform/network/outbound";
import { readResponseJsonLimited } from "@upstand/platform/network/response-body";
import type { ExternalSecretProviderPort } from "@upstand/usecases";

const SECRET_PROVIDER_TIMEOUT_MS = 15_000;
const MAX_SECRET_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DISCOVERED_SECRET_NAMES = 500;
type JsonRecord = Record<string, unknown>;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function scalarValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return undefined;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}
function collapseRepeatedSlashes(value: string): string {
  let result = "";
  let previousWasSlash = false;
  for (const character of value) {
    const isSlash = character === "/";
    if (isSlash && previousWasSlash) continue;
    result += character;
    previousWasSlash = isSlash;
  }
  return result;
}
function objectToValues(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const converted = scalarValue(item);
      return converted === undefined ? [] : [[key, converted]];
    }),
  );
}
function configurationProviderType(
  provider: SecretProviderType,
  configuration: SecretProviderConfiguration,
): SecretProviderType {
  const configured = stringValue(configuration.providerType);
  if (configured) {
    if (configured !== provider) {
      throw new Error(
        `Secret provider configuration type "${configured}" does not match "${provider}"`,
      );
    }
    return configured as SecretProviderType;
  }
  return provider;
}
function allowlistedHosts(): string[] {
  return (env.UPSTAND_SECRET_PROVIDER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}
async function safeProviderUrl(rawUrl: string): Promise<string> {
  const url = await assertConfiguredHttpUrl(rawUrl, allowlistedHosts());
  return trimTrailingSlashes(url.toString());
}
function providerRequestInit(
  headers: Record<string, string>,
  init: RequestInit = {},
): RequestInit {
  return {
    ...init,
    headers: {
      ...headers,
      ...(init.headers as Record<string, string> | undefined),
    },
    redirect: "error",
    signal: AbortSignal.timeout(SECRET_PROVIDER_TIMEOUT_MS),
  };
}
async function responseJson(response: Response): Promise<unknown> {
  return readResponseJsonLimited(response, MAX_SECRET_PROVIDER_RESPONSE_BYTES);
}
async function responseError(
  response: Response,
  provider: string,
): Promise<never> {
  let detail = "";
  try {
    const body = await responseJson(response);
    if (isRecord(body)) {
      detail = stringValue(body.message) ?? stringValue(body.error) ?? "";
    }
  } catch {
    // Keep the status when a provider returns non-JSON.
  }
  throw new Error(
    `${provider}: request failed (status ${response.status}${detail ? `: ${detail}` : ""})`,
  );
}
async function fetchJson(
  url: string,
  provider: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(url, providerRequestInit({}, init)).catch(() => {
    throw new Error(`Unable to connect to ${provider}.`);
  });
  if (!response.ok) await responseError(response, provider);
  return responseJson(response);
}
function requireValues(
  configuration: SecretProviderConfiguration,
  keys: string[],
  provider: string,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of keys) {
    const value = stringValue(
      configuration[key as keyof SecretProviderConfiguration],
    );
    if (!value) throw new Error(`${provider} requires ${keys.join(", ")}`);
    values[key] = value;
  }
  return values;
}

function requiredValue(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (!value) throw new Error(`Missing required provider value: ${key}`);
  return value;
}
function parseFieldReference(
  reference: string,
  provider: string,
): {
  secretId: string;
  field: string | null;
} {
  const separatorIndex = reference.lastIndexOf(":");
  if (separatorIndex === -1) return { secretId: reference, field: null };
  const secretId = reference.slice(0, separatorIndex);
  const field = reference.slice(separatorIndex + 1);
  if (!secretId || !field) {
    throw new Error(
      `${provider}: invalid reference "${reference}"; expected <secret-name> or <secret-name>:<field>`,
    );
  }
  return { secretId, field };
}

async function awsRequest(
  configuration: SecretProviderConfiguration,
  service: "secretsmanager" | "ssm",
  target: string,
  body: JsonRecord,
): Promise<JsonRecord> {
  const values = requireValues(
    configuration,
    ["region", "accessKeyId", "secretAccessKey"],
    service === "ssm" ? "AWS Parameter Store" : "AWS Secrets Manager",
  );
  const configuredEndpoint = stringValue(configuration.endpoint);
  const endpoint = configuredEndpoint
    ? new URL(await safeProviderUrl(configuredEndpoint))
    : new URL(
        `https://${service}.${requiredValue(values, "region")}.amazonaws.com/`,
      );
  const host = endpoint.host;
  const payload = JSON.stringify(body);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const contentType = "application/x-amz-json-1.1";
  const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`;
  const canonicalRequest = [
    "POST",
    endpoint.pathname || "/",
    endpoint.search.slice(1),
    canonicalHeaders,
    signedHeaders,
    createHash("sha256").update(payload).digest("hex"),
  ].join("\n");
  const region = requiredValue(values, "region");
  const accessKeyId = requiredValue(values, "accessKeyId");
  const secretAccessKey = requiredValue(values, "secretAccessKey");
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
  const response = await fetch(
    endpoint.toString(),
    providerRequestInit(
      {
        "Content-Type": contentType,
        Host: host,
        "X-Amz-Date": amzDate,
        "X-Amz-Target": target,
        Authorization:
          `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      { method: "POST", body: payload },
    ),
  ).catch(() => {
    throw new Error(`Unable to connect to AWS ${service}.`);
  });
  if (!response.ok) {
    await responseError(
      response,
      service === "ssm" ? "AWS Parameter Store" : "AWS Secrets Manager",
    );
  }
  const result = await responseJson(response);
  return isRecord(result) ? result : {};
}

async function readHashicorp(
  configuration: SecretProviderConfiguration,
  references: string[],
): Promise<Record<string, string>> {
  const values = requireValues(
    configuration,
    ["url", "token"],
    "HashiCorp Vault",
  );
  const mount = stringValue(configuration.mount) ?? "secret";
  const headers: Record<string, string> = {
    "X-Vault-Token": requiredValue(values, "token"),
  };
  const namespace = stringValue(configuration.namespace);
  if (namespace) headers["X-Vault-Namespace"] = namespace;
  const baseUrl = await safeProviderUrl(requiredValue(values, "url"));
  const byPath = new Map<string, string[]>();
  for (const reference of references) {
    const separatorIndex = reference.lastIndexOf(":");
    if (separatorIndex <= 0 || separatorIndex === reference.length - 1) {
      throw new Error(
        `HashiCorp Vault: invalid reference "${reference}"; expected <path>:<field>`,
      );
    }
    const path = reference.slice(0, separatorIndex);
    byPath.set(path, [...(byPath.get(path) ?? []), reference]);
  }
  const result: Record<string, string> = {};
  await Promise.all(
    [...byPath.entries()].map(async ([path, pathReferences]) => {
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      const body = await fetchJson(
        `${baseUrl}/v1/${encodeURIComponent(mount)}/data/${encodedPath}`,
        "HashiCorp Vault",
        providerRequestInit(headers),
      );
      const data =
        isRecord(body) && isRecord(body.data) && isRecord(body.data.data)
          ? body.data.data
          : {};
      for (const reference of pathReferences) {
        const field = reference.slice(reference.lastIndexOf(":") + 1);
        const value = scalarValue(data[field]);
        if (value === undefined) {
          throw new Error(
            `HashiCorp Vault: field "${field}" not found in secret "${path}"`,
          );
        }
        result[reference] = value;
      }
    }),
  );
  return result;
}

async function infisicalLogin(configuration: SecretProviderConfiguration) {
  const values = requireValues(
    configuration,
    ["siteUrl", "clientId", "clientSecret"],
    "Infisical",
  );
  const baseUrl = await safeProviderUrl(requiredValue(values, "siteUrl"));
  const body = await fetchJson(
    `${baseUrl}/api/v1/auth/universal-auth/login`,
    "Infisical",
    providerRequestInit(
      { "Content-Type": "application/json" },
      {
        method: "POST",
        body: JSON.stringify({
          clientId: requiredValue(values, "clientId"),
          clientSecret: requiredValue(values, "clientSecret"),
        }),
      },
    ),
  );
  const token = isRecord(body) ? stringValue(body.accessToken) : undefined;
  if (!token) throw new Error("Infisical: no access token returned");
  return { baseUrl, token };
}

async function readInfisical(
  configuration: SecretProviderConfiguration,
  references: string[],
): Promise<Record<string, string>> {
  const { baseUrl, token } = await infisicalLogin(configuration);
  const projectId = stringValue(configuration.projectId);
  const environmentSlug = stringValue(configuration.environmentSlug);
  if (!projectId || !environmentSlug) {
    throw new Error("Infisical requires projectId and environmentSlug");
  }
  const basePath = stringValue(configuration.secretPath) ?? "/";
  const byPath = new Map<string, string[]>();
  for (const reference of references) {
    const separatorIndex = reference.lastIndexOf(":");
    const path =
      separatorIndex === -1 ? null : reference.slice(0, separatorIndex);
    const key =
      separatorIndex === -1 ? reference : reference.slice(separatorIndex + 1);
    if (!key || (separatorIndex !== -1 && !path)) {
      throw new Error(
        `Infisical: invalid reference "${reference}"; expected <KEY> or <path>:<KEY>`,
      );
    }
    const secretPath = path
      ? path.startsWith("/")
        ? path
        : `${trimTrailingSlashes(basePath)}/${path}`
      : basePath;
    const normalizedPath = collapseRepeatedSlashes(secretPath);
    byPath.set(normalizedPath, [
      ...(byPath.get(normalizedPath) ?? []),
      reference,
    ]);
  }
  const result: Record<string, string> = {};
  await Promise.all(
    [...byPath.entries()].map(async ([secretPath, pathReferences]) => {
      const params = new URLSearchParams({
        workspaceId: projectId,
        environment: environmentSlug,
        secretPath,
        expandSecretReferences: "true",
        include_imports: "true",
      });
      const body = await fetchJson(
        `${baseUrl}/api/v3/secrets/raw?${params.toString()}`,
        "Infisical",
        providerRequestInit({ Authorization: `Bearer ${token}` }),
      );
      const secrets: Record<string, string> = {};
      if (isRecord(body) && Array.isArray(body.imports)) {
        for (const imported of body.imports) {
          if (!isRecord(imported) || !Array.isArray(imported.secrets)) continue;
          for (const secret of imported.secrets) {
            if (!isRecord(secret)) continue;
            const key = stringValue(secret.secretKey);
            const value = scalarValue(secret.secretValue);
            if (key && value !== undefined) secrets[key] = value;
          }
        }
      }
      if (isRecord(body) && Array.isArray(body.secrets)) {
        for (const secret of body.secrets) {
          if (!isRecord(secret)) continue;
          const key = stringValue(secret.secretKey);
          const value = scalarValue(secret.secretValue);
          if (key && value !== undefined) secrets[key] = value;
        }
      }
      for (const reference of pathReferences) {
        const separatorIndex = reference.lastIndexOf(":");
        const key =
          separatorIndex === -1
            ? reference
            : reference.slice(separatorIndex + 1);
        const value = secrets[key];
        if (value === undefined) {
          throw new Error(
            `Infisical: secret "${key}" not found at "${secretPath}"`,
          );
        }
        result[reference] = value;
      }
    }),
  );
  return result;
}

async function readAws(
  configuration: SecretProviderConfiguration,
  references: string[],
): Promise<Record<string, string>> {
  const secretStrings = new Map<string, string>();
  for (const secretId of [
    ...new Set(
      references.map(
        (ref) => parseFieldReference(ref, "AWS Secrets Manager").secretId,
      ),
    ),
  ]) {
    const body = await awsRequest(
      configuration,
      "secretsmanager",
      "secretsmanager.GetSecretValue",
      { SecretId: secretId },
    );
    const value = scalarValue(body.SecretString);
    if (value === undefined) {
      throw new Error(
        `AWS Secrets Manager: secret "${secretId}" has no string value`,
      );
    }
    secretStrings.set(secretId, value);
  }
  const result: Record<string, string> = {};
  for (const reference of references) {
    const { secretId, field } = parseFieldReference(
      reference,
      "AWS Secrets Manager",
    );
    const raw = secretStrings.get(secretId);
    if (raw === undefined) {
      throw new Error(
        `AWS Secrets Manager: secret "${secretId}" was not returned`,
      );
    }
    if (!field) {
      result[reference] = raw;
      continue;
    }
    let parsed: JsonRecord;
    try {
      const value = JSON.parse(raw) as unknown;
      if (!isRecord(value)) throw new Error("not an object");
      parsed = value;
    } catch {
      throw new Error(
        `AWS Secrets Manager: secret "${secretId}" is not JSON, cannot extract field "${field}"`,
      );
    }
    const value = scalarValue(parsed[field]);
    if (value === undefined) {
      throw new Error(
        `AWS Secrets Manager: field "${field}" not found in secret "${secretId}"`,
      );
    }
    result[reference] = value;
  }
  return result;
}

async function readParameterStore(
  configuration: SecretProviderConfiguration,
  references: string[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (let index = 0; index < references.length; index += 10) {
    const batch = references.slice(index, index + 10);
    const body = await awsRequest(
      configuration,
      "ssm",
      "AmazonSSM.GetParameters",
      {
        Names: batch,
        WithDecryption: true,
      },
    );
    const found = new Set<string>();
    if (Array.isArray(body.Parameters)) {
      for (const parameter of body.Parameters) {
        if (!isRecord(parameter)) continue;
        const name = stringValue(parameter.Name);
        const value = scalarValue(parameter.Value);
        if (name && value !== undefined) {
          result[name] = value;
          found.add(name);
        }
      }
    }
    for (const reference of batch) {
      if (!found.has(reference)) {
        throw new Error(
          `AWS Parameter Store: parameter "${reference}" not found`,
        );
      }
    }
  }
  return result;
}

async function readDoppler(
  configuration: SecretProviderConfiguration,
  references: string[],
): Promise<Record<string, string>> {
  const token = stringValue(configuration.serviceToken);
  if (!token) throw new Error("Doppler requires serviceToken");
  const params = new URLSearchParams({ format: "json" });
  for (const key of ["project", "config"] as const) {
    const value = stringValue(configuration[key]);
    if (value) params.set(key, value);
  }
  const body = await fetchJson(
    `https://api.doppler.com/v3/configs/config/secrets/download?${params.toString()}`,
    "Doppler",
    providerRequestInit({
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    }),
  );
  const secrets = objectToValues(body);
  const result: Record<string, string> = {};
  for (const reference of references) {
    if (secrets[reference] === undefined) {
      throw new Error(
        `Doppler: secret "${reference}" not found in this config`,
      );
    }
    result[reference] = secrets[reference];
  }
  return result;
}

async function azureToken(configuration: SecretProviderConfiguration) {
  const values = requireValues(
    configuration,
    ["vaultUri", "tenantId", "clientId", "clientSecret"],
    "Azure Key Vault",
  );
  const body = await fetchJson(
    `https://login.microsoftonline.com/${encodeURIComponent(requiredValue(values, "tenantId"))}/oauth2/v2.0/token`,
    "Azure Key Vault",
    providerRequestInit(
      { "Content-Type": "application/x-www-form-urlencoded" },
      {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: requiredValue(values, "clientId"),
          client_secret: requiredValue(values, "clientSecret"),
          scope: "https://vault.azure.net/.default",
        }).toString(),
      },
    ),
  );
  const token = isRecord(body) ? stringValue(body.access_token) : undefined;
  if (!token) throw new Error("Azure Key Vault: no access token returned");
  return {
    baseUrl: await safeProviderUrl(requiredValue(values, "vaultUri")),
    token,
  };
}

async function readAzure(
  configuration: SecretProviderConfiguration,
  references: string[],
): Promise<Record<string, string>> {
  const { baseUrl, token } = await azureToken(configuration);
  const result: Record<string, string> = {};
  await Promise.all(
    references.map(async (reference) => {
      const body = await fetchJson(
        `${baseUrl}/secrets/${encodeURIComponent(reference)}?api-version=7.4`,
        "Azure Key Vault",
        providerRequestInit({ Authorization: `Bearer ${token}` }),
      );
      const value = isRecord(body) ? scalarValue(body.value) : undefined;
      if (value === undefined) {
        throw new Error(`Azure Key Vault: secret "${reference}" has no value`);
      }
      result[reference] = value;
    }),
  );
  return result;
}

async function readScaleway(
  configuration: SecretProviderConfiguration,
  references: string[],
): Promise<Record<string, string>> {
  const values = requireValues(
    configuration,
    ["projectId", "secretKey"],
    "Scaleway Secret Manager",
  );
  const region = stringValue(configuration.region) ?? "fr-par";
  const apiUrl = await safeProviderUrl(
    stringValue(configuration.apiUrl) ?? "https://api.scaleway.com",
  );
  const result: Record<string, string> = {};
  const cache = new Map<string, string>();
  for (const reference of references) {
    const { secretId, field } = parseFieldReference(
      reference,
      "Scaleway Secret Manager",
    );
    const slash = secretId.lastIndexOf("/");
    const name = secretId.slice(slash + 1);
    const path = slash === -1 ? "/" : `/${secretId.slice(0, slash)}`;
    const cacheKey = `${path}#${name}`;
    let raw = cache.get(cacheKey);
    if (raw === undefined) {
      const params = new URLSearchParams({
        project_id: requiredValue(values, "projectId"),
        secret_name: name,
        secret_path: path,
      });
      const body = await fetchJson(
        `${apiUrl}/secret-manager/v1beta1/regions/${encodeURIComponent(region)}/secrets-by-path/versions/latest_enabled/access?${params.toString()}`,
        "Scaleway Secret Manager",
        providerRequestInit({
          "X-Auth-Token": requiredValue(values, "secretKey"),
          Accept: "application/json",
        }),
      );
      const encoded = isRecord(body) ? scalarValue(body.data) : undefined;
      if (!encoded) {
        throw new Error(
          `Scaleway Secret Manager: secret "${secretId}" has no enabled version`,
        );
      }
      raw = Buffer.from(encoded, "base64").toString("utf-8");
      cache.set(cacheKey, raw);
    }
    if (!field) {
      result[reference] = raw;
      continue;
    }
    let parsed: JsonRecord;
    try {
      const value = JSON.parse(raw) as unknown;
      if (!isRecord(value)) throw new Error("not an object");
      parsed = value;
    } catch {
      throw new Error(
        `Scaleway Secret Manager: secret "${name}" is not JSON, cannot extract field "${field}"`,
      );
    }
    const value = scalarValue(parsed[field]);
    if (value === undefined) {
      throw new Error(
        `Scaleway Secret Manager: field "${field}" not found in secret "${name}"`,
      );
    }
    result[reference] = value;
  }
  return result;
}

async function readPhase(
  configuration: SecretProviderConfiguration,
  references: string[],
): Promise<Record<string, string>> {
  const values = requireValues(
    configuration,
    ["apiUrl", "token", "appId", "env"],
    "Phase",
  );
  const apiUrl = requiredValue(values, "apiUrl");
  const token = requiredValue(values, "token");
  const appId = requiredValue(values, "appId");
  const environment = requiredValue(values, "env");
  const params = new URLSearchParams({
    app_id: appId,
    env: environment,
    path: stringValue(configuration.path) ?? "/",
  });
  const baseUrl = await safeProviderUrl(apiUrl);
  const body = await fetchJson(
    `${baseUrl}/v1/secrets/?${params.toString()}`,
    "Phase",
    providerRequestInit({
      Authorization: `Bearer ServiceAccount ${token}`,
      Accept: "application/json",
    }),
  );
  const secrets = new Map<string, string>();
  if (Array.isArray(body)) {
    for (const item of body) {
      if (!isRecord(item)) continue;
      const key = stringValue(item.key);
      const value = scalarValue(item.value);
      if (key && value !== undefined) secrets.set(key, value);
    }
  }
  const result: Record<string, string> = {};
  for (const reference of references) {
    const value = secrets.get(reference);
    if (value === undefined) {
      throw new Error(
        `Phase: secret "${reference}" not found in environment "${environment}"`,
      );
    }
    result[reference] = value;
  }
  return result;
}

async function readOnePassword(
  configuration: SecretProviderConfiguration,
): Promise<Record<string, string>> {
  const values = requireValues(
    configuration,
    ["connectHost", "connectToken", "vaultId", "itemId"],
    "1Password Connect",
  );
  const host = await safeProviderUrl(requiredValue(values, "connectHost"));
  const body = await fetchJson(
    `${host}/v1/vaults/${encodeURIComponent(requiredValue(values, "vaultId"))}/items/${encodeURIComponent(requiredValue(values, "itemId"))}`,
    "1Password Connect",
    providerRequestInit({
      Authorization: `Bearer ${requiredValue(values, "connectToken")}`,
      Accept: "application/json",
    }),
  );
  const result: Record<string, string> = {};
  if (isRecord(body) && Array.isArray(body.fields)) {
    for (const field of body.fields) {
      if (!isRecord(field)) continue;
      const label = stringValue(field.label);
      const value = scalarValue(field.value);
      if (label && value !== undefined) result[label] = value;
    }
  }
  return result;
}

async function readLegacyVault(
  configuration: SecretProviderConfiguration,
): Promise<Record<string, string>> {
  const values = requireValues(
    configuration,
    ["address", "path", "token"],
    "Vault",
  );
  const address = await safeProviderUrl(requiredValue(values, "address"));
  const encodedPath = requiredValue(values, "path")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const body = await fetchJson(
    `${address}/v1/${encodedPath}`,
    "Vault",
    providerRequestInit({
      "X-Vault-Token": requiredValue(values, "token"),
      Accept: "application/json",
    }),
  );
  if (!isRecord(body) || !isRecord(body.data)) return {};
  return objectToValues(isRecord(body.data.data) ? body.data.data : body.data);
}

async function readLegacyAws(
  configuration: SecretProviderConfiguration,
): Promise<Record<string, string>> {
  const path = stringValue(configuration.path);
  if (!path) throw new Error("AWS Secrets Manager requires path");
  const values = await readAws(configuration, [path]);
  const raw = values[path];
  if (raw === undefined)
    throw new Error(`AWS Secrets Manager: secret "${path}" not found`);
  try {
    return objectToValues(JSON.parse(raw) as unknown);
  } catch {
    return { SECRET: raw };
  }
}

export class SecretProviderRegistry implements ExternalSecretProviderPort {
  async read(
    provider: SecretProviderType,
    configuration: SecretProviderConfiguration,
  ): Promise<Record<string, string>> {
    const type = configurationProviderType(provider, configuration);
    if (type === "vault") return readLegacyVault(configuration);
    if (type === "aws-secrets-manager") return readLegacyAws(configuration);
    if (type === "onepassword") return readOnePassword(configuration);
    const names = await this.listSecretNames(type, configuration);
    return this.readReferences(type, configuration, names);
  }

  async readReferences(
    provider: SecretProviderType,
    configuration: SecretProviderConfiguration,
    references: string[],
  ): Promise<Record<string, string>> {
    const type = configurationProviderType(provider, configuration);
    if (type === "vault") {
      const values = await readLegacyVault(configuration);
      return Object.fromEntries(
        references.map((reference) => {
          const field = reference.includes(":")
            ? reference.slice(reference.lastIndexOf(":") + 1)
            : reference;
          const value = values[reference] ?? values[field];
          if (value === undefined)
            throw new Error(`Vault: secret "${reference}" not found`);
          return [reference, value];
        }),
      );
    }
    if (type === "aws-secrets-manager") {
      const values = await readLegacyAws(configuration);
      return Object.fromEntries(
        references.map((reference) => {
          const value = values[reference];
          if (value === undefined)
            throw new Error(
              `AWS Secrets Manager: secret "${reference}" not found`,
            );
          return [reference, value];
        }),
      );
    }
    if (type === "onepassword") {
      const values = await readOnePassword(configuration);
      return Object.fromEntries(
        references.map((reference) => {
          const value = values[reference];
          if (value === undefined)
            throw new Error(
              `1Password Connect: field "${reference}" not found`,
            );
          return [reference, value];
        }),
      );
    }
    if (type === "hashicorp") return readHashicorp(configuration, references);
    if (type === "infisical") return readInfisical(configuration, references);
    if (type === "aws") return readAws(configuration, references);
    if (type === "aws-parameter-store")
      return readParameterStore(configuration, references);
    if (type === "doppler") return readDoppler(configuration, references);
    if (type === "azure") return readAzure(configuration, references);
    if (type === "scaleway") return readScaleway(configuration, references);
    if (type === "phase") return readPhase(configuration, references);
    throw new Error(`Unsupported secret provider: ${type}`);
  }

  async listSecretNames(
    provider: SecretProviderType,
    configuration: SecretProviderConfiguration,
  ): Promise<string[]> {
    const type = configurationProviderType(provider, configuration);
    if (type === "vault")
      return Object.keys(await readLegacyVault(configuration));
    if (type === "onepassword")
      return Object.keys(await readOnePassword(configuration));
    if (type === "aws-secrets-manager") {
      const path = stringValue(configuration.path);
      return path ? [path] : [];
    }
    if (type === "doppler") {
      const token = stringValue(configuration.serviceToken);
      if (!token) throw new Error("Doppler requires serviceToken");
      const body = await fetchJson(
        "https://api.doppler.com/v3/configs/config/secrets/download?format=json",
        "Doppler",
        providerRequestInit({ Authorization: `Bearer ${token}` }),
      );
      return Object.keys(objectToValues(body)).slice(
        0,
        MAX_DISCOVERED_SECRET_NAMES,
      );
    }
    if (type === "infisical") {
      const { baseUrl, token } = await infisicalLogin(configuration);
      const projectId = stringValue(configuration.projectId);
      const environmentSlug = stringValue(configuration.environmentSlug);
      if (!projectId || !environmentSlug)
        throw new Error("Infisical requires projectId and environmentSlug");
      const params = new URLSearchParams({
        workspaceId: projectId,
        environment: environmentSlug,
        secretPath: stringValue(configuration.secretPath) ?? "/",
        include_imports: "true",
      });
      const body = await fetchJson(
        `${baseUrl}/api/v3/secrets/raw?${params.toString()}`,
        "Infisical",
        providerRequestInit({ Authorization: `Bearer ${token}` }),
      );
      if (!isRecord(body) || !Array.isArray(body.secrets)) return [];
      return body.secrets
        .flatMap((item) =>
          isRecord(item) && typeof item.secretKey === "string"
            ? [item.secretKey]
            : [],
        )
        .slice(0, MAX_DISCOVERED_SECRET_NAMES);
    }
    if (type === "aws") {
      const names: string[] = [];
      let nextToken: string | undefined;
      do {
        const body = await awsRequest(
          configuration,
          "secretsmanager",
          "secretsmanager.ListSecrets",
          { MaxResults: 100, ...(nextToken ? { NextToken: nextToken } : {}) },
        );
        if (Array.isArray(body.SecretList)) {
          for (const item of body.SecretList) {
            const name = isRecord(item) ? stringValue(item.Name) : undefined;
            if (name) names.push(name);
          }
        }
        nextToken = stringValue(body.NextToken);
      } while (nextToken && names.length < MAX_DISCOVERED_SECRET_NAMES);
      return names.slice(0, MAX_DISCOVERED_SECRET_NAMES);
    }
    if (type === "aws-parameter-store") {
      const body = await awsRequest(
        configuration,
        "ssm",
        "AmazonSSM.DescribeParameters",
        { MaxResults: 50 },
      );
      if (!Array.isArray(body.Parameters)) return [];
      return body.Parameters.flatMap((item) =>
        isRecord(item) && typeof item.Name === "string" ? [item.Name] : [],
      ).slice(0, MAX_DISCOVERED_SECRET_NAMES);
    }
    if (type === "azure") {
      const { baseUrl, token } = await azureToken(configuration);
      const body = await fetchJson(
        `${baseUrl}/secrets?api-version=7.4&maxresults=25`,
        "Azure Key Vault",
        providerRequestInit({ Authorization: `Bearer ${token}` }),
      );
      if (!isRecord(body) || !Array.isArray(body.value)) return [];
      return body.value
        .flatMap((item) => {
          if (!isRecord(item) || typeof item.id !== "string") return [];
          const name = item.id.split("/").pop();
          return name ? [name] : [];
        })
        .slice(0, MAX_DISCOVERED_SECRET_NAMES);
    }
    if (type === "scaleway") {
      const values = requireValues(
        configuration,
        ["projectId", "secretKey"],
        "Scaleway Secret Manager",
      );
      const region = stringValue(configuration.region) ?? "fr-par";
      const apiUrl = await safeProviderUrl(
        stringValue(configuration.apiUrl) ?? "https://api.scaleway.com",
      );
      const params = new URLSearchParams({
        project_id: requiredValue(values, "projectId"),
        page_size: "100",
      });
      const body = await fetchJson(
        `${apiUrl}/secret-manager/v1beta1/regions/${encodeURIComponent(region)}/secrets?${params.toString()}`,
        "Scaleway Secret Manager",
        providerRequestInit({
          "X-Auth-Token": requiredValue(values, "secretKey"),
        }),
      );
      if (!isRecord(body) || !Array.isArray(body.secrets)) return [];
      return body.secrets
        .flatMap((item) => {
          if (!isRecord(item) || typeof item.name !== "string") return [];
          const folder =
            typeof item.path === "string"
              ? item.path.replace(/^\/+|\/+$/g, "")
              : "";
          return [folder ? `${folder}/${item.name}` : item.name];
        })
        .slice(0, MAX_DISCOVERED_SECRET_NAMES);
    }
    if (type === "phase") {
      const values = requireValues(
        configuration,
        ["apiUrl", "token", "appId", "env"],
        "Phase",
      );
      const params = new URLSearchParams({
        app_id: requiredValue(values, "appId"),
        env: requiredValue(values, "env"),
        path: stringValue(configuration.path) ?? "/",
      });
      const baseUrl = await safeProviderUrl(requiredValue(values, "apiUrl"));
      const body = await fetchJson(
        `${baseUrl}/v1/secrets/?${params.toString()}`,
        "Phase",
        providerRequestInit({
          Authorization: `Bearer ServiceAccount ${requiredValue(values, "token")}`,
        }),
      );
      if (!Array.isArray(body)) return [];
      return body
        .flatMap((item) =>
          isRecord(item) && typeof item.key === "string" ? [item.key] : [],
        )
        .slice(0, MAX_DISCOVERED_SECRET_NAMES);
    }
    // HashiCorp metadata discovery is intentionally opt-in through explicit
    // references; listing arbitrary Vault paths is often forbidden by policy.
    if (type === "hashicorp") return [];
    throw new Error(`Unsupported secret provider: ${type}`);
  }

  async testConnection(
    provider: SecretProviderType,
    configuration: SecretProviderConfiguration,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const type = configurationProviderType(provider, configuration);
      if (type === "hashicorp") {
        const values = requireValues(
          configuration,
          ["url", "token"],
          "HashiCorp Vault",
        );
        const headers: Record<string, string> = {
          "X-Vault-Token": requiredValue(values, "token"),
        };
        const namespace = stringValue(configuration.namespace);
        if (namespace) headers["X-Vault-Namespace"] = namespace;
        const baseUrl = await safeProviderUrl(requiredValue(values, "url"));
        await fetchJson(
          `${baseUrl}/v1/auth/token/lookup-self`,
          "HashiCorp Vault",
          providerRequestInit(headers),
        );
      } else if (type === "infisical") {
        await infisicalLogin(configuration);
      } else if (type === "aws") {
        await awsRequest(
          configuration,
          "secretsmanager",
          "secretsmanager.ListSecrets",
          { MaxResults: 1 },
        );
      } else if (type === "aws-parameter-store") {
        await awsRequest(configuration, "ssm", "AmazonSSM.DescribeParameters", {
          MaxResults: 1,
        });
      } else if (
        type === "doppler" ||
        type === "azure" ||
        type === "scaleway" ||
        type === "phase"
      ) {
        await this.listSecretNames(type, configuration);
      } else if (
        type === "vault" ||
        type === "aws-secrets-manager" ||
        type === "onepassword"
      ) {
        await this.read(type, configuration);
      } else {
        throw new Error(`Unsupported secret provider: ${type}`);
      }
      return {
        success: true,
        message: "Successfully connected to the secret provider.",
      };
    } catch (error: unknown) {
      return {
        success: false,
        message: errorMessage(error) || "Failed to connect to secret provider.",
      };
    }
  }
}
