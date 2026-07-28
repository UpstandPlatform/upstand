import { expect } from "bun:test";

export type E2eResource = {
  id: string;
  status: string;
  type?: string;
  provider?: string;
  composeType?: string | null;
};

export type LocalE2eContext = {
  baseUrl: string;
  authCookie?: string;
  resourceId?: string;
  organizationId?: string;
  mutationsAllowed: boolean;
  serverAvailable: boolean;
  resourceConfigured: boolean;
  organizationConfigured: boolean;
};

const requestTimeoutMs = Number(process.env.E2E_REQUEST_TIMEOUT_MS ?? 5000);

export const e2eContext: LocalE2eContext = {
  baseUrl: process.env.E2E_BASE_URL ?? "http://localhost:3000",
  authCookie: process.env.E2E_AUTH_COOKIE,
  resourceId: process.env.E2E_RESOURCE_ID,
  organizationId: process.env.E2E_ORGANIZATION_ID,
  mutationsAllowed: process.env.E2E_ALLOW_MUTATIONS === "1",
  serverAvailable: false,
  resourceConfigured: Boolean(
    process.env.E2E_AUTH_COOKIE && process.env.E2E_RESOURCE_ID,
  ),
  organizationConfigured: Boolean(
    process.env.E2E_AUTH_COOKIE && process.env.E2E_ORGANIZATION_ID,
  ),
};

export function fetchWithTimeout(input: string, init?: RequestInit) {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
}

e2eContext.serverAvailable = await fetchWithTimeout(
  `${e2eContext.baseUrl}/health/live`,
)
  .then((response) => response.ok)
  .catch(() => false);

export async function trpc(
  procedure: string,
  input: Record<string, unknown>,
  method: "GET" | "POST" = "GET",
  options: { authenticated?: boolean } = {},
) {
  // The server uses tRPC's default v11 transformer, which expects the raw
  // input object. The `{ json: ... }` envelope belongs to transformer-aware
  // client serializers and is not part of the HTTP input contract here.
  const encoded = encodeURIComponent(JSON.stringify(input));
  const response = await fetchWithTimeout(
    `${e2eContext.baseUrl}/trpc/${procedure}${method === "GET" ? `?input=${encoded}` : ""}`,
    {
      method,
      headers: {
        ...(options.authenticated !== false && e2eContext.authCookie
          ? { cookie: e2eContext.authCookie }
          : {}),
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      body: method === "POST" ? JSON.stringify(input) : undefined,
    },
  );
  const body: unknown = await response.json().catch(() => null);
  return { response, body };
}

export function trpcJson(body: unknown): unknown {
  if (!body || typeof body !== "object") return undefined;
  const result = (body as { result?: { data?: unknown } }).result;
  if (!result || !("data" in result)) return undefined;
  const data = result.data;
  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    "json" in data
  ) {
    return (data as { json?: unknown }).json;
  }
  return data;
}

export async function getResource(): Promise<E2eResource> {
  expect(e2eContext.resourceId).toBeTruthy();
  const result = await trpc("resource.get", { id: e2eContext.resourceId });
  expect(result.response.ok).toBe(true);
  const resource = trpcJson(result.body) as E2eResource | undefined;
  expect(resource?.id).toBe(e2eContext.resourceId);
  expect(resource?.status).toEqual(expect.any(String));
  return resource as E2eResource;
}

export async function getResourceContainers() {
  expect(e2eContext.resourceId).toBeTruthy();
  const result = await trpc("resource.getContainers", {
    id: e2eContext.resourceId,
  });
  expect(result.response.ok).toBe(true);
  const containers = trpcJson(result.body);
  expect(Array.isArray(containers)).toBe(true);
  return containers as Array<{
    id: string;
    status: string;
    name?: string;
    node?: string;
  }>;
}
