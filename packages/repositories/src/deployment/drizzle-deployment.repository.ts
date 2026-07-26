import { deployment } from "@upstand/db";
import type {
  CreateDeploymentDTO,
  Deployment,
  IDeploymentRepository,
  UpdateDeploymentDTO,
} from "@upstand/domain";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

export class DrizzleDeploymentRepository
  extends BaseRepository<typeof deployment, Deployment, CreateDeploymentDTO>
  implements IDeploymentRepository
{
  constructor(executor: Executor) {
    super(executor, deployment);
  }

  async findRecent(limit = 500): Promise<Deployment[]> {
    return super.findMany({
      orderBy: desc(deployment.createdAt),
      limit: Math.max(1, Math.min(limit, 1_000)),
    });
  }

  async findRecentByResourceIds(
    resourceIds: readonly string[],
    limit = 500,
  ): Promise<Deployment[]> {
    if (resourceIds.length === 0) return [];
    return super.findMany({
      where: inArray(deployment.resourceId, [...resourceIds]),
      orderBy: desc(deployment.createdAt),
      limit: Math.max(1, Math.min(limit, 1_000)),
    });
  }

  async findByStatus(status: string, limit = 500): Promise<Deployment[]> {
    return super.findMany({
      where: eq(deployment.status, status),
      orderBy: desc(deployment.createdAt),
      limit: Math.max(1, Math.min(limit, 1_000)),
    });
  }

  async findByResourceId(resourceId: string): Promise<Deployment[]> {
    return super.findMany({
      where: eq(deployment.resourceId, resourceId),
      orderBy: desc(deployment.createdAt),
      limit: 500,
    });
  }

  async claimForExecution(
    id: string,
    executionToken: string,
    now: Date,
    leaseMs = 30 * 60_000,
  ): Promise<Deployment | null> {
    const staleBefore = new Date(now.getTime() - leaseMs);
    const [claimed] = await this.executor
      .update(deployment)
      .set({
        status: "running",
        executionToken,
        attempt: sql`${deployment.attempt} + 1`,
        heartbeatAt: now,
        retryAt: null,
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(deployment.id, id),
          or(
            eq(deployment.status, "queued"),
            eq(deployment.status, "retrying"),
            and(
              eq(deployment.status, "running"),
              lt(deployment.updatedAt, staleBefore),
            ),
          ),
        ),
      )
      .returning();
    return claimed ? (claimed as Deployment) : null;
  }

  async updateByIdOwned(
    id: string,
    executionToken: string,
    patch: UpdateDeploymentDTO,
  ): Promise<Deployment | null> {
    const [updated] = await this.executor
      .update(deployment)
      .set(patch)
      .where(
        and(
          eq(deployment.id, id),
          eq(deployment.status, "running"),
          eq(deployment.executionToken, executionToken),
        ),
      )
      .returning();
    return updated ? (updated as Deployment) : null;
  }

  async heartbeatOwned(
    id: string,
    executionToken: string,
    now: Date,
  ): Promise<Deployment | null> {
    const [updated] = await this.executor
      .update(deployment)
      .set({ heartbeatAt: now, updatedAt: now })
      .where(
        and(
          eq(deployment.id, id),
          eq(deployment.status, "running"),
          eq(deployment.executionToken, executionToken),
        ),
      )
      .returning();
    return updated ? (updated as Deployment) : null;
  }

  async findStaleRunning(
    staleBefore: Date,
    limit = 500,
  ): Promise<Deployment[]> {
    return super.findMany({
      where: and(
        eq(deployment.status, "running"),
        or(
          lt(deployment.heartbeatAt, staleBefore),
          and(
            isNull(deployment.heartbeatAt),
            lt(deployment.updatedAt, staleBefore),
          ),
        ),
      ),
      orderBy: desc(deployment.updatedAt),
      limit: Math.max(1, Math.min(limit, 1_000)),
    });
  }

  async markStale(
    id: string,
    staleBefore: Date,
    message: string,
  ): Promise<Deployment | null> {
    const [updated] = await this.executor
      .update(deployment)
      .set({
        status: "stale",
        lastError: message,
        heartbeatAt: null,
        executionToken: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(deployment.id, id),
          eq(deployment.status, "running"),
          or(
            lt(deployment.heartbeatAt, staleBefore),
            and(
              isNull(deployment.heartbeatAt),
              lt(deployment.updatedAt, staleBefore),
            ),
          ),
        ),
      )
      .returning();
    return updated ? (updated as Deployment) : null;
  }
}
