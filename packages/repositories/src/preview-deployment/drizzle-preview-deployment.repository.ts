import { previewDeployment } from "@upstand/db";
import type {
  CreatePreviewDeploymentDTO,
  IPreviewDeploymentRepository,
  PreviewDeployment,
  PreviewRoutingProjection,
} from "@upstand/domain";
import { and, eq, or } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

const MAX_CADDY_PREVIEWS = 10_000;

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

  async findForCaddy(
    includePreviewId?: string,
  ): Promise<PreviewRoutingProjection[]> {
    const statusCondition = includePreviewId
      ? or(
          eq(previewDeployment.status, "success"),
          eq(previewDeployment.id, includePreviewId),
        )
      : eq(previewDeployment.status, "success");
    const rows = await this.executor
      .select({
        id: previewDeployment.id,
        resourceId: previewDeployment.resourceId,
        appName: previewDeployment.appName,
        status: previewDeployment.status,
        domain: previewDeployment.domain,
      })
      .from(previewDeployment)
      .where(statusCondition)
      .limit(MAX_CADDY_PREVIEWS + 1);
    if (rows.length > MAX_CADDY_PREVIEWS) {
      throw new Error(
        "Caddy preview discovery exceeded the maximum supported preview count",
      );
    }
    return rows as PreviewRoutingProjection[];
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
