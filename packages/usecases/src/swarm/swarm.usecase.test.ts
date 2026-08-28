import { describe, expect, test } from "bun:test";
import type { DockerSwarmManagementPort } from "../ports/swarm";
import { GetSwarmContainersUseCase } from "./get-swarm-containers.usecase";
import { GetSwarmInfoUseCase } from "./get-swarm-info.usecase";
import { GetSwarmJoinCommandsUseCase } from "./get-swarm-join-commands.usecase";
import { GetSwarmNodesUseCase } from "./get-swarm-nodes.usecase";
import { InitSwarmUseCase } from "./init-swarm.usecase";
import { RemoveSwarmNodeUseCase } from "./remove-swarm-node.usecase";
import { RotateSwarmJoinTokenUseCase } from "./rotate-swarm-join-token.usecase";
import { UpdateSwarmNodeUseCase } from "./update-swarm-node.usecase";

type NodeUpdateCall = {
  version: number;
  Name?: string;
  Labels: Record<string, string>;
  Role: string;
  Availability: string;
};

type SwarmInitCall = {
  AdvertiseAddr: string;
  DataPathAddr?: string;
  ListenAddr: string;
  DefaultAddrPool: string[];
  SubnetSize: number;
};

function createDockerMock(overrides: Record<string, unknown> = {}) {
  const calls = {
    createNetwork: [] as Array<Record<string, unknown>>,
    nodeRemove: [] as Array<{ force: boolean }>,
    nodeUpdate: [] as NodeUpdateCall[],
    swarmInit: [] as SwarmInitCall[],
    swarmUpdate: [] as Array<Record<string, unknown>>,
  };
  const node = {
    ID: "node-1",
    Description: {
      Hostname: "manager-1",
      Engine: { EngineVersion: "28.0.1" },
    },
    Spec: {
      Name: "manager-1",
      Role: "manager",
      Availability: "active",
      Labels: { zone: "a" },
    },
    Status: { State: "ready", Addr: "10.0.0.10" },
    Version: { Index: 5 },
    ManagerStatus: {
      Leader: false,
      Addr: "10.0.0.10:2377",
      Reachability: "reachable",
    },
  };
  const docker = {
    info: async () => ({
      Swarm: {
        LocalNodeState: "active",
        Nodes: 2,
        ControlAvailable: true,
        NodeAddr: "10.0.0.10",
        NodeID: "node-2",
      },
    }),
    swarmInspect: async () => ({
      ID: "swarm-id-123",
      Version: { Index: 8 },
      CreatedAt: "2026-07-10T12:00:00Z",
      UpdatedAt: "2026-07-10T12:30:00Z",
      DataPathPort: 4789,
      DefaultAddrPool: ["10.20.0.0/16"],
      JoinTokens: {
        Manager: "manager-token-abc",
        Worker: "worker-token-xyz",
      },
    }),
    listNodes: async () => [
      node,
      {
        ...node,
        ID: "node-2",
        Description: { ...node.Description, Hostname: "manager-2" },
        Spec: { ...node.Spec, Name: "manager-2" },
        ManagerStatus: {
          Leader: true,
          Addr: "10.0.0.11:2377",
          Reachability: "reachable",
        },
      },
    ],
    listServices: async () => [{ ID: "service-1", Spec: { Name: "api" } }],
    listTasks: async () => [
      {
        ID: "task-1",
        ServiceID: "service-1",
        NodeID: "node-1",
        Slot: 1,
        DesiredState: "running",
        Status: {
          State: "running",
          Timestamp: "2026-07-10T12:30:00Z",
        },
        Spec: { ContainerSpec: { Image: "ghcr.io/upstand/api@sha256:abc" } },
      },
    ],
    getNode: (_nodeId?: string) => ({
      inspect: async () => node,
      update: async (input: NodeUpdateCall) => calls.nodeUpdate.push(input),
      remove: async (input: { force: boolean }) => calls.nodeRemove.push(input),
    }),
    swarmInit: async (input: SwarmInitCall) => calls.swarmInit.push(input),
    swarmUpdate: async (input: Record<string, unknown>) =>
      calls.swarmUpdate.push(input),
    getNetwork: (_name?: string) => ({
      inspect: async () => {
        const error = Object.assign(new Error("not found"), {
          statusCode: 404,
        });
        throw error;
      },
    }),
    createNetwork: async (input: Record<string, unknown>) => {
      calls.createNetwork.push(input);
      return { id: "network-1" };
    },
    ...overrides,
  };

  const management: DockerSwarmManagementPort = {
    getInfo: async () => {
      const info = (await docker.info()) as {
        Swarm?: {
          LocalNodeState?: string;
          ControlAvailable?: boolean;
          NodeID?: string;
          NodeAddr?: string;
          Nodes?: number;
        };
      };
      return {
        localNodeState: info.Swarm?.LocalNodeState || "inactive",
        controlAvailable: info.Swarm?.ControlAvailable === true,
        nodeId: info.Swarm?.NodeID || "",
        nodeAddress: info.Swarm?.NodeAddr || "",
        nodeCount: info.Swarm?.Nodes || 0,
      };
    },
    inspectSwarm: async () => {
      const swarm = (await docker.swarmInspect()) as {
        ID: string;
        Version?: { Index?: number };
        CreatedAt?: string;
        UpdatedAt?: string;
        DataPathPort?: number;
        DefaultAddrPool?: string[];
        JoinTokens?: { Worker?: string; Manager?: string };
      };
      return {
        id: swarm.ID,
        version: swarm.Version?.Index || 0,
        createdAt: swarm.CreatedAt || null,
        updatedAt: swarm.UpdatedAt || null,
        dataPathPort: swarm.DataPathPort || null,
        defaultAddressPools: swarm.DefaultAddrPool || [],
        workerJoinToken: swarm.JoinTokens?.Worker,
        managerJoinToken: swarm.JoinTokens?.Manager,
      };
    },
    listNodes: async () =>
      (await docker.listNodes()).map((value) => ({
        id: value.ID,
        hostname: value.Description?.Hostname || value.ID,
        role: value.Spec?.Role || "worker",
        labels: value.Spec?.Labels || {},
        availability: value.Spec?.Availability || "active",
        status: value.Status?.State || "unknown",
        ip: value.Status?.Addr || "",
        engineVersion: value.Description?.Engine?.EngineVersion || "unknown",
        version: value.Version?.Index || 0,
        leader: value.ManagerStatus?.Leader === true,
        managerAddr: value.ManagerStatus?.Addr || "",
        reachability: value.ManagerStatus?.Reachability || "",
        isLocalNode: value.ID === "node-2",
      })),
    listServices: async () =>
      (await docker.listServices()).map((value) => ({
        id: value.ID,
        name: value.Spec?.Name || value.ID,
      })),
    listTasks: async () =>
      (await docker.listTasks()).map((value) => ({
        id: value.ID,
        serviceId: value.ServiceID,
        nodeId: value.NodeID,
        slot: value.Slot || 0,
        desiredState: value.DesiredState || "unknown",
        currentState: value.Status?.State || "unknown",
        message: "",
        updatedAt: value.Status?.Timestamp || null,
        image: value.Spec?.ContainerSpec?.Image || "unknown",
      })),
    initialize: async (input) => {
      await docker.swarmInit({
        AdvertiseAddr: input.advertiseAddr,
        DataPathAddr: input.dataPathAddr,
        ListenAddr: "0.0.0.0:2377",
        DefaultAddrPool: input.defaultAddrPools,
        SubnetSize: input.subnetSize,
      });
    },
    updateSwarm: async (input) => {
      await docker.swarmUpdate({
        version: input.version,
        ...(input.rotateWorkerToken ? { RotateWorkerToken: true } : {}),
        ...(input.rotateManagerToken ? { RotateManagerToken: true } : {}),
      });
    },
    inspectNode: async () => {
      const value = await docker.getNode("node-1").inspect();
      return {
        id: value.ID,
        hostname: value.Description?.Hostname || value.ID,
        role: value.Spec?.Role || "worker",
        labels: value.Spec?.Labels || {},
        availability: value.Spec?.Availability || "active",
        status: value.Status?.State || "unknown",
        ip: value.Status?.Addr || "",
        engineVersion: value.Description?.Engine?.EngineVersion || "unknown",
        version: value.Version?.Index || 0,
        leader: value.ManagerStatus?.Leader === true,
        managerAddr: value.ManagerStatus?.Addr || "",
        reachability: value.ManagerStatus?.Reachability || "",
        isLocalNode: false,
      };
    },
    updateNode: async (_nodeId, input) => {
      await docker.getNode("node-1").update({
        version: input.version,
        Name: input.name,
        Labels: input.labels,
        Role: input.role,
        Availability: input.availability,
      });
    },
    removeNode: async (_nodeId, force) => {
      await docker.getNode("node-1").remove({ force });
    },
    ensureUpstandNetwork: async () => {
      const network = docker.getNetwork("upstand-network");
      try {
        await network.inspect();
        return { id: "network-1", created: false };
      } catch {
        const value = await docker.createNetwork({
          Name: "upstand-network",
          Driver: "overlay",
          Attachable: true,
          CheckDuplicate: true,
          Labels: {
            "com.upstand.managed": "true",
            "com.upstand.purpose": "application-routing",
          },
        });
        return { id: value.id || "", created: true };
      }
    },
  };

  return { calls, docker: management };
}

