import {
  type Deployment,
  type IUnitOfWork,
  parseResourceAdvancedConfig,
} from "@upstand/domain";

export interface ReconcileStaleDeploymentsInput {
  now?: Date;
  fallbackStaleAfterSeconds?: number;
  limit?: number;
}

export interface ReconcileStaleDeploymentsResult {
  inspected: number;
  markedStale: number;
  deploymentIds: string[];
}

/**
 * Marks execution records that have lost their worker heartbeat. This is
 * deliberately separate from queue processing so a control-plane restart can
 * repair abandoned state without needing the original BullMQ job.
 */
export class ReconcileStaleDeploymentsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: ReconcileStaleDeploymentsInput = {},
  ): Promise<ReconcileStaleDeploymentsResult> {
    const repository = this.uow.deploymentRepository;
    if (!repository.findStaleRunning || !repository.markStale) {
      return { inspected: 0, markedStale: 0, deploymentIds: [] };
    }

    const now = input.now ?? new Date();
    const fallbackSeconds = Math.max(
      60,
      Math.min(input.fallbackStaleAfterSeconds ?? 1800, 86400),
    );
    const candidates = await repository.findStaleRunning(
      new Date(now.getTime() - 86400 * 1_000),
      input.limit ?? 500,
    );
    const marked: string[] = [];

    for (const deployment of candidates) {
      const resource = await this.uow.resourceRepository.findById(
        deployment.resourceId,
      );
      const staleAfterSeconds = resource
        ? parseResourceAdvancedConfig(resource.advancedConfig)
            .deploymentReliability.staleAfterSeconds
        : fallbackSeconds;
      const staleBefore = new Date(now.getTime() - staleAfterSeconds * 1_000);
      const heartbeat = deployment.heartbeatAt ?? deployment.updatedAt;
      if (heartbeat >= staleBefore) continue;

      const updated = await repository.markStale(
        deployment.id,
        staleBefore,
        `Deployment worker heartbeat expired after ${staleAfterSeconds} seconds`,
      );
      if (!updated) continue;
      marked.push(deployment.id);
      if (resource && resource.status === "running") {
        await this.uow.resourceRepository.updateById(resource.id, {
          status: "stopped",
        });
      }
    }

    return {
      inspected: candidates.length,
      markedStale: marked.length,
      deploymentIds: marked,
    };
  }
}

export function isDeploymentTerminal(deployment: Pick<Deployment, "status">) {
  return ["success", "failed", "cancelled", "stale"].includes(
    deployment.status,
  );
}
