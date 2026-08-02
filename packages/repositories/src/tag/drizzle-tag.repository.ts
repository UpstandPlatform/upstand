import { resourceTag, tag } from "@upstand/db";
import {
  type CreateTagDTO,
  type ITagRepository,
  type Tag,
  TagSchema,
} from "@upstand/domain";
import { and, eq } from "drizzle-orm";
import {
  BaseRepository,
  MAX_REPOSITORY_READS,
} from "../shared/base.repository";
import type { Executor } from "../shared/types";

export class DrizzleTagRepository
  extends BaseRepository<typeof tag, Tag, CreateTagDTO>
  implements ITagRepository
{
  constructor(executor: Executor) {
    super(executor, tag);
  }

  async findByOrganizationId(organizationId: string): Promise<Tag[]> {
    return this.findMany({ where: eq(tag.organizationId, organizationId) });
  }

  async findByResourceId(resourceId: string): Promise<Tag[]> {
    const rows = await this.executor
      .select({
        id: tag.id,
        organizationId: tag.organizationId,
        name: tag.name,
        color: tag.color,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
      })
      .from(resourceTag)
      .innerJoin(tag, eq(resourceTag.tagId, tag.id))
      .where(eq(resourceTag.resourceId, resourceId))
      .limit(MAX_REPOSITORY_READS + 1);
    if (rows.length > MAX_REPOSITORY_READS) {
      throw new Error(
        "Resource tag discovery exceeded the maximum supported row count",
      );
    }
    return rows.map((row) => TagSchema.parse(row));
  }

  async attachToResource(resourceId: string, tagId: string): Promise<void> {
    await this.executor
      .insert(resourceTag)
      .values({ resourceId, tagId })
      .onConflictDoNothing();
  }

  async detachFromResource(resourceId: string, tagId: string): Promise<void> {
    await this.executor
      .delete(resourceTag)
      .where(
        and(
          eq(resourceTag.resourceId, resourceId),
          eq(resourceTag.tagId, tagId),
        ),
      );
  }
}
