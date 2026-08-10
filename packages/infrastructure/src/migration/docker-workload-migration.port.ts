import type { DeploymentPlan, IUnitOfWork, Resource } from "@upstand/domain";
import { parseResourceAdvancedConfig } from "@upstand/domain";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import type {
  DockerRegistryAuth,
  DockerServicePort,
  WorkloadMigrationContext,
  WorkloadMigrationPort,
  WorkloadMigrationPreflightResult,
} from "@upstand/usecases";
import { resolveServicesForResource } from "@upstand/usecases/resource/docker-client";
import { parseResourceCredentials } from "@upstand/usecases/resource/resource-credentials";
import { parseResourceEnvironmentVariables } from "@upstand/usecases/resource/resource-environment";
import type { CaddyService } from "@upstand/usecases/web-server/caddy.service";

const ARTIFACT_REFERENCE_KEY = "artifactReference";
const ARTIFACT_DIGEST_KEY = "artifactDigest";

function artifactFrom(context: WorkloadMigrationContext): {
  reference: string;
  digest: string;
} {
  const reference = context.checkpoint[ARTIFACT_REFERENCE_KEY];
  const digest = context.checkpoint[ARTIFACT_DIGEST_KEY];
  if (typeof reference !== "string" || typeof digest !== "string") {
    throw new Error("Migration artifact checkpoint is missing");
  }
  return { reference, digest };
}

