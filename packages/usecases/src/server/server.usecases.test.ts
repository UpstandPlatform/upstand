import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { CreateServerInputSchema } from "./create-server.usecase";
import { DeleteServerUseCase } from "./delete-server.usecase";
import { GetServerUseCase } from "./get-server.usecase";
import { GetServerCountUseCase } from "./get-server-count.usecase";
import { ScanServerHostKeyInputSchema } from "./scan-server-host-key.usecase";
import {
  assertBuildServerSupportsResource,
  assertDeploymentServerSupportsResource,
  getServerProvisioningPlan,
} from "./server-role";
import { buildDockerInstallCommand } from "./setup-server.usecase";
import { UpdateServerUseCase } from "./update-server.usecase";

interface TestServer {
  id: string;
  organizationId?: string;
  name?: string;
  description?: string | null;
  serverType?: string;
  sshKeyId?: string | null;
  ipAddress?: string;
  port?: number;
  username?: string;
  enableDockerCleanup?: boolean;
  status?: string;
  setupError?: string | null;
}

interface TestResource {
  id: string;
  serverId: string | null;
  name?: string;
  type?: string;
  buildServerId?: string | null;
}

function createUow() {
  const servers = new Map<string, TestServer>([
    [
      "server-1",
      {
        id: "server-1",
        organizationId: "org-1",
        name: "Primary",
        description: null,
        serverType: "deploy",
        sshKeyId: "key-1",
        ipAddress: "203.0.113.10",
        port: 22,
        username: "root",
        enableDockerCleanup: false,
        status: "ready",
        setupError: null,
      },
    ],
  ]);
  const resources = new Map<string, TestResource>();
  const uow = {
    serverRepository: {
      findById: async (id: string) => servers.get(id) ?? null,
      findByOrganizationId: async (organizationId: string) =>
        [...servers.values()].filter(
          (server) => server.organizationId === organizationId,
        ),
      updateById: async (id: string, patch: Record<string, unknown>) => {
        const server = servers.get(id);
        if (!server) return null;
        Object.assign(server, patch);
        return server;
      },
      deleteById: async (id: string) => servers.delete(id),
    },
    resourceRepository: {
      findMany: async () => [...resources.values()],
      findByServerId: async (serverId: string) =>
        [...resources.values()].filter(
          (res) => res.serverId === serverId || res.buildServerId === serverId,
        ),
    },
  } as unknown as IUnitOfWork;
  return { uow, servers, resources };
}

