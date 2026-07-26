import { previewDeployment } from "@upstand/db";
import type {
  CreatePreviewDeploymentDTO,
  IPreviewDeploymentRepository,
  PreviewDeployment,
} from "@upstand/domain";
import { and, eq } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

export class DrizzlePreviewDeploymentRepository
  extends BaseRepository<
    typeof previewDeployment,
    PreviewDeployment,
    CreatePreviewDeploymentDTO
  >
  implements IPreviewDeploymentRepository
{
  constructor(executor: Executor) {
    super(executor, previewDeployment);
  }

  async findByResourceId(resourceId: string): Promise<PreviewDeployment[]> {
    return this.findMany({
      where: eq(previewDeployment.resourceId, resourceId),
    });
  }

  async findByPullRequestId(
    resourceId: string,
    pullRequestId: number,
  ): Promise<PreviewDeployment | null> {
    return this.findOne(
      and(
        eq(previewDeployment.resourceId, resourceId),
        eq(previewDeployment.pullRequestId, pullRequestId),
      ),
    );
  }
}
