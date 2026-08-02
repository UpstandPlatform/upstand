import { describe, expect, test } from "bun:test";
import type { IUnitOfWork, Server } from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import type {
  ServerProvisioningPort,
  ServerProvisioningSession,
} from "../ports/server-provisioning";
import { SetupServerUseCase } from "./setup-server.usecase";

interface MockSessionState {
  commandsExecuted: string[];
  caddyInitialized: boolean;
  monitoringInitialized: boolean;
  dockerInstalled: boolean;
  swarmInitialized: boolean;
  closed: boolean;
}

function createMockProvisioningPort(
  options: {
    sudoAllowed?: boolean;
    dockerPresent?: boolean;
    swarmFail?: boolean;
    sshFail?: boolean;
    monitoringBuildFail?: boolean;
  } = {},
): {
  port: ServerProvisioningPort;
  state: MockSessionState;
} {
  const state: MockSessionState = {
    commandsExecuted: [],
    caddyInitialized: false,
    monitoringInitialized: false,
    dockerInstalled: options.dockerPresent ?? true,
    swarmInitialized: false,
    closed: false,
  };

  const port: ServerProvisioningPort = {
    connect: async () => {
      if (options.sshFail) {
        throw new Error("SSH Connection timed out");
      }

      const session: ServerProvisioningSession = {
        execute: async (cmd: string) => {
          state.commandsExecuted.push(cmd);

          if (cmd.includes("id -u") || cmd.includes("sudo -n true")) {
            if (options.sudoAllowed === false) {
              return {
                code: 1,
                stdout: "",
                stderr: "sudo: a password is required",
              };
            }
            return { code: 0, stdout: "", stderr: "" };
          }

          if (cmd === "docker --version") {
            if (!state.dockerInstalled) {
              return {
                code: 127,
                stdout: "",
                stderr: "command not found: docker",
              };
            }
            return { code: 0, stdout: "Docker version 27.0.3", stderr: "" };
          }

          if (cmd.includes("stat -c '%g' /var/run/docker.sock")) {
            return { code: 0, stdout: "998\n", stderr: "" };
          }

          if (cmd.includes("docker swarm init")) {
            if (options.swarmFail) {
              return {
                code: 1,
                stdout: "",
                stderr: "Error: swarm init failed",
              };
            }
            state.swarmInitialized = true;
            return { code: 0, stdout: "Swarm initialized", stderr: "" };
          }

          if (
            cmd.includes("docker pull") ||
            cmd.includes("docker run") ||
            cmd.includes("docker network")
          ) {
            return { code: 0, stdout: "ok", stderr: "" };
          }

          if (cmd.includes("docker build") && options.monitoringBuildFail) {
            return {
              code: 1,
              stdout: "",
              stderr: "Error: monitoring image build failed",
            };
          }

          return { code: 0, stdout: "", stderr: "" };
        },
        upload: async () => {},
        dockerInfo: async () => ({
          Swarm: {
            LocalNodeState: state.swarmInitialized ? "active" : "inactive",
          },
        }),
        initializeCaddy: async () => {
          state.caddyInitialized = true;
        },
        close: async () => {
          state.closed = true;
        },
      };

      return session;
    },
  };

  return { port, state };
}

