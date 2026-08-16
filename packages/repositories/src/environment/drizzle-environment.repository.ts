import { environment, environmentSecret } from "@upstand/db";
import type {
  CreateEnvironmentDTO,
  Environment,
  EnvironmentSummaryProjection,
  IEnvironmentRepository,
  UpdateEnvironmentDTO,
} from "@upstand/domain";
import { eq, inArray, sql } from "drizzle-orm";
import { DrizzleSecretVersionRepository } from "../secret/drizzle-secret-version.repository";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

const MAX_ENVIRONMENT_READS = 10_000;

export class DrizzleEnvironmentRepository
  extends BaseRepository<typeof environment, Environment, CreateEnvironmentDTO>
  implements IEnvironmentRepository
{
  constructor(executor: Executor) {
    super(executor, environment);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Joins environment rows with their environment_secret rows and returns
   * hydrated Environment objects. Accepts raw environment DB rows.
   */
  private async hydrateWithSecrets(
    rows: (typeof environment.$inferSelect)[],
  ): Promise<Environment[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const secretRows = await this.executor
      .select()
      .from(environmentSecret)
      .where(inArray(environmentSecret.environmentId, ids));
    const secretsById = new Map(secretRows.map((s) => [s.environmentId, s]));
    return rows.map((row) => {
      const secret = secretsById.get(row.id);
      return {
        ...row,
        envVars: secret?.envVars ?? undefined,
      } as Environment;
    });
  }

  // ─── Overridden base finders (hydrate secrets) ────────────────────────────

  override async findById(id: string): Promise<Environment | null> {
    const [row] = await this.executor
      .select()
      .from(environment)
      .where(eq(environment.id, id))
      .limit(1);
    if (!row) return null;
    const hydrated = await this.hydrateWithSecrets([row]);
    return hydrated[0] ?? null;
  }

  async findSummaryById(
    id: string,
  ): Promise<EnvironmentSummaryProjection | null> {
    const [row] = await this.executor
      .select({
        id: environment.id,
        projectId: environment.projectId,
        parentEnvironmentId: environment.parentEnvironmentId,
        inheritsVariables: environment.inheritsVariables,
        name: environment.name,
        slug: environment.slug,
        description: environment.description,
        isDefault: environment.isDefault,
        isProtected: environment.isProtected,
        resourceCount: environment.resourceCount,
        createdAt: environment.createdAt,
        updatedAt: environment.updatedAt,
        envVarsConfigured: sql<boolean>`${environmentSecret.environmentId} IS NOT NULL`,
      })
      .from(environment)
      .leftJoin(
        environmentSecret,
        eq(environmentSecret.environmentId, environment.id),
      )
      .where(eq(environment.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByProjectId(projectId: string): Promise<Environment[]> {
    const rows = await this.executor
      .select()
      .from(environment)
      .where(eq(environment.projectId, projectId))
      .limit(MAX_ENVIRONMENT_READS + 1);
    assertEnvironmentReadLimit(rows.length);
    return this.hydrateWithSecrets(rows);
  }

  async findSummariesByProjectId(
    projectId: string,
  ): Promise<EnvironmentSummaryProjection[]> {
    const rows = await this.executor
      .select({
        id: environment.id,
        projectId: environment.projectId,
        parentEnvironmentId: environment.parentEnvironmentId,
        inheritsVariables: environment.inheritsVariables,
        name: environment.name,
        slug: environment.slug,
        description: environment.description,
        isDefault: environment.isDefault,
        isProtected: environment.isProtected,
        resourceCount: environment.resourceCount,
        createdAt: environment.createdAt,
        updatedAt: environment.updatedAt,
        envVarsConfigured: sql<boolean>`${environmentSecret.environmentId} IS NOT NULL`,
      })
      .from(environment)
      .leftJoin(
        environmentSecret,
        eq(environmentSecret.environmentId, environment.id),
      )
      .where(eq(environment.projectId, projectId))
      .limit(MAX_ENVIRONMENT_READS + 1);
    assertEnvironmentReadLimit(rows.length);
    return rows;
  }

  async findIdsByProjectId(projectId: string): Promise<string[]> {
    const rows = await this.executor
      .select({ id: environment.id })
      .from(environment)
      .where(eq(environment.projectId, projectId))
      .limit(MAX_ENVIRONMENT_READS + 1);
    assertEnvironmentReadLimit(rows.length);
    return rows.map((row) => row.id);
  }

  async findAncestors(id: string): Promise<Environment[]> {
    const chain: Environment[] = [];
    const seen = new Set<string>();
    let currentId: string | null = id;
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const current = await this.findById(currentId);
      if (!current) break;
      chain.push(current);
      currentId = current.parentEnvironmentId ?? null;
    }
    return chain;
  }

  override async findMany(_options?: unknown): Promise<Environment[]> {
    const rows = await this.executor
      .select()
      .from(environment)
      .limit(MAX_ENVIRONMENT_READS + 1);
    assertEnvironmentReadLimit(rows.length);
    return this.hydrateWithSecrets(rows);
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  async incrementResourceCount(id: string, delta: number): Promise<void> {
    await this.executor
      .update(environment)
      .set({
        resourceCount: sql`GREATEST(0, ${environment.resourceCount} + ${delta})`,
      })
      .where(eq(environment.id, id));
  }

  /**
   * Updates mutable environment fields and optionally upserts the encrypted
   * project-level environment variables in environment_secret.
   */
  async updateEnvironment(
    id: string,
    patch: UpdateEnvironmentDTO,
  ): Promise<Environment | null> {
    const { envVars, ...corePatch } = patch;

    // Update core environment row when there are core fields to change.
    if (Object.keys(corePatch).length > 0) {
      await this.executor
        .update(environment)
        .set(corePatch)
        .where(eq(environment.id, id));
    }

    // Upsert environment_secret when env vars are included in the patch.
    if (envVars !== undefined) {
      const [current] = await this.executor
        .select()
        .from(environmentSecret)
        .where(eq(environmentSecret.environmentId, id))
        .limit(1);
      const nextVersion = (current?.version ?? 0) + 1;
      await this.executor
        .insert(environmentSecret)
        .values({
          environmentId: id,
          envVars,
          version: nextVersion,
        })
        .onConflictDoUpdate({
          target: environmentSecret.environmentId,
          set: { envVars, version: nextVersion, updatedAt: new Date() },
        });
      await new DrizzleSecretVersionRepository(this.executor).append({
        scopeType: "environment",
        scopeId: id,
        version: nextVersion,
        envVars,
        source: "local",
      });
    }

    return this.findById(id);
  }
}

function assertEnvironmentReadLimit(rowCount: number): void {
  if (rowCount > MAX_ENVIRONMENT_READS) {
    throw new Error(
      "Environment discovery exceeded the maximum supported environment count",
    );
  }
}
