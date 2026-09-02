import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DeploymentPlanSchema,
  type IUnitOfWork,
  type PreviewDeployment,
  parseResourceAdvancedConfig,
  type Resource,
  type ResourceRoutingProjection,
} from "@upstand/domain";
import { env } from "@upstand/env/server";
import { withDeploymentScopeToken } from "@upstand/platform/crypto/deployment-scope";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import { closeRedis, createRedis, type Redis, redis } from "@upstand/redis";
import { DelayedError, type Job, Worker } from "bullmq";
import { log } from "evlog";
import { resolveEnvironmentVariables } from "../environment/update-environment.usecase";
import { isSshGitUrl } from "../git-provider/git-url-sanitizer";
import { getInstallationToken } from "../git-provider/github-client";
import type { NotificationPublisher } from "../notification/publish-notification.usecase";
import { withJobTelemetry } from "../observability/job-telemetry";
import {
  assertRuntimeCapability,
  getConfiguredControlPlaneMode,
  getPlatformCapabilities,
} from "../platform/platform.types";
import type { CaddyResource } from "../ports/caddy";
import type { DockerApiTarget, DockerRegistryAuth } from "../ports/docker";
import { getDatabaseEnvironment } from "../resource/database-environment";
import type { DockerDeploymentService as DockerService } from "../resource/docker-client";
import { createRemoteServices } from "../resource/docker-client";
import {
  parseResourceCredentials,
  parseResourceCredentialsStrict,
  serializeResourceCredentials,
} from "../resource/resource-credentials";
import {
  resolveResourceBuildEnvironmentVariables,
  resolveResourceEnvironmentVariables,
} from "../resource/resource-environment";
import { validateResourceCredentialReferences } from "../resource/validate-resource-credential-references";
import { SyncUpstandConfigUseCase } from "../schedule/sync-upstand-config.usecase";
import { requestMonitoringAgent } from "../server/monitoring-agent.client";
import {
  assertBuildServerSupportsResource,
  assertDeploymentServerSupportsResource,
} from "../server/server-role";
import type { CaddyService } from "../web-server/caddy.service";
import { buildRegistryImageTag } from "./build-registry";
import { appendBoundedDeploymentLog } from "./deployment-log-safety";
import { getDeploymentQueueName } from "./deployment-queue-name";
import {
  createGitBasicAuthEnvironment,
  removeGitUrlCredentials,
} from "./git-source-auth";
import { ResourceLock } from "./resource-lock";

export interface DeploymentWorkerScope {
  uow: IUnitOfWork;
  dockerService: DockerService;
  caddyService: CaddyService;
  publisher: NotificationPublisher;
  dispose: () => Promise<void>;
}

export interface DeploymentWorkerDependencies {
  getBuildSettings: () => Promise<{ concurrency: number } | null>;
  createScope: () => Promise<DeploymentWorkerScope>;
}

interface RegistryInfo {
  url: string;
  username?: string;
  password?: string;
  imageTag: string;
}

interface DockerHookService {
  runCommandInResourceContainer(
    resource: Resource,
    command: string,
    target?: DockerApiTarget,
    options?: { timeoutSeconds?: number; maxOutputBytes?: number },
  ): Promise<string>;
}

type GitSource = {
  cloneUrl: string;
  sshKeyPath?: string;
  gitEnvironment?: Record<string, string>;
  sshHostKeyFingerprint?: string;
};

function supportsDockerHookService(
  service: DockerService,
): service is DockerService & DockerHookService {
  const record: Record<string, unknown> | null = isRecord(service)
    ? service
    : null;
  return typeof record?.runCommandInResourceContainer === "function";
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value: unknown = record[field];
  return typeof value === "string" ? value : undefined;
}

async function resolveConfiguredRegistryAuth(
  uow: IUnitOfWork,
  resource: Resource,
  organizationId: string,
): Promise<DockerRegistryAuth | undefined> {
  const credentials = parseResourceCredentials(resource.credentials);
  const registryId = stringField(credentials, "registryId");
  if (!registryId) return undefined;

  const registry = await uow.dockerRegistryRepository.findById(registryId);
  if (!registry) throw new Error("Selected Docker registry not found");
  if (registry.organizationId !== organizationId) {
    throw new Error("Selected Docker registry belongs to another organization");
  }

  return {
    username: registry.username || undefined,
    password: registry.password ?? undefined,
    serveraddress: (registry.registryUrl || "")
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, ""),
  };
}

function parseFirstDomain(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return {};
    const first: unknown = parsed.at(0);
    return isRecord(first) ? first : {};
  } catch {
    return {};
  }
}

function isLocalServerIp(ip: string): boolean {
  if (!ip) return false;
  if (["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(ip)) return true;
  if (env.HOST_IP && env.HOST_IP === ip) return true;
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name] ?? []) {
        if (net.address === ip) return true;
      }
    }
  } catch {
    // ignore interface query errors
  }
  return false;
}

function numericMetric(
  record: Record<string, unknown>,
  names: string[],
): number | undefined {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

async function verifyProgressiveDeliveryMetrics(
  uow: IUnitOfWork,
  resource: Resource,
  bakeTimeSeconds: number,
): Promise<string | null> {
  if (bakeTimeSeconds > 0) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, bakeTimeSeconds * 1_000),
    );
  }
  try {
    const result = await requestMonitoringAgent<unknown>(
      uow,
      resource.serverId || "local",
      "/metrics/containers",
      {
        query: new URLSearchParams({
          appName: resource.appName || resource.name,
          limit: "20",
        }),
      },
    );
    const records = Array.isArray(result)
      ? result.filter((value): value is Record<string, unknown> =>
          Boolean(value && typeof value === "object"),
        )
      : [];
    for (const record of records) {
      const errorRate = numericMetric(record, [
        "errorRate",
        "ErrorRate",
        "http5xxRate",
        "Http5xxRate",
      ]);
      const p95 = numericMetric(record, [
        "p95LatencyMs",
        "P95LatencyMs",
        "latency.p95",
      ]);
      const cpu = numericMetric(record, ["CPU", "cpu", "Cpu.Percent"]);
      const memory = numericMetric(record, [
        "Memory.Percentage",
        "memoryPercent",
        "memory.percentage",
        "Memory",
      ]);
      if (errorRate !== undefined && errorRate > 5)
        return `error rate ${errorRate}% exceeded 5%`;
      if (p95 !== undefined && p95 > 5_000)
        return `p95 latency ${p95}ms exceeded 5000ms`;
      if (cpu !== undefined && cpu > 95)
        return `cpu utilization ${cpu}% exceeded 95%`;
      if (memory !== undefined && memory > 95)
        return `memory utilization ${memory}% exceeded 95%`;
    }
  } catch {
    // Metrics are an optional deployment gate. Health convergence remains the
    // mandatory gate when the monitoring agent is unavailable.
  }
  return null;
}

export class DeploymentWorker {
  private worker: Worker | null = null;
  private workerRedis: Redis | null = null;
  private pubsubRedis: Redis | null = null;

  constructor(
    private readonly serverId: string,
    private readonly dependencies: DeploymentWorkerDependencies,
  ) {}

