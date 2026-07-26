import type { IUnitOfWork } from "@upstand/domain";
import type {
  DeploymentHistoryResult,
  GetDeploymentsUseCase,
} from "./get-deployments.usecase";
import type { GetQueueUseCase, QueueJobResult } from "./get-queue.usecase";
import { findOrganizationResourceIds } from "./organization-resources.helper";

export class GetRequestsUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly getDeployments: GetDeploymentsUseCase,
    private readonly getQueue: GetQueueUseCase,
  ) {}

  async execute(organizationId: string): Promise<{
    deployments: DeploymentHistoryResult[];
    queue: QueueJobResult[];
    generatedAt: Date;
  }> {
    const resourceIds = await findOrganizationResourceIds(
      this.uow,
      organizationId,
    );
    const [deployments, queue] = await Promise.all([
      this.getDeployments.execute(resourceIds),
      this.getQueue.execute(resourceIds),
    ]);
    return {
      deployments,
      queue,
      generatedAt: new Date(),
    };
  }
}
