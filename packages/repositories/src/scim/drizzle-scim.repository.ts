import { randomUUID } from "node:crypto";
import { member, organization, session, user } from "@upstand/db/schema/auth";
import { scimProvider } from "@upstand/db/schema/scim";
import type {
  CreateScimProviderInput,
  IScimRepository,
  ProvisionScimMembershipInput,
  ScimMembershipFilter,
  ScimMembershipPatch,
  ScimMembershipRecord,
  ScimProviderRecord,
  ScimUserRecord,
} from "@upstand/domain";
import { ConflictError } from "@upstand/domain";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import { isPostgresUniqueViolation } from "../shared/database-errors";
import type { Executor } from "../shared/types";

type MembershipRow = {
  member: typeof member.$inferSelect;
  user: typeof user.$inferSelect;
};

function mapUser(value: typeof user.$inferSelect): ScimUserRecord {
  return {
    id: value.id,
    email: value.email,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function mapMembership(row: MembershipRow): ScimMembershipRecord {
  return {
    member: {
      id: row.member.id,
      organizationId: row.member.organizationId,
      userId: row.member.userId,
      role: row.member.role,
      permissions: row.member.permissions,
      createdAt: row.member.createdAt,
      scimActive: row.member.scimActive,
      scimExternalId: row.member.scimExternalId,
      scimDisplayName: row.member.scimDisplayName,
    },
    user: mapUser(row.user),
  };
}

function mapProvider(
  row: typeof scimProvider.$inferSelect,
): ScimProviderRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    providerId: row.providerId,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleScimRepository
  extends BaseRepository<typeof scimProvider>
  implements IScimRepository
{
  constructor(executor: Executor) {
    super(executor, scimProvider);
  }

  async listProviders(organizationId: string): Promise<ScimProviderRecord[]> {
    const rows = await this.executor
      .select()
      .from(scimProvider)
      .where(eq(scimProvider.organizationId, organizationId));
    return rows.map(mapProvider);
  }

  async createProvider(
    input: CreateScimProviderInput,
  ): Promise<ScimProviderRecord | null> {
    try {
      const [row] = await this.executor
        .insert(scimProvider)
        .values(input)
        .returning();
      return row ? mapProvider(row) : null;
    } catch (error) {
      if (
        isPostgresUniqueViolation(
          error,
          "scim_provider_organization_provider_uidx",
        ) ||
        isPostgresUniqueViolation(error, "scim_provider_token_hash_uidx")
      ) {
        throw new ConflictError("SCIM provider already exists");
      }
      throw error;
    }
  }

  async rotateProviderToken(
    organizationId: string,
    id: string,
    tokenHash: string,
    tokenPrefix: string,
    updatedAt: Date,
  ): Promise<ScimProviderRecord | null> {
    try {
      const [row] = await this.executor
        .update(scimProvider)
        .set({ tokenHash, tokenPrefix, updatedAt })
        .where(
          and(
            eq(scimProvider.id, id),
            eq(scimProvider.organizationId, organizationId),
          ),
        )
        .returning();
      return row ? mapProvider(row) : null;
    } catch (error) {
      if (isPostgresUniqueViolation(error, "scim_provider_token_hash_uidx")) {
        throw new ConflictError("SCIM provider token already exists");
      }
      throw error;
    }
  }

  async deleteProvider(organizationId: string, id: string): Promise<boolean> {
    const deleted = await this.executor
      .delete(scimProvider)
      .where(
        and(
          eq(scimProvider.id, id),
          eq(scimProvider.organizationId, organizationId),
        ),
      )
      .returning({ id: scimProvider.id });
    return deleted.length > 0;
  }

  async findProvider(
    organizationId: string,
    tokenHash: string,
  ): Promise<{ id: string } | null> {
    const [row] = await this.executor
      .select({ id: scimProvider.id })
      .from(scimProvider)
      .where(
        and(
          eq(scimProvider.organizationId, organizationId),
          eq(scimProvider.tokenHash, tokenHash),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findUserByEmail(email: string): Promise<ScimUserRecord | null> {
    const [row] = await this.executor
      .select()
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    return row ? mapUser(row) : null;
  }

  async findMembership(
    organizationId: string,
    userId: string,
  ): Promise<ScimMembershipRecord | null> {
    const [row] = await this.executor
      .select({ member, user })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        and(eq(member.organizationId, organizationId), eq(user.id, userId)),
      )
      .limit(1);
    return row ? mapMembership(row) : null;
  }

  async listMemberships(
    organizationId: string,
    options: {
      filter?: ScimMembershipFilter;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<ScimMembershipRecord[]> {
    const query = this.executor
      .select({ member, user })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .$dynamic();
    query.where(this.membershipWhere(organizationId, options.filter));
    query.orderBy(asc(member.createdAt), asc(member.id));
    query.limit(Math.min(Math.max(options.limit ?? 1000, 1), 1000));
    query.offset(Math.max(options.offset ?? 0, 0));
    return (await query).map(mapMembership);
  }

  async countMemberships(
    organizationId: string,
    filter?: ScimMembershipFilter,
  ): Promise<number> {
    const [row] = await this.executor
      .select({ value: count() })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(this.membershipWhere(organizationId, filter));
    return row?.value ?? 0;
  }

  async provisionMembership(
    input: ProvisionScimMembershipInput,
  ): Promise<ScimMembershipRecord | null> {
    try {
      return await this.executor.transaction(async (tx) => {
        const txRepository = new DrizzleScimRepository(tx);
        if (input.removePersonalOrganizations) {
          const personalOrganizations = await tx
            .select({ id: organization.id })
            .from(member)
            .innerJoin(organization, eq(member.organizationId, organization.id))
            .where(
              and(
                eq(member.userId, input.userId),
                eq(organization.metadata, JSON.stringify({ isPersonal: true })),
              ),
            );
          if (personalOrganizations.length > 0) {
            await tx.delete(organization).where(
              inArray(
                organization.id,
                personalOrganizations.map(({ id }) => id),
              ),
            );
          }
        }

        await tx.insert(member).values({
          id: randomUUID(),
          organizationId: input.organizationId,
          userId: input.userId,
          role: "member",
          permissions: null,
          scimActive: input.scimActive,
          scimExternalId: input.scimExternalId,
          scimDisplayName: input.scimDisplayName,
          createdAt: new Date(),
        });
        return txRepository.findMembership(input.organizationId, input.userId);
      });
    } catch (error) {
      if (isPostgresUniqueViolation(error, "member_organization_user_uidx")) {
        throw new ConflictError("SCIM membership already exists");
      }
      throw error;
    }
  }

  async updateMembership(
    organizationId: string,
    userId: string,
    patch: ScimMembershipPatch,
  ): Promise<boolean> {
    if (Object.keys(patch).length === 0) {
      return (await this.findMembership(organizationId, userId)) !== null;
    }
    const rows = await this.executor
      .update(member)
      .set(patch)
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.userId, userId),
        ),
      )
      .returning({ id: member.id });
    return rows.length > 0;
  }

  async deleteMembershipAndSessions(
    organizationId: string,
    userId: string,
  ): Promise<boolean> {
    return this.executor.transaction(async (tx) => {
      const deleted = await tx
        .delete(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, userId),
          ),
        )
        .returning({ id: member.id });
      if (deleted.length === 0) return false;
      await tx.delete(session).where(eq(session.userId, userId));
      return true;
    });
  }

  async deleteUser(userId: string): Promise<boolean> {
    const deleted = await this.executor
      .delete(user)
      .where(eq(user.id, userId))
      .returning({ id: user.id });
    return deleted.length > 0;
  }

  private membershipWhere(
    organizationId: string,
    filter?: ScimMembershipFilter,
  ) {
    const conditions = [eq(member.organizationId, organizationId)];
    if (filter?.attribute === "userName") {
      conditions.push(
        sql`lower(${user.email}) = ${filter.value.toLowerCase()}`,
      );
    } else if (filter?.attribute === "externalId") {
      conditions.push(
        sql`lower(coalesce(${member.scimExternalId}, '')) = ${filter.value.toLowerCase()}`,
      );
    } else if (filter?.attribute === "active") {
      conditions.push(eq(member.scimActive, filter.value));
    }
    return and(...conditions);
  }
}