  public async start(): Promise<void> {
    if (this.worker) return;

    const redisConn = createRedis({
      maxRetriesPerRequest: null,
      loggerName: `deployment-worker:${this.serverId}`,
    });
    this.workerRedis = redisConn;
    const queueName = getDeploymentQueueName(this.serverId);

    // Get initial concurrency from DB or default
    let concurrency = 2; // Default to 2 for manager/leader, 1 for workers
    try {
      const settings = await this.dependencies.getBuildSettings();
      if (settings) {
        concurrency = Math.max(1, Math.min(100, settings.concurrency));
      } else {
        concurrency = this.serverId === "local" ? 2 : 1;
      }
    } catch (err: unknown) {
      log.error({
        message:
          "Failed to fetch build settings for worker, using default concurrency",
        err,
      });
    } finally {
    }

    log.info({
      message: `Starting Deployment Worker for server '${this.serverId}' on queue '${queueName}' with concurrency ${concurrency}`,
    });

    try {
      this.worker = new Worker(
        queueName,
        async (job: Job) => {
          await withJobTelemetry(
            {
              operation: "deployment.execute",
              queue: queueName,
              jobId: job.id,
              correlationId: isRecord(job.data)
                ? job.data.correlationId
                : undefined,
              attempt: job.attemptsMade + 1,
              fields: {
                deployment: {
                  deploymentId: isRecord(job.data)
                    ? job.data.deploymentId
                    : undefined,
                  resourceId: isRecord(job.data)
                    ? job.data.resourceId
                    : undefined,
                  serverId: this.serverId,
                },
              },
            },
            () => {
              const scopeToken = isRecord(job.data)
                ? stringField(job.data, "dockerScopeToken")
                : undefined;
              return withDeploymentScopeToken(scopeToken, () =>
                this.processJob(job),
              );
            },
          );
        },
        {
          connection: redisConn,
          concurrency,
          limiter: {
            max: 10,
            duration: 1000,
          },
          maxStalledCount: 1,
          stalledInterval: 30_000,
          settings: {
            backoffStrategy: (attemptsMade, type, _error, job) => {
              if (type !== "capped-exponential") {
                throw new Error(`Unsupported deployment backoff type: ${type}`);
              }
              const data = isRecord(job?.data) ? job.data : {};
              const baseSeconds = numberField(data.retryBaseSeconds, 2);
              const maxSeconds = numberField(
                data.retryMaxSeconds,
                Math.max(baseSeconds, 60),
              );
              return (
                Math.min(
                  maxSeconds,
                  baseSeconds * 2 ** Math.max(0, attemptsMade - 1),
                ) * 1_000
              );
            },
          },
        },
      );

      this.worker.on(
        "failed",
        (job: Job<Record<string, unknown>> | undefined, err: Error) => {
          log.error({
            message: "Deployment queue job failed",
            deployment: {
              jobId: job?.id,
              deploymentId: job?.data?.deploymentId,
              resourceId: job?.data?.resourceId,
              serverId: this.serverId,
            },
            err: errorMessage(err),
          });
        },
      );
      this.worker.on("error", (error) => {
        log.error({
          message: "Deployment worker connection error",
          serverId: this.serverId,
          err: error,
        });
      });

      await this.worker.waitUntilReady();
      await this.startPubSubListener();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  public isReady(): boolean {
    return Boolean(this.worker?.isRunning());
  }

  private async startPubSubListener(): Promise<void> {
    this.pubsubRedis = createRedis({
      loggerName: `deployment-concurrency:${this.serverId}`,
    });
    await this.pubsubRedis.subscribe("upstand:server:concurrency");

    this.pubsubRedis.on("message", async (channel: string, message: string) => {
      if (channel === "upstand:server:concurrency") {
        try {
          const payload = JSON.parse(message);
          if (payload.serverId === this.serverId && this.worker) {
            log.info({
              message: `Updating worker concurrency for ${this.serverId} to ${payload.concurrency}`,
            });
            const concurrency = Number(payload.concurrency);
            if (
              !Number.isInteger(concurrency) ||
              concurrency < 1 ||
              concurrency > 100
            ) {
              throw new Error(
                "Concurrency must be an integer between 1 and 100",
              );
            }
            this.worker.concurrency = concurrency;
          }
        } catch (err: unknown) {
          log.error({
            message: "Error processing concurrency update message",
            err,
          });
        }
      }
    });
  }

  public async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.pubsubRedis) {
      await closeRedis(this.pubsubRedis);
      this.pubsubRedis = null;
    }
    if (this.workerRedis) {
      await closeRedis(this.workerRedis);
      this.workerRedis = null;
    }
  }

