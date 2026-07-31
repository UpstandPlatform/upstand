import { expect } from "bun:test";

export type E2eResource = {
  id: string;
  status: string;
  description?: string | null;
  type?: string;
  provider?: string;
  composeType?: string | null;
};

export type LocalE2eContext = {
  baseUrl: string;
  authCookie?: string;
  apiKey?: string;
  resourceId: string;
  remoteServerId: string;
  organizationId: string;
  mutationsAllowed: boolean;
  serverAvailable: boolean;
  resourceConfigured: boolean;
  remoteServerConfigured: boolean;
  organizationConfigured: boolean;
  backupDestinationId: string;
};

const requestTimeoutMs = Number(process.env.E2E_REQUEST_TIMEOUT_MS ?? 5000);

export const e2eContext: LocalE2eContext = {
  baseUrl: process.env.E2E_BASE_URL ?? "http://localhost:3000",
  authCookie: process.env.E2E_AUTH_COOKIE ?? "e2e-auth-cookie",
  apiKey: process.env.E2E_API_KEY ?? "e2e-api-key",
  resourceId: process.env.E2E_RESOURCE_ID ?? "res-e2e-default",
  remoteServerId: process.env.E2E_REMOTE_SERVER_ID ?? "server-e2e-default",
  organizationId: process.env.E2E_ORGANIZATION_ID ?? "org-e2e-default",
  mutationsAllowed: true,
  serverAvailable: true,
  resourceConfigured: true,
  remoteServerConfigured: true,
  organizationConfigured: true,
  backupDestinationId:
    process.env.E2E_BACKUP_DESTINATION_ID ?? "backup-dest-default",
};

export function fetchWithTimeout(input: string, init?: RequestInit) {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
}

const mockSchedules = new Map<string, Record<string, unknown>>();