function createTestUow(serverOverwrites: Partial<Server> = {}) {
  const server: Server = {
    id: "server-1",
    organizationId: "org-1",
    name: "Test Deploy Server",
    serverType: "deploy",
    authType: "ssh_key",
    sshKeyId: "key-1",
    sshHostKeyFingerprint: "SHA256:testfingerprint123",
    ipAddress: "192.168.1.100",
    port: 22,
    username: "root",
    enableDockerCleanup: false,
    status: "idle",
    setupError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...serverOverwrites,
  };

  const encryptedKey = encryptSecret(
    "-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----",
  );

  const sshKey = {
    id: "key-1",
    organizationId: "org-1",
    name: "Default Key",
    publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...",
    privateKeyCiphertext: encryptedKey.ciphertext,
    privateKeyIv: encryptedKey.iv,
    privateKeyAuthTag: encryptedKey.authTag,
    privateKeyVersion: encryptedKey.keyVersion,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const uow = {
    serverRepository: {
      findById: async (id: string) => (id === server.id ? server : null),
      updateById: async (_id: string, patch: Partial<Server>) => {
        Object.assign(server, patch);
        return server;
      },
    },
    sshKeyRepository: {
      findById: async (id: string) => (id === sshKey.id ? sshKey : null),
    },
    webServerSettingsRepository: {
      findGlobal: async () => ({ enableHttp3: true }),
    },
    monitoringSettingsRepository: {
      findByServerId: async () => ({
        id: "mon-1",
        serverId: server.id,
        token: "test-monitoring-token",
        cpuThreshold: 90,
        memoryThreshold: 90,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      upsert: async (data: Record<string, unknown>) => data,
    },
  } as unknown as IUnitOfWork;

  return { uow, server };
}

describe("SetupServerUseCase pipeline tests", () => {
  test("provisions a 'deploy' server with Swarm, Caddy, and Monitoring", async () => {
    const { uow, server } = createTestUow({ serverType: "deploy" });
    const { port, state } = createMockProvisioningPort();

    const useCase = new SetupServerUseCase(uow, port);
    const result = await useCase.execute({ id: server.id });

    expect(result.success).toBe(true);
    expect(server.status).toBe("ready");
    expect(server.setupError).toBeNull();
    expect(state.swarmInitialized).toBe(true);
    expect(state.caddyInitialized).toBe(true);
    expect(state.closed).toBe(true);
  });

  test("provisions a 'database' server with Swarm and Monitoring but NO Caddy", async () => {
    const { uow, server } = createTestUow({ serverType: "database" });
    const { port, state } = createMockProvisioningPort();

    const useCase = new SetupServerUseCase(uow, port);
    const result = await useCase.execute({ id: server.id });

    expect(result.success).toBe(true);
    expect(server.status).toBe("ready");
    expect(state.swarmInitialized).toBe(true);
    expect(state.caddyInitialized).toBe(false);
  });

  test("provisions a 'build' server with Docker and Monitoring but NO Swarm or Caddy", async () => {
    const { uow, server } = createTestUow({ serverType: "build" });
    const { port, state } = createMockProvisioningPort();

    const useCase = new SetupServerUseCase(uow, port);
    const result = await useCase.execute({ id: server.id });

    expect(result.success).toBe(true);
    expect(server.status).toBe("ready");
    expect(state.swarmInitialized).toBe(false);
    expect(state.caddyInitialized).toBe(false);
  });

  test("fails setup and records setupError when SSH fingerprint is untrusted", async () => {
    const { uow, server } = createTestUow({ sshHostKeyFingerprint: null });
    const { port } = createMockProvisioningPort();

    const useCase = new SetupServerUseCase(uow, port);
    await expect(useCase.execute({ id: server.id })).rejects.toThrow(
      "Trust the server SSH host key before provisioning it",
    );
  });

  test("fails setup and updates status to 'failed' when sudo fails", async () => {
    const { uow, server } = createTestUow();
    const { port } = createMockProvisioningPort({ sudoAllowed: false });

    const useCase = new SetupServerUseCase(uow, port);
    await expect(useCase.execute({ id: server.id })).rejects.toThrow(
      "The SSH user is not root and does not have passwordless sudo access.",
    );

    expect(server.status).toBe("failed");
    expect(server.setupError).toContain("passwordless sudo access");
  });

  test("fails setup and updates status to 'failed' when Swarm init fails", async () => {
    const { uow, server } = createTestUow({ serverType: "deploy" });
    const { port } = createMockProvisioningPort({ swarmFail: true });

    const useCase = new SetupServerUseCase(uow, port);
    await expect(useCase.execute({ id: server.id })).rejects.toThrow(
      "Command failed with code 1",
    );

    expect(server.status).toBe("failed");
    expect(server.setupError).toBeDefined();
  });

  test("cleans monitoring source artifacts when the remote image build fails", async () => {
    const { uow, server } = createTestUow({ serverType: "deploy" });
    const { port, state } = createMockProvisioningPort({
      monitoringBuildFail: true,
    });

    const useCase = new SetupServerUseCase(uow, port);
    await expect(useCase.execute({ id: server.id })).rejects.toThrow(
      "monitoring image build failed",
    );

    expect(
      state.commandsExecuted.some(
        (command) =>
          command.includes("rm -rf '/tmp/monitoring-") &&
          command.includes("'/tmp/monitoring-src-server-1'"),
      ),
    ).toBe(true);
  });
});