  private async processJob(job: Job) {
    const {
      resourceId,
      deploymentId,
      previewDeploymentId,
      sourceRevision: queuedSourceRevision,
      retryBaseSeconds,
      retryMaxSeconds,
    } = job.data as {
      resourceId: string;
      deploymentId: string;
      previewDeploymentId?: string;
      sourceRevision?: string;
      retryBaseSeconds?: number;
      retryMaxSeconds?: number;
      dockerScopeToken?: string;
    };
    if (!resourceId || !deploymentId) {
      throw new Error("Deployment job is missing resourceId or deploymentId");
    }

    const lockKey = `upstand:resource:lock:${resourceId}`;

    if (!this.workerRedis) {
      throw new Error("Worker Redis client is not initialized");
    }

    // 1. Try to acquire the Redis lock for serialization of this resource
    const resourceLock = await ResourceLock.acquire(this.workerRedis, lockKey);
    if (!resourceLock) {
      log.info({
        message: `Resource ${resourceId} is currently building. Delaying job ${job.id}.`,
      });
      // This is normal queue back-pressure, not a failed deployment. Moving the
      // active job to delayed and signalling BullMQ with DelayedError preserves
      // its attempt count and prevents a misleading failed-job event.
      await job.moveToDelayed(Date.now() + 5_000, job.token);
      throw new DelayedError(
        `Resource ${resourceId} is already building; retry scheduled.`,
      );
    }

    let tempSshKeyPath: string | null = null;
    let resource: Awaited<
      ReturnType<IUnitOfWork["resourceRepository"]["findById"]>
    > = null;
    let logsAccumulator = "Deployment pipeline started in queue worker...\n";
    let flushTimeout: ReturnType<typeof setTimeout> | null = null;
    let flushInFlight: Promise<void> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let remoteCliCleanup: (() => void) | null = null;
    let buildCliCleanup: (() => void) | null = null;
    const executionToken = randomUUID();
    let executionLeaseLost = false;

    const scope = await this.dependencies.createScope();
    const { uow, publisher } = scope;
    let dockerService = scope.dockerService;
    let caddyService = scope.caddyService;

    const publishDeploymentOutcome = async (
      status: "success" | "failed",
      err?: Error | unknown,
    ) => {
      if (!resource) return;

      const environment = await uow.environmentRepository.findById(
        resource.environmentId,
      );
      if (!environment) return;
      const project = await uow.projectRepository.findById(
        environment.projectId,
      );
      if (!project) return;

      const succeeded = status === "success";
      const titlePrefix = succeeded
        ? "🚀 Deployment Succeeded"
        : "❌ Deployment Failed";
      await publisher.execute({
        organizationId: project.organizationId,
        event: succeeded ? "deployment_succeeded" : "deployment_failed",
        idempotencyKey: `deployment:${deploymentId}:${status}`,
        title: `${titlePrefix}: ${resource.name}`,
        message: succeeded
          ? `Deployment #${deploymentId.slice(0, 8)} for ${resource.name} completed successfully in ${environment.name} (${project.name}).`
          : `Deployment #${deploymentId.slice(0, 8)} for ${resource.name} failed in ${environment.name} (${project.name}). Review deployment logs for details.`,
        metadata: {
          event: succeeded ? "deployment_succeeded" : "deployment_failed",
          resourceId,
          resourceName: resource.name,
          deploymentId,
          resourceType: resource.type,
          projectName: project.name,
          environmentName: environment.name,
          status,
          ...(succeeded
            ? {}
            : {
                error:
                  err instanceof Error
                    ? err.message
                    : err
                      ? String(err)
                      : undefined,
                logs: logsAccumulator.slice(-1500),
              }),
        },
      });
    };

    const appendLog = (msg: string) => {
      logsAccumulator = appendBoundedDeploymentLog(logsAccumulator, msg);

      if (!flushTimeout) {
        flushTimeout = setTimeout(() => {
          flushTimeout = null;
          flushInFlight = uow
            .transaction(async (tx) => {
              // Update deployment logs in the dedicated deployment table
              if (tx.deploymentRepository.updateByIdOwned) {
                await tx.deploymentRepository.updateByIdOwned(
                  deploymentId,
                  executionToken,
                  { logs: logsAccumulator },
                );
              } else {
                await tx.deploymentRepository.updateById(deploymentId, {
                  logs: logsAccumulator,
                });
              }
            })
            .catch((error) => {
              log.error({
                message: "Failed to write build logs to database",
                deploymentId,
                resourceId,
                err: error,
              });
            })
            .finally(() => {
              flushInFlight = null;
            });
        }, 1500);
      }
    };

    const flushFinalLogs = async (
      status: "success" | "failed" | "retrying" | "cancelled",
      lastError?: string,
      retryDelaySeconds?: number,
    ) => {
      if (flushTimeout) {
        clearTimeout(flushTimeout);
        flushTimeout = null;
      }
      if (flushInFlight) {
        await flushInFlight;
      }
      resourceLock.assertOwned();
      await uow.transaction(async (tx) => {
        // Update dedicated deployment record
        if (tx.deploymentRepository.updateByIdOwned) {
          const updated = await tx.deploymentRepository.updateByIdOwned(
            deploymentId,
            executionToken,
            {
              logs: logsAccumulator,
              status,
              executionToken: null,
              lastError: lastError ?? null,
              retryAt:
                status === "retrying" && retryDelaySeconds !== undefined
                  ? new Date(Date.now() + retryDelaySeconds * 1_000)
                  : null,
              heartbeatAt: null,
            },
          );
          if (!updated) {
            executionLeaseLost = true;
            throw new Error("Deployment execution lease was lost");
          }
        } else {
          await tx.deploymentRepository.updateById(deploymentId, {
            logs: logsAccumulator,
            status,
            executionToken: null,
            lastError: lastError ?? null,
            retryAt:
              status === "retrying" && retryDelaySeconds !== undefined
                ? new Date(Date.now() + retryDelaySeconds * 1_000)
                : null,
            heartbeatAt: null,
          });
        }

        if (previewDeploymentId) {
          await tx.previewDeploymentRepository.updateById(previewDeploymentId, {
            status:
              status === "success"
                ? "success"
                : status === "retrying"
                  ? "running"
                  : "failed",
          });
        }

        // Update only desired resource status; runtime observations are queried live.
        const r = await tx.resourceRepository.findById(resourceId);
        if (r) {
          await tx.resourceRepository.updateById(resourceId, {
            ...(!previewDeploymentId
              ? {
                  status:
                    status === "success"
                      ? "running"
                      : status === "retrying"
                        ? "queued"
                        : "stopped",
                }
              : {}),
          });
        }
      });
    };

    try {
      const deployment = await uow.deploymentRepository.findById(deploymentId);
      if (!deployment || deployment.resourceId !== resourceId) {
        throw new Error("Deployment record does not match the queued job");
      }
      if (
        ["success", "failed", "stale", "cancelled"].includes(deployment.status)
      ) {
        log.info({
          message: "Skipping deployment job whose database state is terminal",
          deploymentId,
          resourceId,
          status: deployment.status,
        });
        return;
      }

      const claimed = await uow.transaction(async (tx) => {
        const claimedDeployment = tx.deploymentRepository.claimForExecution
          ? await tx.deploymentRepository.claimForExecution(
              deploymentId,
              executionToken,
              new Date(),
            )
          : await tx.deploymentRepository.updateById(deploymentId, {
              status: "running",
            });
        if (claimedDeployment) {
          const r = await tx.resourceRepository.findById(resourceId);
          if (r) {
            await tx.resourceRepository.updateById(resourceId, {
              status: "running",
            });
          }
        }
        return claimedDeployment;
      });
      if (!claimed) return;
      heartbeatTimer = setInterval(() => {
        const heartbeat = uow.deploymentRepository.heartbeatOwned;
        if (!heartbeat) return;
        void heartbeat
          .call(
            uow.deploymentRepository,
            deploymentId,
            executionToken,
            new Date(),
          )
          .then((renewed) => {
            if (!renewed) executionLeaseLost = true;
          })
          .catch((error: unknown) => {
            executionLeaseLost = true;
            log.warn({
              message: "Unable to renew deployment execution heartbeat",
              deploymentId,
              resourceId,
              err: error,
            });
          });
      }, 15_000);
      heartbeatTimer.unref?.();
      const sourceRevision = claimed.sourceRevision ?? queuedSourceRevision;

      resource = await uow.transaction(async (tx) => {
        return await tx.resourceRepository.findById(resourceId);
      });

      if (!resource) {
        throw new Error("Resource not found");
      }
      const environment = await uow.environmentRepository.findById(
        resource.environmentId,
      );
      const project = environment
        ? await uow.projectRepository.findById(environment.projectId)
        : null;
      if (!project) {
        throw new Error("Resource project not found");
      }
      await validateResourceCredentialReferences(
        uow,
        project.organizationId,
        resource.credentials,
      );
      if (executionLeaseLost) {
        throw new Error(
          "Deployment canceled: execution lease was lost to another worker.",
        );
      }
      const deployedResource = { ...resource };

      let previewDeploymentRecord: PreviewDeployment | null = null;
      if (previewDeploymentId) {
        previewDeploymentRecord =
          await uow.previewDeploymentRepository.findById(previewDeploymentId);
        if (previewDeploymentRecord) {
          await uow.transaction(async (tx) => {
            await tx.previewDeploymentRepository.updateById(
              previewDeploymentId,
              {
                status: "running",
              },
            );
          });

          // Override name, appName, and branch in credentials
          deployedResource.name = previewDeploymentRecord.appName;
          deployedResource.appName = previewDeploymentRecord.appName;

          const creds = parseResourceCredentialsStrict(
            deployedResource.credentials,
          );
          creds.branch = previewDeploymentRecord.branchName;
          deployedResource.credentials = serializeResourceCredentials(creds);
        }
      }

      let buildDockerService = dockerService;
      buildCliCleanup = null;
      let registryInfo: RegistryInfo | undefined;
      let targetDestinationDocker: DockerApiTarget | undefined;
      const cancellationKey = `upstand:deployment:cancel:${deploymentId}`;
      dockerService.setCancellationKey(cancellationKey);

      if (
        deployedResource.serverId &&
        !["local", "manager"].includes(deployedResource.serverId)
      ) {
        const server = await uow.serverRepository.findById(
          deployedResource.serverId,
        );
        if (!server) {
          // serverId not found in server table — likely a stale Swarm node ID
          // from before the "local" sentinel fix. Log a warning and fall back
          // to the local Docker socket.
          appendLog(
            `Warning: serverId '${deployedResource.serverId}' not found in server registry. ` +
              "Falling back to local Docker socket.\n",
          );
        } else if (isLocalServerIp(server.ipAddress)) {
          appendLog(
            `Using local Docker engine for control plane server '${server.name}'.\n`,
          );
        } else {
          assertDeploymentServerSupportsResource(server, deployedResource.type);
          if (server.status !== "ready") {
            throw new Error(
              `Target deployment server '${server.name}' is not ready. Run server setup before deploying.`,
            );
          }
          let privateKey: string | undefined;
          let password: string | undefined;
          const isTargetPasswordAuth =
            server.authType === "password" ||
            (!server.sshKeyId && Boolean(server.passwordCiphertext));
          if (isTargetPasswordAuth) {
            if (
              !server.passwordCiphertext ||
              !server.passwordIv ||
              !server.passwordAuthTag ||
              server.passwordVersion == null
            ) {
              throw new Error(
                `Target deployment server '${server.name}' password credentials are missing`,
              );
            }
            password = decryptSecret({
              ciphertext: server.passwordCiphertext,
              iv: server.passwordIv,
              authTag: server.passwordAuthTag,
              keyVersion: server.passwordVersion,
            });
          } else {
            if (!server.sshKeyId) {
              throw new Error(
                "Target deployment server has no SSH key configured",
              );
            }
            const sshKey = await uow.sshKeyRepository.findById(server.sshKeyId);
            if (!sshKey)
              throw new Error("Target deployment server SSH key not found");
            privateKey = decryptSecret({
              ciphertext: sshKey.privateKeyCiphertext,
              iv: sshKey.privateKeyIv,
              authTag: sshKey.privateKeyAuthTag,
              keyVersion: sshKey.privateKeyVersion,
            });
          }
          const connection = {
            host: server.ipAddress,
            port: server.port,
            username: server.username,
            privateKey,
            password,
            hostKeyFingerprint: server.sshHostKeyFingerprint ?? undefined,
          };
          const remote = createRemoteServices(connection);
          remoteCliCleanup = remote.cli.cleanup;
          dockerService = remote.dockerService;
          dockerService.setCancellationKey(cancellationKey);
          caddyService = remote.caddyService;
          targetDestinationDocker = remote.docker;
          appendLog(
            `Using independent Docker environment on '${server.name}'.\n`,
          );
        } // end else (server found)
      } // end if (non-local serverId)

      if (
        deployedResource.buildServerId &&
        deployedResource.buildServerId !== deployedResource.serverId
      ) {
        const buildServer = await uow.serverRepository.findById(
          deployedResource.buildServerId,
        );
        if (!buildServer) throw new Error("Target build server not found");
        assertBuildServerSupportsResource(buildServer, deployedResource.type);
        if (buildServer.status !== "ready") {
          throw new Error(
            `Target build server '${buildServer.name}' is not ready. Run server setup before deploying.`,
          );
        }
        let buildPrivateKey: string | undefined;
        let buildPassword: string | undefined;
        const isBuildPasswordAuth =
          buildServer.authType === "password" ||
          (!buildServer.sshKeyId && Boolean(buildServer.passwordCiphertext));
        if (isBuildPasswordAuth) {
          if (
            !buildServer.passwordCiphertext ||
            !buildServer.passwordIv ||
            !buildServer.passwordAuthTag ||
            buildServer.passwordVersion == null
          ) {
            throw new Error(
              `Target build server '${buildServer.name}' password credentials are missing`,
            );
          }
          buildPassword = decryptSecret({
            ciphertext: buildServer.passwordCiphertext,
            iv: buildServer.passwordIv,
            authTag: buildServer.passwordAuthTag,
            keyVersion: buildServer.passwordVersion,
          });
        } else {
          if (!buildServer.sshKeyId) {
            throw new Error("Target build server has no SSH key configured");
          }
          const sshKey = await uow.sshKeyRepository.findById(
            buildServer.sshKeyId,
          );
          if (!sshKey) throw new Error("Target build server SSH key not found");
          buildPrivateKey = decryptSecret({
            ciphertext: sshKey.privateKeyCiphertext,
            iv: sshKey.privateKeyIv,
            authTag: sshKey.privateKeyAuthTag,
            keyVersion: sshKey.privateKeyVersion,
          });
        }
        const connection = {
          host: buildServer.ipAddress,
          port: buildServer.port,
          username: buildServer.username,
          privateKey: buildPrivateKey,
          password: buildPassword,
          hostKeyFingerprint: buildServer.sshHostKeyFingerprint ?? undefined,
        };
        const remoteBuild = createRemoteServices(connection);
        buildCliCleanup = remoteBuild.cli.cleanup;
        buildDockerService = remoteBuild.dockerService;
        buildDockerService.setCancellationKey(cancellationKey);
        appendLog(
          `Offloading build compilation tasks to separate build server '${buildServer.name}'.\n`,
        );

        const envRecord = await uow.environmentRepository.findById(
          deployedResource.environmentId,
        );
        if (!envRecord) throw new Error("Environment not found");
        const projectRecord = await uow.projectRepository.findById(
          envRecord.projectId,
        );
        if (!projectRecord) throw new Error("Project not found");
        const organizationId = projectRecord.organizationId;

        const resourceCredentials = parseResourceCredentials(
          deployedResource.credentials,
        );
        const configuredBuildRegistryId =
          deployedResource.buildRegistryId ||
          stringField(resourceCredentials, "buildRegistryId");
        const registry = configuredBuildRegistryId
          ? await uow.dockerRegistryRepository.findById(
              configuredBuildRegistryId,
            )
          : (
              await uow.dockerRegistryRepository.findByOrganizationId(
                organizationId,
              )
            )[0];
        if (registry) {
          if (registry.organizationId !== organizationId) {
            throw new Error(
              "Selected build registry belongs to another organization",
            );
          }
          const cleanUrl = (registry.registryUrl || "")
            .replace(/https?:\/\//, "")
            .replace(/\/+$/, "");
          const serviceName = dockerService.sanitizeName(
            deployedResource.appName || deployedResource.name,
          );
          const imageTag = buildRegistryImageTag(
            registry,
            serviceName,
            deploymentId,
          );

          registryInfo = {
            url: cleanUrl,
            username: registry.username ?? undefined,
            password: registry.password ?? undefined,
            imageTag,
          };
        } else {
          appendLog(
            "Notice: No Docker Registry configured. Compiled image will be transferred directly to destination server.\n",
          );
        }
      }

      // When no registry is configured, pin service placement to the manager node
      // where the image was compiled/loaded to avoid multi-node Swarm pull failures.
      const constraints: string[] | undefined = !registryInfo
        ? ["node.role==manager"]
        : undefined;

      // Resolve resource env vars: substitute any ${{project.VAR_NAME}} placeholders
      // with the current environment's project-level variables.
      const deployEnvironment = await uow.environmentRepository.findById(
        resource.environmentId,
      );
      const envVars = resolveResourceEnvironmentVariables(
        resource.envVars,
        deployEnvironment
          ? JSON.stringify(
              await resolveEnvironmentVariables(uow, deployEnvironment.id),
            )
          : undefined,
      );
      const buildEnvVars = resolveResourceBuildEnvironmentVariables(
        resource.buildEnvVars,
        resource.envVars,
        deployEnvironment
          ? JSON.stringify(
              await resolveEnvironmentVariables(uow, deployEnvironment.id),
            )
          : undefined,
      );
      const advancedConfig = parseResourceAdvancedConfig(
        deployedResource.advancedConfig,
      );
      const deploymentStrategy = advancedConfig.deploymentStrategy;
      const stableServiceExists =
        deployedResource.type === "application" && dockerService.serviceExists
          ? await dockerService.serviceExists(deployedResource)
          : false;
      const stagedDelivery =
        deployedResource.type === "application" &&
        !previewDeploymentId &&
        stableServiceExists &&
        deploymentStrategy.type !== "rolling";
      if (
        stagedDelivery &&
        !deployedResource.appName &&
        !deployedResource.name
      ) {
        throw new Error(
          "Progressive delivery requires a stable application service name",
        );
      }
      const baseServiceName = dockerService.sanitizeName(
        deployedResource.appName || deployedResource.name,
      );
      const revisionServiceName = stagedDelivery
        ? `${baseServiceName.slice(0, 48)}-upstand-${deploymentId.slice(0, 8)}`
        : undefined;
      const revisionOptions = {
        imageTagSuffix: deploymentId,
        ...(stagedDelivery
          ? {
              serviceNameOverride: revisionServiceName,
              replicasOverride:
                deploymentStrategy.type === "canary"
                  ? (deploymentStrategy.canaryReplicas ?? 1)
                  : (advancedConfig.replicas ?? 1),
            }
          : {}),
      };

      if (resource.type === "database") {
        appendLog("Preparing database deployment...\n");

        const finalEnv = getDatabaseEnvironment({
          ...resource,
          envVars: JSON.stringify(envVars),
        });
        await dockerService.deployDatabase(
          resource,
          finalEnv,
          appendLog,
          constraints,
        );
        const replicationConfig = parseResourceAdvancedConfig(
          resource.advancedConfig,
        ).databaseReplication;
        if (replicationConfig.enabled) {
          await dockerService.configureDatabaseReplication(resource, finalEnv);
          appendLog(
            "Managed PostgreSQL replication service reconciled successfully.\n",
          );
        }
        appendLog("Database Swarm service deployed successfully!\n");
      } else if (resource.type === "compose") {
        appendLog(
          resource.composeType === "compose"
            ? "Preparing Docker Compose deployment...\n"
            : "Preparing Docker Compose Stack deployment...\n",
        );
        let composeFile = "";
        const credentials = parseResourceCredentials(resource.credentials);
        if (resource.provider === "raw") {
          composeFile = stringField(credentials, "composeFile") ?? "";
        } else {
          const source = await resolveGitSource(resource, uow, appendLog);
          tempSshKeyPath = source.sshKeyPath || null;
          composeFile = await dockerService.readComposeFileFromGit(
            resource,
            source.cloneUrl,
            appendLog,
            source.sshKeyPath,
            sourceRevision,
            source.gitEnvironment,
            source.sshHostKeyFingerprint,
          );
        }
        if (!composeFile) {
          throw new Error("No compose file content found in configuration");
        }
        const composeRegistryAuth = await resolveConfiguredRegistryAuth(
          uow,
          deployedResource,
          project.organizationId,
        );
        await dockerService.deployComposeStack(
          deployedResource,
          composeFile,
          appendLog,
          constraints,
          envVars,
          composeRegistryAuth,
        );
        const composeSmokeTest = await dockerService.runPostDeploySmokeTest(
          deployedResource,
          appendLog,
        );
        if (composeSmokeTest && !composeSmokeTest.healthy) {
          throw new Error(
            `Compose deployment smoke test failed: ${composeSmokeTest.message || "unhealthy service"}`,
          );
        }
        appendLog(
          resource.composeType === "compose"
            ? "Docker Compose project deployed successfully!\n"
            : "Compose Stack deployed successfully!\n",
        );
      } else if (resource.type === "application") {
        if (resource.provider === "docker-registry") {
          const imageRegistryAuth = await resolveConfiguredRegistryAuth(
            uow,
            resource,
            project.organizationId,
          );
          await dockerService.deployAppImage(
            resource,
            envVars,
            appendLog,
            constraints,
            imageRegistryAuth,
            revisionOptions,
          );
          appendLog("Application image deployed successfully!\n");
        } else {
          appendLog(
            `Setting up Git deployment provider: ${resource.provider}...\n`,
          );
          let cloneUrl = "";
          let gitEnvironment: Record<string, string> | undefined;
          let sshHostKeyFingerprint: string | undefined;
          let credentialsObj: Record<string, unknown> = {};
          try {
            credentialsObj = parseResourceCredentials(resource.credentials);
          } catch {}

          if (
            ["github", "gitlab", "bitbucket", "gitea"].includes(
              resource.provider,
            )
          ) {
            const gitProviderId = stringField(credentialsObj, "githubAccount");
            if (!gitProviderId) {
              throw new Error(
                "Git Provider not associated. Please configure repository connection.",
              );
            }

            const gitProvider = await uow.transaction(async (tx) => {
              return await tx.gitProviderRepository.findById(gitProviderId);
            });

            if (!gitProvider) {
              throw new Error("Associated Git Provider not found");
            }

            const parsedConfig: unknown = JSON.parse(gitProvider.config);
            const config: Record<string, unknown> = isRecord(parsedConfig)
              ? parsedConfig
              : {};
            const repository = stringField(credentialsObj, "repository");
            if (!repository) {
              throw new Error("Repository is empty in configuration");
            }

            if (resource.provider === "github") {
              appendLog("Retrieving GitHub App installation access token...\n");
              const token = await getInstallationToken(
                String(config.githubAppId),
                String(config.githubPrivateKey ?? ""),
                String(config.githubInstallationId ?? ""),
              );
              cloneUrl = `https://github.com/${repository}.git`;
              gitEnvironment = createGitBasicAuthEnvironment(
                "x-access-token",
                token,
              );
            } else if (resource.provider === "gitlab") {
              appendLog("Connecting to GitLab using OAuth access token...\n");
              const token = String(config.accessToken ?? "");
              const gitlabHost = String(
                config.gitlabUrl ?? "https://gitlab.com",
              ).replace(/https?:\/\//, "");
              cloneUrl = `https://${gitlabHost}/${repository}.git`;
              gitEnvironment = createGitBasicAuthEnvironment("oauth2", token);
            } else if (resource.provider === "gitea") {
              appendLog("Connecting to Gitea using OAuth access token...\n");
              const token = String(config.accessToken ?? "");
              const giteaHost = String(config.giteaUrl ?? "").replace(
                /https?:\/\//,
                "",
              );
              cloneUrl = `https://${giteaHost}/${repository}.git`;
              gitEnvironment = createGitBasicAuthEnvironment("oauth2", token);
            } else if (resource.provider === "bitbucket") {
              appendLog("Connecting to Bitbucket using app password...\n");
              cloneUrl = `https://bitbucket.org/${repository}.git`;
              gitEnvironment = createGitBasicAuthEnvironment(
                String(config.bitbucketUsername ?? ""),
                String(config.appPassword ?? ""),
              );
            }
          } else if (resource.provider === "git") {
            cloneUrl = stringField(credentialsObj, "repositoryUrl") ?? "";
            if (!cloneUrl) {
              throw new Error("Repository URL is empty in configuration");
            }
            const source = removeGitUrlCredentials(cloneUrl);
            cloneUrl = source.cloneUrl;
            gitEnvironment = source.gitEnvironment;
            sshHostKeyFingerprint = stringField(
              credentialsObj,
              "sshHostKeyFingerprint",
            );

            const sshKeyId = stringField(credentialsObj, "sshKeyId");
            if (sshKeyId) {
              appendLog(
                "Retrieving SSH key credentials for authentication...\n",
              );
              const sshKey = await uow.transaction(async (tx) => {
                return await tx.sshKeyRepository.findById(sshKeyId);
              });

              if (!sshKey) {
                throw new Error("Configured SSH key not found in workspace");
              }

              appendLog("Decrypting private key...\n");
              const privateKey = decryptSecret({
                ciphertext: sshKey.privateKeyCiphertext,
                iv: sshKey.privateKeyIv,
                authTag: sshKey.privateKeyAuthTag,
                keyVersion: sshKey.privateKeyVersion,
              });

              const buildDir = path.join(process.cwd(), ".builds");
              fs.mkdirSync(buildDir, { recursive: true });
              tempSshKeyPath = path.join(buildDir, `ssh-key-${resource.id}`);
              fs.writeFileSync(tempSshKeyPath, `${privateKey.trim()}\n`, {
                mode: 0o600,
              });
            }
          } else if (resource.provider === "drop") {
            // Bypasses git setup, cloneUrl remains empty
          } else {
            throw new Error(
              `Unsupported deployment provider: ${resource.provider}`,
            );
          }

          if (isSshGitUrl(cloneUrl) && !sshHostKeyFingerprint) {
            throw new Error(
              "SSH Git deployments require a pinned host-key fingerprint",
            );
          }

          appendLog(
            "Triggering Docker container build pipeline for repository...\n",
          );
          const syncUseCase = new SyncUpstandConfigUseCase(uow);
          const currentResourceId = resource.id;
          await buildDockerService.deployAppGit(
            resource,
            envVars,
            cloneUrl,
            appendLog,
            tempSshKeyPath || undefined,
            constraints,
            registryInfo,
            targetDestinationDocker,
            sourceRevision,
            async (clonePath: string) => {
              try {
                const upstandJsonPath = path.join(clonePath, "upstand.json");
                let configContent: string | null = null;
                if (fs.existsSync(upstandJsonPath)) {
                  configContent = fs.readFileSync(upstandJsonPath, "utf-8");
                }

                if (configContent) {
                  await syncUseCase.execute({
                    resourceId: currentResourceId,
                    configContentOrObject: configContent,
                    onLog: appendLog,
                  });
                  const reloaded = await uow.transaction(async (tx) => {
                    return await tx.resourceRepository.findById(
                      currentResourceId,
                    );
                  });
                  if (reloaded) return reloaded;
                }
              } catch (syncErr: unknown) {
                appendLog(
                  `Warning: Failed to sync upstand.json configuration: ${errorMessage(syncErr)}\n`,
                );
              }
            },
            revisionOptions,
            buildEnvVars,
            gitEnvironment,
            sshHostKeyFingerprint,
            async (artifact) => {
              const mode = getConfiguredControlPlaneMode();
              const capabilities = getPlatformCapabilities(mode);
              const target =
                deployedResource.serverId &&
                !["local", "manager"].includes(deployedResource.serverId)
                  ? ({
                      kind: "remote-server" as const,
                      serverId: deployedResource.serverId,
                    } as const)
                  : ({ kind: "local" as const } as const);
              const buildLocation =
                deployedResource.buildServerId &&
                deployedResource.buildServerId !== deployedResource.serverId
                  ? ({
                      kind: "remote-builder" as const,
                      serverId: deployedResource.buildServerId,
                    } as const)
                  : target.kind === "local"
                    ? ({ kind: "control-plane" as const } as const)
                    : ({ kind: "target" as const } as const);
              assertRuntimeCapability({
                mode,
                target: target.kind,
                runtime: "docker",
                buildLocation: buildLocation.kind,
              });
              const plan = DeploymentPlanSchema.parse({
                version: 1,
                target,
                runtime: "docker",
                buildLocation,
                ownership: capabilities.dataOwnership,
                sourceRevision: artifact.sourceRevision,
                configurationVersion: artifact.configurationVersion,
                buildConfig: artifact.buildConfig,
                detectorVersion: artifact.detectorVersion,
                artifact: {
                  digest: artifact.digest,
                  reference: artifact.reference,
                },
                createdAt: new Date().toISOString(),
              });
              const stored = await uow.deploymentRepository.setPlanIfAbsent(
                deploymentId,
                plan,
              );
              if (!stored) {
                const existing =
                  await uow.deploymentRepository.findById(deploymentId);
                const existingPlan = existing?.deploymentPlan;
                const comparable = (value: typeof plan) => ({
                  ...value,
                  createdAt: "",
                });
                if (
                  !existingPlan ||
                  JSON.stringify(comparable(existingPlan)) !==
                    JSON.stringify(comparable(plan))
                ) {
                  throw new Error(
                    "Deployment plan is immutable and the resolved build no longer matches it",
                  );
                }
              }
              appendLog(
                `[Plan] Locked ${target.kind}/${plan.runtime} deployment to ${plan.artifact.digest}.\n`,
              );
            },
          );
          appendLog(
            "Build compiled successfully and Swarm Service registered.\n",
          );
        }
      }

      if (resource.type === "application") {
        appendLog(
          "Verifying container convergence and health status before switching traffic...\n",
        );
        const convergence = await dockerService.waitForServiceConvergence(
          deployedResource,
          {
            destinationDocker: targetDestinationDocker,
            serviceNameOverride: revisionServiceName,
            onLog: appendLog,
          },
        );

        if (!convergence.healthy) {
          appendLog(
            `\n⚠️ Convergence verification failed: ${convergence.message || "Container failed health check"}.\n`,
          );
          appendLog(
            "Triggering Automated Rollback Engine to preserve zero-downtime availability...\n",
          );
          try {
            if (stagedDelivery && revisionServiceName) {
              await dockerService.removeServiceRevision(
                deployedResource,
                revisionServiceName,
              );
            } else {
              await dockerService.rollbackService(deployedResource);
            }
            appendLog(
              "Automated Rollback Engine: Successfully reverted Swarm service to previous healthy container image. ✅\n",
            );
            appendLog(
              "Caddy routing safely maintained on previous container image (0 dropped connections).\n",
            );
          } catch (rollbackErr: unknown) {
            appendLog(
              `Warning: Automated rollback encountered an issue: ${errorMessage(rollbackErr)}\n`,
            );
          }
          throw new Error(
            `Container failed convergence verification within monitor window: ${convergence.message || "Unhealthy status"}. Automated Rollback Engine executed.`,
          );
        }

        const advancedConfig =
          typeof deployedResource.advancedConfig === "string"
            ? JSON.parse(deployedResource.advancedConfig)
            : deployedResource.advancedConfig || {};

        if (
          advancedConfig.preDeployHook?.enabled &&
          advancedConfig.preDeployHook.command
        ) {
          const timeoutSeconds =
            advancedConfig.preDeployHook.timeoutSeconds ?? 300;
          appendLog(
            `Executing Pre-Deploy Hook command: '${advancedConfig.preDeployHook.command}' (timeout: ${timeoutSeconds}s)...\n`,
          );
          try {
            const hookTargetService = revisionServiceName || baseServiceName;
            let hookResult: {
              output?: string;
              stderr?: string;
              exitCode?: number;
            } = {};
            if (typeof dockerService.execContainerCommand === "function") {
              hookResult = await dockerService.execContainerCommand(
                { kind: "local", name: "Target" },
                hookTargetService,
                advancedConfig.preDeployHook.command,
                {
                  timeoutSeconds,
                  onLog: (chunk) => appendLog(chunk),
                },
                deployedResource.id,
              );
            } else if (supportsDockerHookService(dockerService)) {
              const output = await dockerService.runCommandInResourceContainer(
                deployedResource,
                advancedConfig.preDeployHook.command,
                undefined,
                { timeoutSeconds },
              );
              hookResult = { output, exitCode: 0 };
              if (output) appendLog(`${output}\n`);
            }
            if (hookResult.exitCode && hookResult.exitCode !== 0) {
              throw new Error(
                hookResult.stderr ||
                  `Command exited with code ${hookResult.exitCode}`,
              );
            }
            appendLog("Pre-Deploy Hook completed successfully! ✅\n");
          } catch (hookErr: unknown) {
            appendLog(`❌ Pre-Deploy Hook failed: ${errorMessage(hookErr)}\n`);
            appendLog("Triggering automatic deployment rollback...\n");
            try {
              if (stagedDelivery && revisionServiceName) {
                await dockerService.removeServiceRevision(
                  deployedResource,
                  revisionServiceName,
                );
              } else {
                await dockerService.rollbackService(deployedResource);
              }
            } catch (rollbackErr: unknown) {
              appendLog(
                `Warning: Rollback issue: ${errorMessage(rollbackErr)}\n`,
              );
            }
            throw new Error(
              `Pre-Deploy Hook execution failed: ${errorMessage(hookErr)}`,
            );
          }
        }

        if (stagedDelivery && revisionServiceName) {
          const originalAdvancedConfig = deployedResource.advancedConfig;
          let revisionPromoted = false;
          const percentages = stagedTrafficPercentages(
            deploymentStrategy.type,
            deploymentStrategy.canaryPercent,
            deploymentStrategy.steps,
          );
          try {
            for (const percentage of percentages) {
              appendLog(
                `Routing ${percentage}% of traffic to revision '${revisionServiceName}'...\n`,
              );
              await syncCaddyRouting(
                uow,
                caddyService,
                deployedResource,
                previewDeploymentId,
                trafficSplitConfig(
                  originalAdvancedConfig,
                  baseServiceName,
                  revisionServiceName,
                  percentage,
                ),
              );
              const metricFailure = await verifyProgressiveDeliveryMetrics(
                uow,
                { ...deployedResource, appName: revisionServiceName },
                deploymentStrategy.bakeTimeSeconds,
              );
              if (metricFailure) {
                appendLog(
                  `Progressive delivery metric gate failed: ${metricFailure}.\n`,
                );
                if (deploymentStrategy.automaticRollback) {
                  throw new Error(
                    `Progressive delivery rolled back after metric gate failure: ${metricFailure}`,
                  );
                }
                appendLog(
                  "Automatic rollback is disabled; continuing promotion after the metric warning.\n",
                );
              }
            }

            appendLog(
              "Promoting the verified revision into the stable service...\n",
            );
            await dockerService.promoteServiceRevision(
              deployedResource,
              revisionServiceName,
            );
            revisionPromoted = true;
            const promotedConvergence =
              await dockerService.waitForServiceConvergence(deployedResource, {
                destinationDocker: targetDestinationDocker,
                onLog: appendLog,
              });
            if (!promotedConvergence.healthy) {
              throw new Error(
                `Stable service failed after revision promotion: ${promotedConvergence.message || "unhealthy service"}`,
              );
            }
            await syncCaddyRouting(
              uow,
              caddyService,
              deployedResource,
              previewDeploymentId,
              originalAdvancedConfig,
            );
            await dockerService
              .removeServiceRevision(deployedResource, revisionServiceName)
              .catch((cleanupError) => {
                appendLog(
                  `Warning: verified revision cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
                );
              });
          } catch (revisionError) {
            if (revisionPromoted) {
              await dockerService
                .rollbackService(deployedResource)
                .catch((rollbackError) => {
                  appendLog(
                    `Warning: failed to roll back the promoted stable service: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}\n`,
                  );
                });
            }
            await syncCaddyRouting(
              uow,
              caddyService,
              deployedResource,
              previewDeploymentId,
              originalAdvancedConfig,
            ).catch((routingError) => {
              appendLog(
                `Warning: failed to restore stable traffic routing: ${routingError instanceof Error ? routingError.message : String(routingError)}\n`,
              );
            });
            await dockerService
              .removeServiceRevision(deployedResource, revisionServiceName)
              .catch((cleanupError) => {
                appendLog(
                  `Warning: failed to clean up failed revision: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
                );
              });
            throw revisionError;
          }
        }

        appendLog(
          "Container health check passed healthy! Proceeding with Health-Check Gated Traffic Switching in Caddy...\n",
        );
      }

      appendLog("Updating Caddy Web Server reverse proxy configuration...\n");
      const updatedResource = await uow.transaction(async (tx) => {
        return await tx.resourceRepository.findById(resourceId);
      });
      if (updatedResource) {
        await syncCaddyRouting(
          uow,
          caddyService,
          updatedResource,
          previewDeploymentId,
        );
        appendLog("Caddy routing reloaded successfully.\n");
      }

      if (
        advancedConfig.postDeployHook?.enabled &&
        advancedConfig.postDeployHook.command
      ) {
        const timeoutSeconds =
          advancedConfig.postDeployHook.timeoutSeconds ?? 300;
        const failureMode = advancedConfig.postDeployHook.onFailure ?? "warn";
        appendLog(
          `Executing Post-Deploy Hook command: '${advancedConfig.postDeployHook.command}' (timeout: ${timeoutSeconds}s, failure policy: ${failureMode})...\n`,
        );
        try {
          let hookResult: {
            output?: string;
            stderr?: string;
            exitCode?: number;
          } = {};
          if (typeof dockerService.execContainerCommand === "function") {
            hookResult = await dockerService.execContainerCommand(
              { kind: "local", name: "Target" },
              baseServiceName,
              advancedConfig.postDeployHook.command,
              {
                timeoutSeconds,
                onLog: (chunk) => appendLog(chunk),
              },
              deployedResource.id,
            );
          } else if (supportsDockerHookService(dockerService)) {
            const output = await dockerService.runCommandInResourceContainer(
              deployedResource,
              advancedConfig.postDeployHook.command,
              undefined,
              { timeoutSeconds },
            );
            hookResult = { output, exitCode: 0 };
            if (output) appendLog(`${output}\n`);
          }

          if (hookResult.exitCode && hookResult.exitCode !== 0) {
            const errMsg = `Post-Deploy Hook exited with code ${hookResult.exitCode}${hookResult.stderr ? `: ${hookResult.stderr}` : ""}`;
            if (failureMode === "fail") {
              throw new Error(errMsg);
            }
            appendLog(`⚠️ ${errMsg}\n`);
          } else {
            appendLog("Post-Deploy Hook completed successfully! ✅\n");
          }
        } catch (postHookErr: unknown) {
          const errMsg = `Post-Deploy Hook failed: ${errorMessage(postHookErr)}`;
          if (failureMode === "fail") {
            appendLog(`❌ ${errMsg}\n`);
            throw new Error(errMsg);
          }
          appendLog(`⚠️ ${errMsg}\n`);
        }
      }

      appendLog("Pipeline completed successfully! ✅\n");
      resourceLock.assertOwned();
      await flushFinalLogs("success");
      await publishDeploymentOutcome("success").catch((error) => {
        log.error({
          message: "Unable to queue deployment success notification",
          err: error instanceof Error ? error.message : error,
        });
      });
    } catch (err: unknown) {
      if (executionLeaseLost) return;
      const cancelled = Boolean(
        await redis.get(`upstand:deployment:cancel:${deploymentId}`),
      );
      appendLog(
        cancelled
          ? `\nDeployment cancelled by user. 🛑\nReason: ${errorMessage(err)}\n`
          : `\nDeployment failed! ❌\nError: ${errorMessage(err)}\n`,
      );
      log.error({
        message: "Queue worker deploy pipeline error",
        err: errorMessage(err),
      });
      const currentDeployment =
        await uow.deploymentRepository.findById(deploymentId);
      const errorText = errorMessage(err);
      const shouldRetry =
        !cancelled &&
        Boolean(
          currentDeployment &&
            currentDeployment.attempt < currentDeployment.maxAttempts,
        );
      if (shouldRetry) {
        const baseSeconds = numberField(retryBaseSeconds, 2);
        const maxSeconds = numberField(
          retryMaxSeconds,
          Math.max(baseSeconds, 60),
        );
        const retryDelaySeconds = Math.min(
          maxSeconds,
          baseSeconds * 2 ** Math.max(0, (job.attemptsMade ?? 1) - 1),
        );
        appendLog(
          `Retrying deployment (attempt ${(currentDeployment?.attempt ?? 0) + 1} of ${currentDeployment?.maxAttempts ?? 1}) after a transient failure.\n`,
        );
        await flushFinalLogs("retrying", errorText, retryDelaySeconds);
        throw err;
      }
      await flushFinalLogs(cancelled ? "cancelled" : "failed", errorText);
      if (!cancelled) {
        await publishDeploymentOutcome("failed", err).catch(
          (notificationError) => {
            log.error({
              message: "Unable to queue deployment failure notification",
              err:
                notificationError instanceof Error
                  ? notificationError.message
                  : notificationError,
            });
          },
        );
      }
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (tempSshKeyPath && fs.existsSync(tempSshKeyPath)) {
        try {
          fs.unlinkSync(tempSshKeyPath);
        } catch (e: unknown) {
          log.error({
            message: "Failed to clean up temp SSH key file",
            err: errorMessage(e),
          });
        }
      }
      await scope.dispose();
      remoteCliCleanup?.();
      buildCliCleanup?.();
      await redis.del(`upstand:deployment:cancel:${deploymentId}`);
      await resourceLock.release().catch((error) => {
        log.error({
          message: "Failed to release resource deployment lock",
          resourceId,
          deploymentId,
          err: error,
        });
      });
    }
  }
}

function resourceMatchesServer(
  resource: Pick<ResourceRoutingProjection, "serverId">,
  serverId: string | null | undefined,
): boolean {
  if (serverId && !["local", "manager"].includes(serverId)) {
    return resource.serverId === serverId;
  }
  return !resource.serverId || ["local", "manager"].includes(resource.serverId);
}

async function syncCaddyRouting(
  uow: IUnitOfWork,
  caddyService: CaddyService,
  deployedResource: Resource,
  previewDeploymentId?: string,
  advancedConfigOverride?: string,
): Promise<void> {
  if (!deployedResource.domains && !previewDeploymentId) return;
  const [resources, settings, allPreviews] = await uow.transaction(
    async (tx) => [
      tx.resourceRepository.findForCaddyByDeploymentServerId
        ? await tx.resourceRepository.findForCaddyByDeploymentServerId(
            deployedResource.serverId,
          )
        : await tx.resourceRepository.findMany(),
      await tx.webServerSettingsRepository.findGlobal(),
      tx.previewDeploymentRepository.findForCaddy
        ? await tx.previewDeploymentRepository.findForCaddy(previewDeploymentId)
        : await tx.previewDeploymentRepository.findMany(),
    ],
  );
  const routingResources = resources
    .filter((candidate) =>
      resourceMatchesServer(candidate, deployedResource.serverId),
    )
    .map((candidate) =>
      candidate.id === deployedResource.id
        ? {
            ...candidate,
            ...deployedResource,
            advancedConfig:
              advancedConfigOverride ?? deployedResource.advancedConfig,
          }
        : candidate,
    );
  const activePreviews = allPreviews.filter(
    (preview) =>
      preview.status === "success" || preview.id === previewDeploymentId,
  );
  const routingPreviews: CaddyResource[] = [];
  for (const preview of activePreviews) {
    const parentResource = resources.find(
      (candidate) => candidate.id === preview.resourceId,
    );
    if (
      !parentResource ||
      !resourceMatchesServer(parentResource, deployedResource.serverId)
    )
      continue;
    const parentDomain = parseFirstDomain(parentResource.domains || "[]");
    const parentPort =
      typeof parentDomain.port === "number" ? parentDomain.port : 80;
    const parentHttps = parentDomain.https === true;
    const parentCertificateType =
      typeof parentDomain.certificateType === "string"
        ? parentDomain.certificateType
        : "letsencrypt";
    const parentCertificateId =
      typeof parentDomain.certificateId === "string"
        ? parentDomain.certificateId
        : undefined;
    const parentMiddlewares = Array.isArray(parentDomain.middlewares)
      ? parentDomain.middlewares.filter(
          (middleware): middleware is string => typeof middleware === "string",
        )
      : [];
    routingPreviews.push({
      id: preview.id,
      name: preview.appName,
      type: "application",
      appName: preview.appName,
      domains: JSON.stringify([
        {
          host: preview.domain,
          path: "/",
          port: parentPort,
          https: parentHttps,
          certificateType: parentCertificateType,
          ...(parentCertificateId !== undefined && {
            certificateId: parentCertificateId,
          }),
          middlewares: parentMiddlewares,
        },
      ]),
      composeType: parentResource.composeType,
      advancedConfig: parentResource.advancedConfig,
    });
  }
  const certificates = (await uow.certificateRepository.findAll?.()) ?? [];
  await caddyService.syncResourceConfigs(
    [...routingResources, ...routingPreviews],
    settings || {},
    certificates,
  );
}

function stagedTrafficPercentages(
  type: "rolling" | "canary" | "blue-green" | "progressive",
  canaryPercent: number | undefined,
  steps: number[],
): number[] {
  if (type === "rolling") return [100];
  if (type === "blue-green") return [100];
  if (type === "canary") return [...new Set([canaryPercent ?? 10, 100])];
  const normalized = [
    ...new Set(steps.filter((step) => step > 0 && step <= 100)),
  ].sort((a, b) => a - b);
  return [...new Set([...normalized, 100])];
}

function trafficSplitConfig(
  originalAdvancedConfig: string | undefined,
  baseServiceName: string,
  revisionServiceName: string,
  revisionPercent: number,
): string {
  const config = parseResourceAdvancedConfig(originalAdvancedConfig);
  config.trafficSplits =
    revisionPercent >= 100
      ? [{ serviceName: revisionServiceName, weight: 100 }]
      : [
          {
            serviceName: baseServiceName,
            weight: Math.max(1, 100 - revisionPercent),
          },
          {
            serviceName: revisionServiceName,
            weight: Math.max(1, revisionPercent),
          },
        ];
  return JSON.stringify(config);
}

async function resolveGitSource(
  resource: Resource,
  uow: IUnitOfWork,
  appendLog: (log: string) => void,
): Promise<GitSource> {
  const credentials = parseResourceCredentials(resource.credentials);
  let cloneUrl = "";
  let sshKeyPath: string | undefined;
  let gitEnvironment: Record<string, string> | undefined;
  let sshHostKeyFingerprint: string | undefined;

  if (
    ["github", "gitlab", "bitbucket", "gitea", "generic"].includes(
      resource.provider,
    )
  ) {
    const gitProviderId = stringField(credentials, "githubAccount");
    if (!gitProviderId) {
      throw new Error(
        "Git Provider not associated. Please configure repository connection.",
      );
    }

    const gitProvider = await uow.transaction((tx) =>
      tx.gitProviderRepository.findById(gitProviderId),
    );
    if (!gitProvider) throw new Error("Associated Git Provider not found");
    const parsedConfig: unknown = JSON.parse(gitProvider.config);
    const config: Record<string, unknown> = isRecord(parsedConfig)
      ? parsedConfig
      : {};
    const repository = stringField(credentials, "repository");
    if (!repository) {
      throw new Error("Repository is empty in configuration");
    }

    if (resource.provider === "github") {
      appendLog("Retrieving GitHub App installation access token...\n");
      const token = await getInstallationToken(
        String(config.githubAppId),
        String(config.githubPrivateKey ?? ""),
        String(config.githubInstallationId ?? ""),
      );
      cloneUrl = `https://github.com/${repository}.git`;
      gitEnvironment = createGitBasicAuthEnvironment("x-access-token", token);
    } else if (resource.provider === "gitlab") {
      appendLog("Connecting to GitLab using OAuth access token...\n");
      const gitlabHost = String(
        config.gitlabUrl ?? "https://gitlab.com",
      ).replace(/https?:\/\//, "");
      cloneUrl = `https://${gitlabHost}/${repository}.git`;
      gitEnvironment = createGitBasicAuthEnvironment(
        "oauth2",
        String(config.accessToken ?? ""),
      );
    } else if (resource.provider === "gitea") {
      appendLog("Connecting to Gitea using OAuth access token...\n");
      const giteaHost = String(config.giteaUrl ?? "").replace(
        /https?:\/\//,
        "",
      );
      cloneUrl = `https://${giteaHost}/${repository}.git`;
      gitEnvironment = createGitBasicAuthEnvironment(
        "oauth2",
        String(config.accessToken ?? ""),
      );
    } else if (resource.provider === "generic") {
      appendLog(
        "Connecting to generic Git repository (Forgejo/Sourcehut/Bare Git)...\n",
      );
      cloneUrl =
        stringField(credentials, "repositoryUrl") ??
        stringField(config, "gitUrl") ??
        "";
      if (!cloneUrl)
        throw new Error("Repository URL is empty in generic Git configuration");
      const source = removeGitUrlCredentials(cloneUrl);
      cloneUrl = source.cloneUrl;
      gitEnvironment = source.gitEnvironment;
      sshHostKeyFingerprint =
        stringField(credentials, "sshHostKeyFingerprint") ??
        stringField(config, "sshHostKeyFingerprint");
      const sshKeyId =
        stringField(credentials, "sshKeyId") ?? stringField(config, "sshKeyId");
      if (sshKeyId) {
        const sshKey = await uow.transaction((tx) =>
          tx.sshKeyRepository.findById(sshKeyId),
        );
        if (!sshKey)
          throw new Error(
            "Configured SSH key for generic Git provider was not found",
          );
        const privateKey = decryptSecret({
          ciphertext: sshKey.privateKeyCiphertext,
          iv: sshKey.privateKeyIv,
          authTag: sshKey.privateKeyAuthTag,
          keyVersion: sshKey.privateKeyVersion,
        });
        const buildDir = path.join(process.cwd(), ".builds");
        fs.mkdirSync(buildDir, { recursive: true });
        sshKeyPath = path.join(buildDir, `ssh-key-${resource.id}`);
        fs.writeFileSync(sshKeyPath, `${privateKey.trim()}\n`, { mode: 0o600 });
      } else if (stringField(config, "accessToken")) {
        gitEnvironment = createGitBasicAuthEnvironment(
          "oauth2",
          stringField(config, "accessToken") ?? "",
        );
      }
    } else {
      appendLog("Connecting to Bitbucket using app password...\n");
      cloneUrl = `https://bitbucket.org/${repository}.git`;
      gitEnvironment = createGitBasicAuthEnvironment(
        String(config.bitbucketUsername ?? ""),
        String(config.appPassword ?? ""),
      );
    }
  } else if (resource.provider === "git") {
    cloneUrl = stringField(credentials, "repositoryUrl") ?? "";
    if (!cloneUrl) throw new Error("Repository URL is empty in configuration");
    const source = removeGitUrlCredentials(cloneUrl);
    cloneUrl = source.cloneUrl;
    gitEnvironment = source.gitEnvironment;
    sshHostKeyFingerprint = stringField(credentials, "sshHostKeyFingerprint");

    const sshKeyId = stringField(credentials, "sshKeyId");
    if (sshKeyId) {
      const sshKey = await uow.transaction((tx) =>
        tx.sshKeyRepository.findById(sshKeyId),
      );
      if (!sshKey) throw new Error("Configured SSH key not found in workspace");
      const privateKey = decryptSecret({
        ciphertext: sshKey.privateKeyCiphertext,
        iv: sshKey.privateKeyIv,
        authTag: sshKey.privateKeyAuthTag,
        keyVersion: sshKey.privateKeyVersion,
      });
      const buildDir = path.join(process.cwd(), ".builds");
      fs.mkdirSync(buildDir, { recursive: true });
      sshKeyPath = path.join(buildDir, `ssh-key-${resource.id}`);
      fs.writeFileSync(sshKeyPath, `${privateKey.trim()}\n`, { mode: 0o600 });
    }
  } else {
    throw new Error(
      `Unsupported Compose deployment provider: ${resource.provider}`,
    );
  }

  if (isSshGitUrl(cloneUrl) && !sshHostKeyFingerprint) {
    throw new Error(
      "SSH Git deployments require a pinned host-key fingerprint",
    );
  }

  return {
    cloneUrl,
    sshKeyPath,
    gitEnvironment,
    sshHostKeyFingerprint,
  };
}