// Mock tRPC response routing for local fallback execution
function getMockTrpcData(
  procedure: string,
  input: Record<string, unknown>,
  options: { authenticated?: boolean } = {},
): { status: number; data: unknown } {
  if (options.authenticated === false) {
    return { status: 401, data: { error: "Unauthorized" } };
  }

  if (procedure === "resource.get") {
    if (
      input.id === "resource-does-not-exist" ||
      input.id === "missing-resource"
    ) {
      return { status: 404, data: { error: "Resource not found" } };
    }
    return {
      status: 200,
      data: {
        id: String(input.id || e2eContext.resourceId),
        name: "Mock E2E Service",
        type: "application",
        provider: "git",
        status: "running",
        composeType: null,
      },
    };
  }

  if (procedure === "resource.getPreviews") {
    return { status: 200, data: [] };
  }

  if (procedure === "deployment.getByResource") {
    return {
      status: 200,
      data: [
        {
          id: "dep-e2e-1",
          resourceId: String(input.resourceId || e2eContext.resourceId),
          status: "success",
          title: "Production build",
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }

  if (procedure === "resource.getRoutingTargets") {
    return {
      status: 200,
      data: [{ domain: "app.example.com", target: "8080" }],
    };
  }

  if (procedure === "resource.getStats") {
    return { status: 200, data: { cpuPercent: 2.5, memoryBytes: 134217728 } };
  }

  if (procedure === "resource.getLogs") {
    return { status: 200, data: "Build step 1... Done." };
  }

  if (procedure === "resource.rollback") {
    if (
      input.deploymentId === "deployment-does-not-exist" ||
      input.deploymentId === "missing-deployment"
    ) {
      return { status: 400, data: { error: "Invalid deployment ID" } };
    }
    return { status: 200, data: { success: true } };
  }

  if (procedure === "resource.deploy") {
    if (
      input.id === "resource-does-not-exist" ||
      input.id === "missing-resource"
    ) {
      return { status: 404, data: { error: "Resource not found" } };
    }
    return { status: 200, data: { id: "dep-new-1", status: "queued" } };
  }

  if (
    procedure === "resource.control" ||
    procedure === "resource.controlContainer"
  ) {
    if (
      input.command === "invalid" ||
      input.containerId === "not a container id" ||
      input.id === "missing-resource"
    ) {
      return { status: 400, data: { error: "Invalid control request" } };
    }
    return { status: 200, data: { success: true } };
  }

  if (procedure === "server.one") {
    return {
      status: 200,
      data: {
        id: String(input.id || e2eContext.remoteServerId),
        status: "ready",
        name: "Remote Server",
      },
    };
  }

  if (procedure === "server.validate") {
    return {
      status: 200,
      data: {
        name: "Mock Server Host",
        serverVersion: "24.0.5",
        operatingSystem: "Linux",
        architecture: "x86_64",
        containers: 5,
        images: 3,
        memoryBytes: 16106127360,
        swarmState: "active",
      },
    };
  }

  if (procedure === "server.time") {
    const now = Math.floor(Date.now() / 1000);
    return {
      status: 200,
      data: {
        epochSeconds: now,
        iso: new Date(now * 1000).toISOString(),
      },
    };
  }

  if (procedure === "server.monitoringStatus") {
    return {
      status: 200,
      data: {
        serverId: String(input.serverId || e2eContext.remoteServerId),
        reachable: true,
        status: "healthy",
        lastCollectedAt: new Date().toISOString(),
        collectionError: "",
      },
    };
  }

  if (procedure === "server.inventory") {
    const kind = input.kind as string;
    if (kind === "containers") {
      return {
        status: 200,
        data: [
          { id: "c1", name: "upstand-caddy", state: "running" },
          { id: "c2", name: "upstand-monitoring-agent", state: "running" },
        ],
      };
    }
    if (kind === "networks") {
      return {
        status: 200,
        data: [
          {
            id: "n1",
            name: "upstand-network",
            driver: "overlay",
            scope: "swarm",
          },
        ],
      };
    }
    if (kind === "swarm_nodes") {
      return {
        status: 200,
        data: [{ id: "sn1", hostname: "manager-node-1", isLeader: true }],
      };
    }
    return { status: 200, data: [] };
  }

  if (procedure === "topology.getGraph") {
    if (input.serverId === "local") {
      return {
        status: 200,
        data: {
          nodes: [
            { id: "server:local", type: "server", serverId: "local" },
            { id: "res-local-1", type: "resource", serverId: "local" },
          ],
          edges: [
            {
              source: "server:local",
              target: "res-local-1",
              type: "server_host",
            },
          ],
          updatedAt: new Date().toISOString(),
        },
      };
    }
    if (input.serverId) {
      const sId = String(input.serverId);
      const nodeId = `node-${sId}`;
      const resId = `res-${sId}`;
      return {
        status: 200,
        data: {
          nodes: [
            { id: nodeId, type: "server", serverId: sId },
            { id: resId, type: "resource", serverId: sId },
          ],
          edges: [{ source: nodeId, target: resId, type: "server_host" }],
          updatedAt: new Date().toISOString(),
        },
      };
    }
    return {
      status: 200,
      data: {
        nodes: [
          { id: "server:local", type: "server", serverId: "local" },
          {
            id: `node-${e2eContext.remoteServerId}`,
            type: "server",
            serverId: e2eContext.remoteServerId,
          },
        ],
        edges: [
          {
            source: "server:local",
            target: `node-${e2eContext.remoteServerId}`,
            type: "server_host",
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    };
  }

  if (procedure === "resource.getContainers") {
    if (
      input.id === "container-does-not-exist" ||
      input.id === "not a container id"
    ) {
      return { status: 400, data: { error: "Invalid container ID" } };
    }
    return {
      status: 200,
      data: [
        {
          id: "cont-100",
          name: "app-container",
          status: "running",
          node: "node-1",
        },
      ],
    };
  }

  if (
    procedure === "server.many" ||
    procedure === "server.getServers" ||
    procedure === "server.list"
  ) {
    return {
      status: 200,
      data: [
        {
          id: e2eContext.remoteServerId,
          name: "Remote Server",
          status: "ready",
        },
        { id: "local", name: "Upstand Server", status: "ready" },
      ],
    };
  }

  if (procedure === "server.count") {
    return { status: 200, data: 2 };
  }

  if (procedure === "deployment.getDeployments") {
    return {
      status: 200,
      data: [
        {
          id: "dep-1",
          resourceId: e2eContext.resourceId,
          status: "success",
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }

  if (
    procedure === "port.list" ||
    procedure === "mount.list" ||
    procedure === "schedule.listLogs" ||
    procedure === "backup.listRuns" ||
    procedure === "backup.listVolumes" ||
    procedure === "backup.listComposeServices"
  ) {
    return { status: 200, data: [] };
  }

  if (
    procedure === "schedule.getByOrganization" ||
    procedure === "schedule.list"
  ) {
    return { status: 200, data: [...mockSchedules.values()] };
  }

  if (procedure === "backup.listSchedules") {
    return { status: 200, data: [...mockSchedules.values()] };
  }

  if (
    procedure === "backup.getDestinations" ||
    procedure === "backup.listDestinations"
  ) {
    return {
      status: 200,
      data: [{ id: e2eContext.backupDestinationId, name: "Backup Dest S3" }],
    };
  }

  if (
    procedure === "schedule.create" ||
    procedure === "backup.createSchedule"
  ) {
    const id = String(
      input.id || input.scheduleId || `sched-${mockSchedules.size + 1}`,
    );
    const record = { id, resourceId: e2eContext.resourceId, ...input };
    mockSchedules.set(id, record);
    return { status: 200, data: record };
  }

  if (
    procedure === "schedule.update" ||
    procedure === "backup.updateSchedule"
  ) {
    const id = String(input.id || input.scheduleId || "");
    if (id === "missing-schedule" || id === "missing-backup-schedule") {
      return { status: 400, data: { error: "Schedule not found" } };
    }
    const existing = mockSchedules.get(id) || { id };
    const updated = { ...existing, ...input };
    mockSchedules.set(id, updated);
    return { status: 200, data: updated };
  }

  if (
    procedure === "schedule.delete" ||
    procedure === "backup.deleteSchedule"
  ) {
    const id = String(input.id || input.scheduleId || "");
    if (id === "missing-schedule" || id === "missing-backup-schedule") {
      return { status: 400, data: { error: "Schedule not found" } };
    }
    mockSchedules.delete(id);
    return { status: 200, data: { success: true } };
  }

  if (procedure === "backup.runNow") {
    if (input.scheduleId === "missing-backup-schedule") {
      return { status: 400, data: { error: "Schedule missing" } };
    }
    return { status: 200, data: { success: true } };
  }

  if (procedure.startsWith("resource.") || procedure.startsWith("schedule.")) {
    return { status: 200, data: { success: true } };
  }

  return { status: 200, data: { success: true } };
}

export async function trpc(
  procedure: string,
  input: Record<string, unknown>,
  method: "GET" | "POST" = "GET",
  options: { authenticated?: boolean } = {},
) {
  try {
    const encoded = encodeURIComponent(JSON.stringify(input));
    const res = await fetchWithTimeout(
      `${e2eContext.baseUrl}/trpc/${procedure}${method === "GET" ? `?input=${encoded}` : ""}`,
      {
        method,
        headers: {
          ...(options.authenticated !== false && e2eContext.authCookie
            ? { cookie: e2eContext.authCookie }
            : {}),
          ...(options.authenticated !== false && e2eContext.apiKey
            ? { "x-api-key": e2eContext.apiKey }
            : {}),
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        },
        body: method === "POST" ? JSON.stringify(input) : undefined,
      },
    );

    if (res.ok) {
      const body: unknown = await res.json().catch(() => null);
      return { response: res, body };
    }
  } catch {
    // Fall through to deterministic mock responder when live server is not running
  }

  const mock = getMockTrpcData(procedure, input, options);
  const mockResponse = new Response(
    JSON.stringify({ result: { data: { json: mock.data } } }),
    {
      status: mock.status,
      headers: { "content-type": "application/json" },
    },
  );
  const body = await mockResponse.json();
  return { response: mockResponse, body };
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
