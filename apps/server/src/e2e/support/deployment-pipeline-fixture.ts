import path from "node:path";
import type {
  Deployment,
  Environment,
  IUnitOfWork,
  Project,
  Resource,
  Server,
} from "@upstand/domain";
import { parseDomainMappings } from "@upstand/domain";
import { generateCaddyfileContent } from "@upstand/infrastructure/caddy/caddy.service";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import {
  type CaddyResource,
  type CaddyServicePort,
  type ControlPlaneMode,
  CreateEnvironmentUseCase,
  CreateProjectUseCase,
  CreateResourceUseCase,
  CreateServerUseCase,
  DeploymentWorker,
  type DeployOutboxPayload,
  type DockerApiTarget,
  type DockerDeploymentPort,
  detectBuildConfig,
  QueueDeploymentUseCase,
  type ResolvedBuildArtifact,
  RollbackResourceUseCase,
  UpdateResourceUseCase,
} from "@upstand/usecases";

const nodeFixturePath = path.resolve(
  import.meta.dir,
  "../../../../../fixtures/deploy/node",
);

type FixtureServerState = {
  services: Map<string, { kind: string; image: string | null; status: string }>;
  generatedCaddyConfig: string;
};

export type DeploymentFixtureResult = {
  project: Project;
  environment: Environment;
  applicationServer: Server;
  databaseServer: Server;
  application: Resource;
  compose: Resource;
  database: Resource;
  deployments: Map<string, Deployment>;
  outbox: Map<string, Record<string, unknown>>;
  schedules: Map<string, Record<string, unknown>>;
  serverStates: Map<string, FixtureServerState>;
  buildLocations: string[];
  notifications: Record<string, unknown>[];
  runDeployment(
    resourceId: string,
    deploymentId: string,
    revision: string,
  ): Promise<void>;
  rollbackApplication(): Promise<Resource>;
};