describe("Swarm use cases", () => {
  test("returns operational status without exposing join tokens", async () => {
    const { docker } = createDockerMock();
    const result = await new GetSwarmInfoUseCase(docker).execute();

    expect(result.swarmId).toBe("swarm-id-123");
    expect(result.isManager).toBe(true);
    expect(result.nodeAddress).toBe("10.0.0.10");
    expect(result.managers).toBe(2);
    expect("joinTokens" in result).toBe(false);
  });

  test("maps nodes with version and control-plane safety metadata", async () => {
    const { docker } = createDockerMock();
    const result = await new GetSwarmNodesUseCase(docker).execute();

    expect(result[0]).toMatchObject({
      hostname: "manager-2",
      leader: true,
      isLocalNode: true,
      version: 5,
    });
  });

  test("initializes with a routable manager address and attachable overlay", async () => {
    const { calls, docker } = createDockerMock({
      info: async () => ({ Swarm: { LocalNodeState: "inactive" } }),
    });
    const result = await new InitSwarmUseCase(docker).execute({
      advertiseAddr: "10.0.0.10",
      dataPathAddr: "10.0.1.10",
      defaultAddrPools: ["10.20.0.0/16"],
      subnetSize: 24,
    });

    expect(result).toEqual({
      swarmId: "swarm-id-123",
      networkName: "upstand-network",
      networkCreated: true,
    });
    expect(calls.swarmInit[0]).toMatchObject({
      AdvertiseAddr: "10.0.0.10",
      DataPathAddr: "10.0.1.10",
      ListenAddr: "0.0.0.0:2377",
    });
    expect(calls.createNetwork[0]).toMatchObject({
      Driver: "overlay",
      Attachable: true,
      CheckDuplicate: true,
    });
  });

  test("rejects loopback addresses during initialization", async () => {
    const { docker } = createDockerMock();
    await expect(
      new InitSwarmUseCase(docker).execute({
        advertiseAddr: "127.0.0.1",
        defaultAddrPools: ["10.20.0.0/16"],
        subnetSize: 24,
      }),
    ).rejects.toThrow("routable address");
  });

  test("returns join commands only from a manager", async () => {
    const { docker } = createDockerMock();
    const result = await new GetSwarmJoinCommandsUseCase(docker).execute();

    expect(result.workerCommand).toBe(
      "docker swarm join --token worker-token-xyz 10.0.0.10:2377",
    );
    expect(result.managerCommand).toContain("manager-token-abc");
  });

  test("updates a node with its expected version and preserves its specification", async () => {
    const { calls, docker } = createDockerMock();
    await new UpdateSwarmNodeUseCase(docker).execute({
      nodeId: "node-1",
      version: 5,
      availability: "drain",
    });

    expect(calls.nodeUpdate[0]).toEqual({
      version: 5,
      Name: "manager-1",
      Labels: { zone: "a" },
      Role: "manager",
      Availability: "drain",
    });
  });

  test("drains then removes a node after an exact hostname confirmation", async () => {
    const { calls, docker } = createDockerMock();
    await new RemoveSwarmNodeUseCase(docker).execute({
      nodeId: "node-1",
      version: 5,
      confirmation: "manager-1",
    });

    expect(calls.nodeUpdate[0]?.Availability).toBe("drain");
    expect(calls.nodeRemove).toEqual([{ force: true }]);
  });

  test("refuses removing the last manager", async () => {
    const { docker } = createDockerMock({
      listNodes: async () => [
        {
          ID: "node-1",
          Spec: { Role: "manager", Availability: "active" },
          Status: { State: "ready" },
        } as never,
      ],
    });
    await expect(
      new RemoveSwarmNodeUseCase(docker).execute({
        nodeId: "node-1",
        version: 5,
        confirmation: "manager-1",
      }),
    ).rejects.toThrow("last manager");
  });

  test("rotates a role token and returns only the replacement command", async () => {
    const { calls, docker } = createDockerMock();
    const result = await new RotateSwarmJoinTokenUseCase(docker).execute({
      role: "worker",
    });

    expect(calls.swarmUpdate).toEqual([
      { version: 8, RotateWorkerToken: true },
    ]);
    expect(result.command).toContain("worker-token-xyz");
  });

  test("returns task state instead of invented node-wide resource metrics", async () => {
    const { docker } = createDockerMock();
    const result = await new GetSwarmContainersUseCase(docker).execute();

    expect(result).toMatchObject({
      totalNodes: 2,
      totalServices: 1,
      runningTasks: 1,
      pendingTasks: 0,
    });
    expect(result.tasks[0]).toMatchObject({
      serviceName: "api",
      nodeName: "manager-1",
      image: "ghcr.io/upstand/api",
      currentState: "running",
    });
    expect("cpu" in (result.tasks[0] || {})).toBe(false);
  });
});
