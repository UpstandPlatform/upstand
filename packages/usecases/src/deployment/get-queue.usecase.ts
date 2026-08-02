import type { IUnitOfWork } from "@upstand/domain";
import { redis } from "@upstand/redis";
import { Queue } from "bullmq";
import { getDeploymentQueueName } from "./deployment-queue-name";
import {
  findOrganizationResourceIds,
  mapWithConcurrency,
} from "./organization-resources.helper";

export interface QueueJobResult {
  id: string;
  deploymentId: string;
  label: string;
  type: string;
  state: string;
  addedAt: string;
  processedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  resourceId: string;
  resourceName: string;
  serverId: string;
  serverName: string;
}

export class GetQueueUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async executeForOrganization(
    organizationId: string,
  ): Promise<QueueJobResult[]> {
    const resourceIds = await findOrganizationResourceIds(
      this.uow,
      organizationId,
    );
    return this.execute(resourceIds);
  }

  async execute(resourceIds?: readonly string[]): Promise<QueueJobResult[]> {
    // 1. Determine all active queues (servers)
    const servers = await this.uow.serverBuildSettingsRepository.findMany();
    const serverIds = servers.map((s) => s.id);

    // If empty, default to local
    if (serverIds.length === 0) {
      serverIds.push("local");
    }

    const resources = resourceIds
      ? this.uow.resourceRepository.findSummariesByIds
        ? await this.uow.resourceRepository.findSummariesByIds(resourceIds)
        : (
            await mapWithConcurrency(resourceIds, (resourceId) =>
              this.uow.resourceRepository.findById(resourceId),
            )
          ).filter((resource) => resource !== null)
      : await this.uow.resourceRepository.findMany();
    const resourceMap = new Map(resources.map((r) => [r.id, r]));
    for (const resource of resources) {
      if (resource.serverId) serverIds.push(resource.serverId);
    }
    const queuedDeployments = resourceIds
      ? await this.uow.deploymentRepository.findRecentByResourceIds(
          resourceIds,
          500,
        )
      : await this.uow.deploymentRepository.findRecent(500);
    for (const deployment of queuedDeployments) {
      if (deployment.serverId) serverIds.push(deployment.serverId);
    }
    const uniqueServerIds = [...new Set(serverIds)];

    const serverMap = new Map(servers.map((s) => [s.id, s]));

    const allJobs: QueueJobResult[] = [];
    const representedDeploymentIds = new Set<string>();
    const deploymentIdsToLabel = new Set<string>();

    for (const serverId of uniqueServerIds) {
      const server = serverMap.get(serverId);
      const serverName =
        server?.hostname ||
        (serverId === "local" ? "Upstand Server" : `Server ${serverId}`);
      const queueName = getDeploymentQueueName(serverId);
      const queue = new Queue(queueName, { connection: redis });

      try {
        const jobs = await queue.getJobs(
          ["active", "waiting", "delayed", "failed"],
          0,
          249,
          false,
        );
        for (const job of jobs) {
          const resourceId = job.data?.resourceId || "";
          if (resourceIds && !resourceIds.includes(resourceId)) continue;
          const resource = resourceMap.get(resourceId);
          const state = await job.getState();

          // Get deployment details from DB if possible to show rich title
          const deploymentId = job.data?.deploymentId;
          if (deploymentId) {
            representedDeploymentIds.add(deploymentId);
            deploymentIdsToLabel.add(deploymentId);
          }
          const label = "Manual deployment";

          allJobs.push({
            id: job.id || "",
            deploymentId: deploymentId || job.id || "",
            label,
            type: resource?.type || "application",
            state,
            addedAt: new Date(job.timestamp).toISOString(),
            processedAt: job.processedOn
              ? new Date(job.processedOn).toISOString()
              : null,
            finishedAt: job.finishedOn
              ? new Date(job.finishedOn).toISOString()
              : null,
            error: job.failedReason || null,
            resourceId,
            resourceName: resource?.name || "Unknown Service",
            serverId,
            serverName,
          });
        }
      } catch (err: unknown) {
        log.error({
          message: `Failed to read jobs from queue ${queueName}`,
          err,
        });
      } finally {
        await queue.close();
      }
    }

    if (deploymentIdsToLabel.size > 0) {
      const deploymentIds = [...deploymentIdsToLabel];
      const deployments = this.uow.deploymentRepository.findByIds
        ? await this.uow.deploymentRepository.findByIds(deploymentIds)
        : (
            await mapWithConcurrency(deploymentIds, (deploymentId) =>
              this.uow.deploymentRepository.findById(deploymentId),
            )
          ).filter(
            (deployment): deployment is NonNullable<typeof deployment> =>
              deployment !== null,
          );
      const titleById = new Map(
        deployments.map((deployment) => [deployment.id, deployment.title]),
      );
      for (const job of allJobs) {
        const title = titleById.get(job.deploymentId);
        if (title) job.label = title;
      }
    }

    // The deployment row is created before the transactional outbox publishes
    // the BullMQ job. Reconcile queued rows here so the UI does not disagree
    // with deployment history during that hand-off (or after a transient
    // publisher outage).
    for (const deployment of queuedDeployments) {
      if (
        deployment.status !== "queued" ||
        representedDeploymentIds.has(deployment.id)
      ) {
        continue;
      }
      const resource = resourceMap.get(deployment.resourceId);
      if (!resource) continue;
      allJobs.push({
        id: deployment.id,
        deploymentId: deployment.id,
        label: deployment.title,
        type: resource.type,
        state: "waiting",
        addedAt: deployment.createdAt.toISOString(),
        processedAt: null,
        finishedAt: null,
        error: null,
        resourceId: resource.id,
        resourceName: resource.name,
        serverId: deployment.serverId || resource.serverId || "local",
        serverName: deployment.serverName || "Upstand Server",
      });
    }

    // Sort jobs: active first, then waiting, then delayed/failed. Inside each, by addedAt descending
    const statePriority: Record<string, number> = {
      active: 1,
      waiting: 2,
      delayed: 3,
      failed: 4,
    };

    allJobs.sort((a, b) => {
      const pA = statePriority[a.state] || 99;
      const pB = statePriority[b.state] || 99;
      if (pA !== pB) return pA - pB;
      return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
    });

    return allJobs;
  }
}

// Simple fallback logging import wrapper
import { log } from "evlog";