export class DockerWorkloadMigrationPort implements WorkloadMigrationPort {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly defaultDockerService: DockerServicePort,
    private readonly defaultCaddyService: CaddyService,
  ) {}

  async preflight(
    context: WorkloadMigrationContext,
  ): Promise<WorkloadMigrationPreflightResult> {
    const { migration, resource } = context;
    const deployments = await this.uow.deploymentRepository.findByResourceId(
      resource.id,
    );
    const plan = deployments.find(
      (deployment) =>
        deployment.id !== migration.deploymentId &&
        deployment.status === "success" &&
        deployment.deploymentPlan,
    )?.deploymentPlan as DeploymentPlan | null | undefined;
    const advanced = parseResourceAdvancedConfig(resource.advancedConfig);
    const source =
      migration.sourceServerId === "local"
        ? null
        : await this.uow.serverRepository.findById(migration.sourceServerId);
    const target = await this.uow.serverRepository.findById(
      migration.targetServerId,
    );
    const artifactReference = plan?.artifact.reference ?? "";
    const immutableRegistryArtifact = /^.+\/.+@sha256:[0-9a-f]{64}$/.test(
      artifactReference,
    );

    const checks = [
      {
        code: "resource_type",
        ok: resource.type === "application",
        message:
          resource.type === "application"
            ? "Application migration is supported"
            : "Database and Compose migration require state-transfer adapters",
      },
      {
        code: "source_health",
        ok: migration.sourceServerId === "local" || source?.status === "ready",
        message: "Source server must be ready",
      },
      {
        code: "target_health",
        ok: target?.status === "ready",
        message: "Target server must be ready",
      },
      {
        code: "persistent_state",
        ok: advanced.volumes.length === 0,
        message:
          advanced.volumes.length === 0
            ? "No persistent volumes require transfer"
            : "Persistent volume transfer must complete before migration",
      },
      {
        code: "immutable_artifact",
        ok: immutableRegistryArtifact,
        message: immutableRegistryArtifact
          ? "Digest-addressed registry artifact is available"
          : "A successful digest-addressed registry deployment is required",
      },
    ];

    if (checks.every((check) => check.ok)) {
      try {
        const targetServices = await this.targetServices(context);
        try {
          await targetServices.dockerService.getServerRuntimeStats();
          if (
            targetServices.dockerService.serviceExists &&
            (await targetServices.dockerService.serviceExists({
              ...resource,
              serverId: migration.targetServerId,
            }))
          ) {
            checks.push({
              code: "service_name_available",
              ok: false,
              message: "Target already owns a service with this resource name",
            });
          } else {
            checks.push({
              code: "target_runtime",
              ok: true,
              message: "Target Docker runtime is reachable",
            });
          }
        } finally {
          targetServices.cleanup();
        }
      } catch (error) {
        checks.push({
          code: "target_runtime",
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      checks,
      ...(plan
        ? {
            checkpoint: {
              [ARTIFACT_REFERENCE_KEY]: plan.artifact.reference,
              [ARTIFACT_DIGEST_KEY]: plan.artifact.digest,
            },
          }
        : {}),
    };
  }

  async transfer(context: WorkloadMigrationContext): Promise<void> {
    artifactFrom(context);
    // The immutable artifact is already in the configured registry. Pulling it
    // while creating the shadow service is the transfer and access check.
    await context.onProgress(50);
  }

  async deployShadow(context: WorkloadMigrationContext): Promise<void> {
    const { reference } = artifactFrom(context);
    const services = await this.targetServices(context);
    try {
      const resource = this.targetResource(
        context.resource,
        context,
        reference,
      );
      await services.dockerService.deployAppImage(
        resource,
        parseResourceEnvironmentVariables(resource.envVars),
        undefined,
        undefined,
        await this.registryAuth(resource),
      );
      await context.onProgress(65, {
        ...context.checkpoint,
        shadowDeployed: true,
        shadowServiceName: services.dockerService.sanitizeName(
          resource.appName || resource.name,
        ),
      });
    } finally {
      services.cleanup();
    }
  }

  async validateShadow(context: WorkloadMigrationContext): Promise<void> {
    const { reference } = artifactFrom(context);
    const services = await this.targetServices(context);
    try {
      const resource = this.targetResource(
        context.resource,
        context,
        reference,
      );
      const convergence =
        await services.dockerService.waitForServiceConvergence(resource);
      if (!convergence.healthy) {
        throw new Error(
          convergence.message ?? "Target service did not converge",
        );
      }
      const smoke =
        await services.dockerService.runPostDeploySmokeTest(resource);
      if (smoke && !smoke.healthy) {
        throw new Error(smoke.message ?? "Target smoke test failed");
      }
      await context.onProgress(80);
    } finally {
      services.cleanup();
    }
  }

  async cutover(context: WorkloadMigrationContext): Promise<void> {
    const { reference } = artifactFrom(context);
    const services = await this.targetServices(context);
    try {
      const resource = this.targetResource(
        context.resource,
        context,
        reference,
      );
      const [resources, settings, certificates] = await Promise.all([
        this.uow.resourceRepository.findForCaddyByDeploymentServerId
          ? this.uow.resourceRepository.findForCaddyByDeploymentServerId(
              context.migration.targetServerId,
            )
          : this.uow.resourceRepository.findMany(),
        this.uow.webServerSettingsRepository.findGlobal(),
        this.uow.certificateRepository.findAll?.() ?? Promise.resolve([]),
      ]);
      const withoutMigratingResource = resources.filter(
        (candidate) => candidate.id !== resource.id,
      );
      await services.caddyService.syncResourceConfigs(
        [...withoutMigratingResource, resource],
        settings ?? {},
        certificates,
      );
      await context.onProgress(90);
    } finally {
      services.cleanup();
    }
  }

  async rollback(context: WorkloadMigrationContext): Promise<void> {
    await this.cleanupShadow(context);
  }

  async cleanupSource(context: WorkloadMigrationContext): Promise<void> {
    const services = await resolveServicesForResource(
      {
        ...context.resource,
        serverId:
          context.migration.sourceServerId === "local"
            ? "local"
            : context.migration.sourceServerId,
      },
      this.uow,
      this.defaultDockerService,
      this.defaultCaddyService,
    );
    try {
      await services.dockerService.removeResource(
        {
          ...context.resource,
          serverId:
            context.migration.sourceServerId === "local"
              ? "local"
              : context.migration.sourceServerId,
        },
        false,
      );
    } finally {
      services.cleanup();
    }
  }

  async cleanupShadow(context: WorkloadMigrationContext): Promise<void> {
    if (context.checkpoint.shadowDeployed !== true) return;
    const services = await this.targetServices(context);
    try {
      await services.dockerService.removeResource(
        {
          ...context.resource,
          serverId: context.migration.targetServerId,
        },
        false,
      );
    } finally {
      services.cleanup();
    }
  }

  private targetResource(
    resource: Resource,
    context: WorkloadMigrationContext,
    artifactReference: string,
  ): Resource {
    return {
      ...resource,
      serverId: context.migration.targetServerId,
      provider: "docker-registry",
      dockerImage: artifactReference,
    };
  }

  private targetServices(context: WorkloadMigrationContext) {
    return resolveServicesForResource(
      {
        ...context.resource,
        serverId: context.migration.targetServerId,
      },
      this.uow,
      this.defaultDockerService,
      this.defaultCaddyService,
    );
  }

  private async registryAuth(
    resource: Resource,
  ): Promise<DockerRegistryAuth | undefined> {
    const credentials = parseResourceCredentials(resource.credentials);
    const registryId =
      typeof credentials.registryId === "string"
        ? credentials.registryId
        : resource.buildRegistryId;
    if (!registryId) return undefined;
    const registry =
      await this.uow.dockerRegistryRepository.findById(registryId);
    if (!registry) throw new Error("Artifact registry was not found");
    const environment = await this.uow.environmentRepository.findById(
      resource.environmentId,
    );
    const project = environment
      ? await this.uow.projectRepository.findById(environment.projectId)
      : null;
    if (!project || project.organizationId !== registry.organizationId) {
      throw new Error("Artifact registry belongs to another organization");
    }
    let password = "";
    if (registry.password) {
      try {
        const parsed: unknown = JSON.parse(registry.password);
        if (
          parsed &&
          typeof parsed === "object" &&
          "ciphertext" in parsed &&
          "iv" in parsed &&
          "authTag" in parsed
        ) {
          password = decryptSecret(
            parsed as Parameters<typeof decryptSecret>[0],
          );
        } else {
          password = registry.password;
        }
      } catch {
        password = registry.password;
      }
    }
    return {
      username: registry.username || undefined,
      password,
      serveraddress: (registry.registryUrl || "").replace(/^https?:\/\//, ""),
    };
  }
}