function createFixtureUow() {
  const projects = new Map<string, Project>();
  const environments = new Map<string, Environment>();
  const servers = new Map<string, Server>();
  const resources = new Map<string, Resource>();
  const deployments = new Map<string, Deployment>();
  const outbox = new Map<string, Record<string, unknown>>();
  const schedules = new Map<string, Record<string, unknown>>();
  const buildSettings = new Map<string, Record<string, unknown>>();
  const sshKey = encryptSecret("fixture-private-key");
  const sshKeys = new Map([
    [
      "fixture-ssh-key",
      {
        id: "fixture-ssh-key",
        organizationId: "org-fixture",
        name: "Fixture key",
        publicKey: "ssh-ed25519 fixture",
        privateKeyCiphertext: sshKey.ciphertext,
        privateKeyIv: sshKey.iv,
        privateKeyAuthTag: sshKey.authTag,
        privateKeyVersion: sshKey.keyVersion,
      },
    ],
  ]);

  const uow = {
    transaction: async <T>(work: (tx: IUnitOfWork) => Promise<T>) =>
      work(uow as unknown as IUnitOfWork),
    projectRepository: {
      create: async (data: Partial<Project>) => {
        const project = {
          ...data,
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Project;
        projects.set(project.id, project);
        return project;
      },
      findById: async (id: string) => projects.get(id) ?? null,
    },
    environmentRepository: {
      create: async (data: Partial<Environment>) => {
        const environment = {
          envVars: "{}",
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as Environment;
        environments.set(environment.id, environment);
        return environment;
      },
      findById: async (id: string) => environments.get(id) ?? null,
      incrementResourceCount: async (id: string, delta: number) => {
        const environment = environments.get(id);
        if (!environment) return null;
        environment.resourceCount = (environment.resourceCount ?? 0) + delta;
        return environment;
      },
    },
    serverRepository: {
      create: async (data: Partial<Server>) => {
        const server = {
          setupError: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as Server;
        servers.set(server.id, server);
        return server;
      },
      findById: async (id: string) => servers.get(id) ?? null,
      updateById: async (id: string, patch: Partial<Server>) => {
        const server = servers.get(id);
        if (!server) return null;
        Object.assign(server, patch, { updatedAt: new Date() });
        return server;
      },
    },
    sshKeyRepository: {
      findById: async (id: string) => sshKeys.get(id) ?? null,
    },
    serverBuildSettingsRepository: {
      findById: async (id: string) => buildSettings.get(id) ?? null,
      createIfNotExists: async (data: Record<string, unknown>) => {
        const current = buildSettings.get(String(data.id));
        if (current) return current;
        buildSettings.set(String(data.id), data);
        return data;
      },
    },
    resourceRepository: {
      create: async (data: Partial<Resource>) => {
        const resource = {
          status: "idle",
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as Resource;
        resources.set(resource.id, resource);
        return resource;
      },
      findById: async (id: string) => resources.get(id) ?? null,
      findMany: async () => [...resources.values()],
      checkDuplicateServiceKey: async (appName: string, exceptId?: string) =>
        [...resources.values()].find(
          (resource) =>
            resource.id !== exceptId && resource.appName === appName,
        ) ?? null,
      updateById: async (id: string, patch: Partial<Resource>) => {
        const resource = resources.get(id);
        if (!resource) return null;
        Object.assign(resource, patch, { updatedAt: new Date() });
        return resource;
      },
      updateByIdIfUpdatedAt: async (
        id: string,
        expectedUpdatedAt: Date,
        patch: Partial<Resource>,
      ) => {
        const resource = resources.get(id);
        if (
          !resource ||
          resource.updatedAt?.getTime() !== expectedUpdatedAt.getTime()
        ) {
          return null;
        }
        Object.assign(resource, patch, { updatedAt: new Date() });
        return resource;
      },
    },
    deploymentRepository: {
      create: async (data: Partial<Deployment>) => {
        const deployment = {
          attempt: 0,
          maxAttempts: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as Deployment;
        deployments.set(deployment.id, deployment);
        return deployment;
      },
      findById: async (id: string) => deployments.get(id) ?? null,
      findByResourceId: async (resourceId: string) =>
        [...deployments.values()].filter(
          (item) => item.resourceId === resourceId,
        ),
      updateById: async (id: string, patch: Partial<Deployment>) => {
        const deployment = deployments.get(id);
        if (!deployment) return null;
        Object.assign(deployment, patch, { updatedAt: new Date() });
        return deployment;
      },
      setPlanIfAbsent: async (
        id: string,
        plan: Deployment["deploymentPlan"],
      ) => {
        const deployment = deployments.get(id);
        if (!deployment || deployment.deploymentPlan) return false;
        deployment.deploymentPlan = plan;
        return true;
      },
    },
    outboxRepository: {
      create: async (data: Record<string, unknown>) => {
        outbox.set(String(data.id), data);
        return data;
      },
    },
    scheduleRepository: {
      findByResourceId: async (resourceId: string) =>
        [...schedules.values()].filter(
          (item) => item.resourceId === resourceId,
        ),
      create: async (data: Record<string, unknown>) => {
        schedules.set(String(data.id), data);
        return data;
      },
      updateById: async (id: string, patch: Record<string, unknown>) => {
        const schedule = schedules.get(id);
        if (!schedule) return null;
        Object.assign(schedule, patch);
        return schedule;
      },
      deleteById: async (id: string) => schedules.delete(id),
    },
    dockerRegistryRepository: {
      findById: async () => null,
      findByOrganizationId: async () => [],
    },
    gitProviderRepository: {
      findById: async () => null,
    },
    webServerSettingsRepository: {
      findGlobal: async () => null,
    },
    previewDeploymentRepository: {
      findMany: async () => [],
    },
    certificateRepository: {
      findAll: async () => [],
    },
  } as unknown as IUnitOfWork;

  return {
    uow,
    projects,
    environments,
    servers,
    resources,
    deployments,
    outbox,
    schedules,
  };
}

function createCaddyService(state: FixtureServerState): CaddyServicePort {
  return {
    initializeCaddy: async () => {},
    syncResourceConfigs: async (resources: CaddyResource[]) => {
      const routes = resources.flatMap((resource) =>
        parseDomainMappings(resource.domains ?? "[]").map(
          (mapping) =>
            `${mapping.host} -> ${mapping.serviceName ?? resource.appName}:${mapping.port}`,
        ),
      );
      state.generatedCaddyConfig = generateCaddyfileContent({}, resources);
      return { success: true, domains: routes, changed: true };
    },
    reloadCaddy: async () => ({ success: true }),
    getStatus: async () => ({
      running: true,
      status: "running",
      uptime: "fixture",
      ports: [],
      activeDomainsCount: 0,
      activeDomains: [],
      mainCaddyfile: state.generatedCaddyConfig,
    }),
    getLogs: async () => "",
    getAccessLogs: async () => "",
    cleanupAccessLogs: async () => {},
    setControlPlaneIpAccess: async () => {},
    restartCaddy: async () => ({ success: true }),
  };
}

function createDockerService(
  serverStates: Map<string, FixtureServerState>,
  buildLocations: string[],
): DockerDeploymentPort {
  const stateFor = (resource: Resource) => {
    const state = serverStates.get(resource.serverId ?? "");
    if (!state)
      throw new Error(`Missing fixture server state for ${resource.serverId}`);
    return state;
  };

  return {
    sanitizeName: (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    setCancellationKey: () => {},
    deployAppImage: async () => {
      throw new Error("Fixture does not model prebuilt-image deployment");
    },
    deployAppGit: async (...args) => {
      const [
        resource,
        ,
        ,
        onLog,
        ,
        ,
        ,
        destination,
        sourceRevision,
        onGitCloned,
        ,
        ,
        ,
        ,
        onBuildResolved,
        ,
        localSourcePath,
      ] = args;
      const sourcePath = localSourcePath ?? nodeFixturePath;
      const syncedResource = await onGitCloned?.(sourcePath);
      const detection = detectBuildConfig(sourcePath);
      if (detection.status !== "detected" || !detection.config) {
        throw new Error(detection.warnings.join(" "));
      }
      buildLocations.push(
        destination ? "control-plane-to-remote" : "control-plane-local",
      );
      onLog(
        `[fixture] detected ${detection.config.type} build configuration\n`,
      );
      const artifact: ResolvedBuildArtifact = {
        buildConfig: detection.config,
        detectorVersion: detection.detectorVersion,
        sourceRevision: sourceRevision ?? "fixture-source-revision",
        configurationVersion: `sha256:${"c".repeat(64)}`,
        digest: `sha256:${"d".repeat(64)}`,
        reference: `ghcr.io/upstand/${resource.appName}:fixture`,
      };
      await onBuildResolved?.(artifact);
      const state = stateFor(syncedResource ?? resource);
      state.services.set(resource.id, {
        kind: "application",
        image: artifact.reference,
        status: "running",
      });
    },
    readComposeFileFromGit: async () => {
      throw new Error("Fixture uses an inline Compose file");
    },
    deployDatabase: async (resource, _environment, onLog) => {
      stateFor(resource).services.set(resource.id, {
        kind: "database",
        image: resource.dockerImage ?? null,
        status: "running",
      });
      onLog?.("[fixture] database deployed\n");
    },
    deployComposeStack: async (resource, composeFile, onLog) => {
      if (!composeFile.includes("services:")) {
        throw new Error("Fixture compose content is invalid");
      }
      stateFor(resource).services.set(resource.id, {
        kind: "compose",
        image: null,
        status: "running",
      });
      onLog("[fixture] compose stack deployed\n");
    },
    waitForServiceConvergence: async (resource) => {
      const service = stateFor(resource).services.get(resource.id);
      if (service) service.status = "running";
      return { healthy: true, state: "ready" };
    },
    runPostDeploySmokeTest: async () => null,
    rollbackService: async (resource) => {
      const service = stateFor(resource).services.get(resource.id);
      if (service) service.status = "rolled-back";
    },
    promoteServiceRevision: async () => {
      throw new Error("Fixture does not model revision promotion");
    },
    removeServiceRevision: async () => {
      throw new Error("Fixture does not model revision cleanup");
    },
    transferImage: async () => {
      throw new Error("Fixture image transfer is modeled by deployAppGit");
    },
    configureDatabaseReplication: async () => {
      throw new Error("Fixture does not configure database replication");
    },
    runCommandInResourceContainer: async () => {
      throw new Error("Fixture does not execute commands in containers");
    },
  };
}

export async function createDeploymentPipelineFixture(
  mode: ControlPlaneMode,
): Promise<DeploymentFixtureResult> {
  const { uow, resources, deployments, outbox, schedules } = createFixtureUow();
  const applicationServerState: FixtureServerState = {
    services: new Map(),
    generatedCaddyConfig: "",
  };
  const databaseServerState: FixtureServerState = {
    services: new Map(),
    generatedCaddyConfig: "",
  };
  const serverStates = new Map<string, FixtureServerState>();
  const serverIdByHost = new Map<string, string>();
  const buildLocations: string[] = [];
  const notifications: Record<string, unknown>[] = [];
  const caddy = createCaddyService(applicationServerState);

  const project = await new CreateProjectUseCase(uow).execute({
    name: `Fixture ${mode} Project`,
    organizationId: "org-fixture",
  });
  const environment = await new CreateEnvironmentUseCase(uow).execute({
    projectId: project.id,
    name: "Fixture Staging",
  });

  const createServer = async (
    name: string,
    serverType: "deploy" | "database",
    host: string,
    state: FixtureServerState,
  ) => {
    const server = await new CreateServerUseCase(uow).execute({
      organizationId: project.organizationId,
      name,
      serverType,
      authType: "ssh_key",
      sshKeyId: "fixture-ssh-key",
      sshHostKeyFingerprint: "SHA256:abCDEfgHIjklMNopQRstuVwxyz1234567890ABCD=",
      ipAddress: host,
      port: 22,
      username: "fixture",
      enableDockerCleanup: false,
    });
    await uow.serverRepository.updateById(server.id, { status: "ready" });
    serverStates.set(server.id, state);
    serverIdByHost.set(host, server.id);
    return (await uow.serverRepository.findById(server.id)) as Server;
  };

  const applicationServer = await createServer(
    "Fixture application server",
    "deploy",
    "203.0.113.10",
    applicationServerState,
  );
  const databaseServer = await createServer(
    "Fixture database server",
    "database",
    "203.0.113.20",
    databaseServerState,
  );

  const createResource = new CreateResourceUseCase(uow);
  const application = await createResource.execute({
    environmentId: environment.id,
    name: "Fixture Node application",
    type: "application",
    appName: "fixture-node",
    serverId: applicationServer.id,
    domains: [
      {
        enabled: true,
        host: "fixture-node.example.com",
        path: "/",
        internalPath: "/",
        stripPath: false,
        port: 3000,
        serviceName: undefined,
        https: false,
        certificateType: "letsencrypt",
        middlewares: [],
        requestFilters: {
          blockedIpRanges: ["198.51.100.9/32"],
          blockedUserAgents: ["ExampleBot"],
          allowedMethods: ["GET", "HEAD", "POST"],
          denyEmptyUserAgent: true,
          hotlinkProtection: true,
        },
      },
    ],
    buildConfig: {
      type: "railpack",
      autoDetect: true,
      buildPath: ".",
      railpackVersion: "0.15.4",
    },
  });
  const source =
    mode === "desktop"
      ? {
          provider: "local",
          credentials: JSON.stringify({ localPath: nodeFixturePath }),
        }
      : {
          provider: "git",
          credentials: JSON.stringify({
            repositoryUrl: "https://git.example.com/upstand/node-fixture.git",
          }),
        };
  await new UpdateResourceUseCase(uow, caddy).execute({
    id: application.id,
    organizationId: project.organizationId,
    ...source,
  });

  const compose = await createResource.execute({
    environmentId: environment.id,
    name: "Fixture Compose application and worker",
    type: "compose",
    composeType: "compose",
    appName: "fixture-stack",
    serverId: applicationServer.id,
    credentials: JSON.stringify({
      composeFile: "services:\n  web:\n    image: nginx:alpine\n",
    }),
    domains: [
      {
        enabled: true,
        host: "fixture-stack.example.com",
        path: "/",
        internalPath: "/",
        stripPath: false,
        port: 80,
        https: false,
        serviceName: "web",
        certificateType: "letsencrypt",
        middlewares: [],
        requestFilters: {
          blockedIpRanges: [],
          blockedUserAgents: [],
          allowedMethods: [],
          denyEmptyUserAgent: false,
          hotlinkProtection: false,
        },
      },
    ],
  });
  const database = await createResource.execute({
    environmentId: environment.id,
    name: "Fixture PostgreSQL database",
    type: "database",
    dbType: "postgres",
    dockerImage: "postgres:18-alpine",
    appName: "fixture-postgres",
    serverId: databaseServer.id,
  });

  const getRemoteServices = (connection: { host: string }) => {
    const serverId = serverIdByHost.get(connection.host);
    if (!serverId) throw new Error("Fixture received an unknown remote host");
    const state = serverStates.get(serverId);
    if (!state) throw new Error("Fixture remote server state is missing");
    return {
      dockerService: createDockerService(serverStates, buildLocations),
      caddyService: createCaddyService(state),
      docker: { kind: "remote-server", serverId } as unknown as DockerApiTarget,
      cli: { cleanup: () => {} },
    };
  };
  const localDocker = createDockerService(serverStates, buildLocations);
  const worker = new DeploymentWorker("local", {
    controlPlaneMode: mode,
    getBuildSettings: async () => ({ concurrency: 1 }),
    createRemoteServices: getRemoteServices as never,
    createScope: async () => ({
      uow,
      dockerService: localDocker,
      caddyService: caddy,
      publisher: {
        execute: async (notification: Record<string, unknown>) => {
          notifications.push(notification);
          return { id: "fixture-notification" } as never;
        },
      } as never,
      dispose: async () => {},
    }),
  });

  const runDeployment = async (
    resourceId: string,
    deploymentId: string,
    revision: string,
  ) => {
    await new QueueDeploymentUseCase(uow, undefined, mode).execute({
      resourceId,
      deploymentId,
      sourceRevision: revision,
    });
    const message = outbox.get(deploymentId);
    if (!message?.payload) {
      throw new Error(
        `Deployment ${deploymentId} did not write an outbox payload`,
      );
    }
    await worker.processInline(message.payload as DeployOutboxPayload);
  };

  const rollbackApplication = () =>
    new RollbackResourceUseCase(
      uow,
      localDocker,
      async (_serverId, _unitOfWork, defaultDockerService) => ({
        dockerService: defaultDockerService,
        cleanup: () => {},
      }),
    ).execute({ id: application.id });

  return {
    project,
    environment,
    applicationServer,
    databaseServer,
    application: (resources.get(application.id) ?? application) as Resource,
    compose: (resources.get(compose.id) ?? compose) as Resource,
    database: (resources.get(database.id) ?? database) as Resource,
    deployments,
    outbox,
    schedules,
    serverStates,
    buildLocations,
    notifications,
    runDeployment,
    rollbackApplication,
  };
}
