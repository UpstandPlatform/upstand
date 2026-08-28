import { describe, expect, mock, test } from "bun:test";
import type { Resource } from "@upstand/domain";
import { DockerService } from "./docker.service";

describe("Convergence Verification & Automated Rollback Engine", () => {
  const sampleResource: Resource = {
    id: "res-app-1",
    environmentId: "env-1",
    serverId: "local",
    buildServerId: null,
    name: "Web Application",
    appName: "web-app",
    type: "application",
    provider: "git",
    credentials: "{}",
    envVars: "{}",
    buildConfig: "{}",
    domains: JSON.stringify([
      { host: "app.example.com", path: "/", port: 3000, https: false },
    ]),
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  test("waitForServiceConvergence returns healthy when tasks are running stably", async () => {
    const mockListTasks = mock(async () => [
      {
        ID: "task-1",
        Status: {
          State: "running",
          ContainerStatus: { ContainerID: "c-1" },
        },
      },
    ]);

    const mockInspectContainer = mock(async () => ({
      State: {
        Health: { Status: "healthy" },
      },
    }));

    const mockGetContainer = mock(() => ({
      inspect: mockInspectContainer,
    }));

    const mockDocker = {
      listTasks: mockListTasks,
      getContainer: mockGetContainer,
    } as never;

    const service = new DockerService(mockDocker);
    const logs: string[] = [];

    const result = await service.waitForServiceConvergence(sampleResource, {
      timeoutSeconds: 5,
      stabilityWindowSeconds: 1,
      onLog: (msg) => logs.push(msg),
    });

    expect(result.healthy).toBe(true);
    expect(result.state).toBe("healthy");
    expect(logs.join("")).toContain("Container health check passed healthy");
  });

  test("waitForServiceConvergence detects task crash loops and returns failed status", async () => {
    const mockListTasks = mock(async () => [
      {
        ID: "task-failed",
        DesiredState: "running",
        Status: {
          State: "failed",
          Err: "task: non-zero exit (1)",
        },
      },
    ]);

    const mockDocker = {
      listTasks: mockListTasks,
    } as never;

    const service = new DockerService(mockDocker);
    const logs: string[] = [];

    const result = await service.waitForServiceConvergence(sampleResource, {
      timeoutSeconds: 5,
      stabilityWindowSeconds: 1,
      onLog: (msg) => logs.push(msg),
    });

    expect(result.healthy).toBe(false);
    expect(result.state).toBe("failed");
    expect(result.message).toContain("Task crash loop detected");
  });

  test("waitForServiceConvergence detects unhealthy container health checks", async () => {
    const mockListTasks = mock(async () => [
      {
        ID: "task-1",
        Status: {
          State: "running",
          ContainerStatus: { ContainerID: "c-unhealthy" },
        },
      },
    ]);

    const mockInspectContainer = mock(async () => ({
      State: {
        Health: { Status: "unhealthy" },
      },
    }));

    const mockDocker = {
      listTasks: mockListTasks,
      getContainer: () => ({ inspect: mockInspectContainer }),
    } as never;

    const service = new DockerService(mockDocker);
    const logs: string[] = [];

    const result = await service.waitForServiceConvergence(sampleResource, {
      timeoutSeconds: 5,
      stabilityWindowSeconds: 1,
      onLog: (msg) => logs.push(msg),
    });

    expect(result.healthy).toBe(false);
    expect(result.state).toBe("unhealthy");
  });

  test("uses the typed broker for local resource convergence", async () => {
    const inspectResourceConvergence = mock(async () => ({
      tasks: [
        {
          state: "running",
          desiredState: "running",
          containerId: "c-typed",
          health: "healthy",
        },
      ],
    }));
    const mockListTasks = mock(async () => {
      throw new Error("raw task discovery must not be used");
    });
    const broker = {
      execContainerCommand: mock(),
      execResourceServiceCommand: mock(),
      inspectResourceConvergence,
    } as unknown as import("./docker-broker-client").DockerResourceCommandBrokerPort;
    const service = new DockerService(
      { listTasks: mockListTasks } as never,
      {},
      broker,
    );

    const result = await service.waitForServiceConvergence(sampleResource, {
      timeoutSeconds: 1,
      stabilityWindowSeconds: 0,
    });

    expect(result.healthy).toBe(true);
    expect(inspectResourceConvergence).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "res-app-1",
      "web-app",
    );
    expect(mockListTasks).not.toHaveBeenCalled();
  });

  test("transferImage streams docker image from build node to target server", async () => {
    const mockGetStream = mock(async () => "image-stream" as never);
    const mockLoadImage = mock(async () => {});

    const sourceDocker = {
      getImage: () => ({ get: mockGetStream }),
    } as never;

    const targetDocker = {
      loadImage: mockLoadImage,
    } as never;

    const service = new DockerService(sourceDocker);
    const logs: string[] = [];

    await service.transferImage(
      "upstand-app-test:latest",
      targetDocker,
      (msg) => logs.push(msg),
    );

    expect(mockGetStream).toHaveBeenCalled();
    expect(mockLoadImage).toHaveBeenCalled();
    expect(logs.join("")).toContain("transferred successfully");
  });
});