describe("server use cases", () => {
  test("builds a verified Docker repository installer", () => {
    const command = buildDockerInstallCommand(
      "sudo",
      "5:29.6.1-1~ubuntu.24.04~noble",
    );

    expect(command).toContain(
      "https://download.docker.com/linux/$docker_repo/gpg",
    );
    expect(command).toContain("Docker repository key fingerprint mismatch");
    expect(command).toContain("docker-ce='5:29.6.1-1~ubuntu.24.04~noble'");
    expect(command).not.toContain("get.docker.com | sudo sh");
  });

  test("accepts only the supported server roles", () => {
    expect(
      CreateServerInputSchema.safeParse({
        organizationId: "org-1",
        name: "Build host",
        serverType: "unsupported",
        ipAddress: "203.0.113.10",
      }).success,
    ).toBeFalse();
  });

  test("rejects unsafe SSH host and username values", () => {
    expect(
      CreateServerInputSchema.safeParse({
        organizationId: "org-1",
        name: "Host",
        serverType: "deploy",
        ipAddress: "203.0.113.10\nProxyCommand id",
        username: "root\nProxyCommand id",
      }).success,
    ).toBeFalse();
  });

  test("requires an organization when scanning an SSH host key", () => {
    expect(
      ScanServerHostKeyInputSchema.safeParse({
        ipAddress: "203.0.113.10",
        port: 22,
      }).success,
    ).toBeFalse();
  });

  test("keeps deployment and build server capabilities distinct", () => {
    const buildServer = { name: "Builder", serverType: "build" } as never;
    const databaseServer = {
      name: "Database host",
      serverType: "database",
    } as never;

    expect(() =>
      assertDeploymentServerSupportsResource(buildServer, "application"),
    ).toThrow("cannot host deployments");
    expect(() =>
      assertDeploymentServerSupportsResource(databaseServer, "compose"),
    ).toThrow("can only host database resources");
    expect(() =>
      assertBuildServerSupportsResource(databaseServer, "application"),
    ).toThrow("cannot build applications");
  });

  test("provisions each server role with only its required host services", () => {
    expect(getServerProvisioningPlan("deploy")).toEqual({
      requiresSwarm: true,
      requiresCaddy: true,
      requiresMonitoring: true,
    });
    expect(getServerProvisioningPlan("build")).toEqual({
      requiresSwarm: false,
      requiresCaddy: false,
      requiresMonitoring: true,
    });
    expect(getServerProvisioningPlan("database")).toEqual({
      requiresSwarm: true,
      requiresCaddy: false,
      requiresMonitoring: true,
    });
  });

  test("does not expose a server across organizations", async () => {
    const { uow } = createUow();
    await expect(
      new GetServerUseCase(uow).execute({
        organizationId: "org-2",
        id: "server-1",
      }),
    ).rejects.toThrow("Server not found");
  });

  test("counts only servers in the requested organization", async () => {
    const { uow, servers } = createUow();
    servers.set("server-2", { ...servers.get("server-1"), id: "server-2" });
    servers.set("server-3", {
      ...servers.get("server-1"),
      id: "server-3",
      organizationId: "org-2",
    });

    expect(
      await new GetServerCountUseCase(uow).execute({
        organizationId: "org-1",
      }),
    ).toBe(2);
  });

  test("resets readiness after connection metadata changes", async () => {
    const { uow, servers } = createUow();
    const updated = await new UpdateServerUseCase(uow).execute({
      organizationId: "org-1",
      id: "server-1",
      ipAddress: "203.0.113.20",
      port: 2222,
    });

    expect(updated.ipAddress).toBe("203.0.113.20");
    expect(updated.port).toBe(2222);
    expect(updated.status).toBe("idle");
    expect(updated.setupError).toBeNull();
    expect(servers.get("server-1")).toBe(updated);
  });

  test("resets readiness when a role change requires reprovisioning", async () => {
    const { uow } = createUow();
    const updated = await new UpdateServerUseCase(uow).execute({
      organizationId: "org-1",
      id: "server-1",
      serverType: "database",
    });

    expect(updated.serverType).toBe("database");
    expect(updated.status).toBe("idle");
  });

  test("prevents a role change that would invalidate existing assignments", async () => {
    const { uow, resources } = createUow();
    resources.set("resource-1", {
      id: "resource-1",
      name: "Frontend",
      type: "application",
      serverId: "server-1",
      buildServerId: null,
    });

    await expect(
      new UpdateServerUseCase(uow).execute({
        organizationId: "org-1",
        id: "server-1",
        serverType: "database",
      }),
    ).rejects.toThrow("Cannot change this server");
  });

  test("validates credential requirements for ssh_key vs password authType", () => {
    expect(
      CreateServerInputSchema.safeParse({
        organizationId: "org-1",
        name: "SSH Server",
        serverType: "deploy",
        authType: "ssh_key",
        ipAddress: "203.0.113.10",
      }).success,
    ).toBeFalse();

    expect(
      CreateServerInputSchema.safeParse({
        organizationId: "org-1",
        name: "Password Server",
        serverType: "deploy",
        authType: "password",
        ipAddress: "203.0.113.10",
      }).success,
    ).toBeFalse();

    expect(
      CreateServerInputSchema.safeParse({
        organizationId: "org-1",
        name: "Valid Password Server",
        serverType: "deploy",
        authType: "password",
        password: "secret-password-123",
        ipAddress: "203.0.113.10",
      }).success,
    ).toBeTrue();
  });

  test("prevents deleting a server while it is assigned to a resource", async () => {
    const { uow, resources } = createUow();
    resources.set("resource-1", {
      id: "resource-1",
      name: "Frontend",
      type: "application",
      serverId: null,
      buildServerId: "server-1",
    });

    await expect(
      new DeleteServerUseCase(uow).execute({ id: "server-1" }),
    ).rejects.toThrow("Reassign those resources before deleting the server");
  });
});
