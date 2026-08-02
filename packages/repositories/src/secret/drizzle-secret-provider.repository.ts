import { secretProvider } from "@upstand/db";
import type {
  ISecretProviderRepository,
  SecretProvider,
  SecretProviderType,
} from "@upstand/domain";
import { and, eq } from "drizzle-orm";
import {
  BaseRepository,
  MAX_REPOSITORY_READS,
} from "../shared/base.repository";
import type { Executor } from "../shared/types";

export class DrizzleSecretProviderRepository
  extends BaseRepository<typeof secretProvider, SecretProvider, never>
  implements ISecretProviderRepository
{
  constructor(executor: Executor) {
    super(executor, secretProvider);
  }

  async findById(id: string): Promise<SecretProvider | null> {
    const [row] = await this.executor
      .select()
      .from(secretProvider)
      .where(eq(secretProvider.id, id))
      .limit(1);
    return row ? this.public(row) : null;
  }
  async findEnabledConfiguration(
    id: string,
    organizationId: string,
  ): Promise<{
    provider: SecretProviderType;
    encryptedConfiguration: string;
  } | null> {
    const [row] = await this.executor
      .select({
        provider: secretProvider.provider,
        encryptedConfiguration: secretProvider.encryptedConfiguration,
      })
      .from(secretProvider)
      .where(
        and(
          eq(secretProvider.id, id),
          eq(secretProvider.organizationId, organizationId),
          eq(secretProvider.enabled, "true"),
        ),
      )
      .limit(1);
    return row
      ? {
          provider: row.provider as SecretProviderType,
          encryptedConfiguration: row.encryptedConfiguration,
        }
      : null;
  }
  async findByOrganizationId(
    organizationId: string,
  ): Promise<SecretProvider[]> {
    const rows = await this.executor
      .select()
      .from(secretProvider)
      .where(eq(secretProvider.organizationId, organizationId))
      .limit(MAX_REPOSITORY_READS + 1);
    if (rows.length > MAX_REPOSITORY_READS) {
      throw new Error(
        "Secret provider discovery exceeded the maximum supported row count",
      );
    }
    return rows.map((row) => this.public(row));
  }
  async create(data: {
    id: string;
    organizationId: string;
    name: string;
    provider: SecretProviderType;
    encryptedConfiguration: string;
    enabled?: boolean;
  }): Promise<SecretProvider> {
    const [row] = await this.executor
      .insert(secretProvider)
      .values({
        ...data,
        provider: data.provider,
        enabled: data.enabled === false ? "false" : "true",
      })
      .returning();
    if (!row) throw new Error("secret provider insert returned no row");
    return this.public(row);
  }
  async updateById(
    id: string,
    patch: {
      name?: string;
      encryptedConfiguration?: string;
      enabled?: boolean;
    },
  ): Promise<SecretProvider | null> {
    const { enabled, ...rest } = patch;
    const [row] = await this.executor
      .update(secretProvider)
      .set({
        ...rest,
        ...(enabled === undefined
          ? {}
          : { enabled: enabled ? "true" : "false" }),
      })
      .where(eq(secretProvider.id, id))
      .returning();
    return row ? this.public(row) : null;
  }
  async deleteById(id: string): Promise<boolean> {
    return (
      (
        await this.executor
          .delete(secretProvider)
          .where(eq(secretProvider.id, id))
          .returning({ id: secretProvider.id })
      ).length > 0
    );
  }
  private public(row: typeof secretProvider.$inferSelect): SecretProvider {
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      provider: row.provider as SecretProviderType,
      enabled: row.enabled === "true",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
