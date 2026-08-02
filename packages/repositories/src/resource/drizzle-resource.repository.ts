import {
  environment,
  project,
  resource,
  resourceConfiguration,
  resourceSecret,
} from "@upstand/db";
import type {
  CreateResourceDTO,
  IResourceRepository,
  Resource,
  ResourceAutoscalingProjection,
  ResourceRoutingProjection,
  ResourceSummaryProjection,
} from "@upstand/domain";
import {
  RESOURCE_STATE_VERSION,
  serializeResourceConfiguration,
  ValidationError,
} from "@upstand/domain";
import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { DrizzleSecretVersionRepository } from "../secret/drizzle-secret-version.repository";
import { isPostgresUniqueViolation } from "../shared/database-errors";
import { normalizeStoredSecret } from "../shared/secret-normalization";
import type { Executor } from "../shared/types";

const MAX_CADDY_ROUTING_RESOURCES = 10_000;
const MAX_AUTOSCALING_RESOURCES = 10_000;
const MAX_HYDRATED_RESOURCE_READS = 10_000;

const DEFAULT_CONFIGURATION = serializeResourceConfiguration({});
const DEFAULT_BUILD_CONFIG = DEFAULT_CONFIGURATION.buildConfig;
const DEFAULT_ADVANCED_CONFIG = DEFAULT_CONFIGURATION.advancedConfig;
const DEFAULT_WATCH_PATHS = DEFAULT_CONFIGURATION.watchPaths;
const DEFAULT_DOMAINS = DEFAULT_CONFIGURATION.domains;
const DEFAULT_ENV_VARS = "{}";
const MAX_IN_CLAUSE_ITEMS = 1_000;

type ResourceRow = typeof resource.$inferSelect;

export class DrizzleResourceRepository implements IResourceRepository {
  constructor(private readonly executor: Executor) {}

  async findById(id: string): Promise<Resource | null> {
    const [row] = await this.executor
      .select()
      .from(resource)
      .where(eq(resource.id, id))
      .limit(1);
    return row ? ((await this.hydrate([row]))[0] ?? null) : null;
  }

  async findByAppName(appName: string): Promise<Resource | null> {
    const [row] = await this.executor
      .select()
      .from(resource)
      .where(eq(resource.appName, appName))
      .limit(1);
    return row ? ((await this.hydrate([row]))[0] ?? null) : null;
  }

  async findByWebhookTokenHash(hash: string): Promise<Resource | null> {
    const [row] = await this.executor
      .select()
      .from(resource)
      .where(eq(resource.webhookTokenHash, hash))
      .limit(1);
    return row ? ((await this.hydrate([row]))[0] ?? null) : null;
  }

  async findByEnvironmentId(environmentId: string): Promise<Resource[]> {
    const rows = await this.executor
      .select()
      .from(resource)
      .where(eq(resource.environmentId, environmentId))
      .limit(MAX_HYDRATED_RESOURCE_READS + 1);
    assertHydratedResourceReadLimit(rows.length);
    return this.hydrate(rows);
  }

  async findIdsByEnvironmentId(environmentId: string): Promise<string[]> {
    const rows = await this.executor
      .select({ id: resource.id })
      .from(resource)
      .where(eq(resource.environmentId, environmentId))
      .limit(MAX_HYDRATED_RESOURCE_READS + 1);
    assertHydratedResourceReadLimit(rows.length);
    return rows.map((row) => row.id);
  }

  async findByProvider(provider: string): Promise<Resource[]> {
    const rows = await this.executor
      .select()
      .from(resource)
      .where(eq(resource.provider, provider))
      .limit(MAX_HYDRATED_RESOURCE_READS + 1);
    assertHydratedResourceReadLimit(rows.length);
    return this.hydrate(rows);
  }

  async findByDockerRegistryId(registryId: string): Promise<Resource[]> {
    const rows = await this.executor
      .select()
      .from(resource)
      .where(
        or(
          eq(resource.buildRegistryId, registryId),
          eq(resource.rollbackRegistryId, registryId),
        ),
      )
      .limit(MAX_HYDRATED_RESOURCE_READS + 1);
    assertHydratedResourceReadLimit(rows.length);
    return this.hydrate(rows);
  }

  async findByServerId(serverId: string): Promise<Resource[]> {
    const rows = await this.executor
      .select()
      .from(resource)
      .where(
        or(
          eq(resource.serverId, serverId),
          eq(resource.buildServerId, serverId),
        ),
      )
      .limit(MAX_HYDRATED_RESOURCE_READS + 1);
    assertHydratedResourceReadLimit(rows.length);
    return this.hydrate(rows);
  }

  async findByDeploymentServerId(
    serverId: string | null | undefined,
  ): Promise<Resource[]> {
    const isLocal = !serverId || serverId === "local" || serverId === "manager";
    const rows = await this.executor
      .select()
      .from(resource)
      .where(
        isLocal
          ? or(
              isNull(resource.serverId),
              eq(resource.serverId, "local"),
              eq(resource.serverId, "manager"),
            )
          : eq(resource.serverId, serverId),
      )
      .limit(MAX_HYDRATED_RESOURCE_READS + 1);
    assertHydratedResourceReadLimit(rows.length);
    return this.hydrate(rows);
  }

  async findForCaddy(): Promise<ResourceRoutingProjection[]> {
    return this.findRoutingProjection();
  }

  async findForAutoscaling(): Promise<ResourceAutoscalingProjection[]> {
    const rows = await this.executor
      .select({
        id: resource.id,
        name: resource.name,
        type: resource.type,
        status: resource.status,
        appName: resource.appName,
        composeType: resource.composeType,
        serverId: resource.serverId,
        domains: resourceConfiguration.domains,
        advancedConfig: resourceConfiguration.advancedConfig,
      })
      .from(resource)
      .innerJoin(
        resourceConfiguration,
        eq(resourceConfiguration.resourceId, resource.id),
      )
      .where(eq(resource.type, "application"))
      .limit(MAX_AUTOSCALING_RESOURCES + 1);

    if (rows.length > MAX_AUTOSCALING_RESOURCES) {
      throw new Error(
        "Autoscaling resource discovery exceeded the maximum supported resource count",
      );
    }

    return rows.map((row) => ({
      ...row,
      domains: row.domains ?? DEFAULT_DOMAINS,
      advancedConfig: row.advancedConfig ?? DEFAULT_ADVANCED_CONFIG,
    })) as ResourceAutoscalingProjection[];
  }

  async findForCaddyByDeploymentServerId(
    serverId: string | null | undefined,
  ): Promise<ResourceRoutingProjection[]> {
    const isLocal = !serverId || serverId === "local" || serverId === "manager";
    return this.findRoutingProjection(
      isLocal
        ? or(
            isNull(resource.serverId),
            eq(resource.serverId, "local"),
            eq(resource.serverId, "manager"),
          )
        : eq(resource.serverId, serverId),
    );
  }

  async findSummariesByIds(
    ids: readonly string[],
  ): Promise<ResourceSummaryProjection[]> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length > MAX_HYDRATED_RESOURCE_READS) {
      throw new Error(
        "Resource summary discovery exceeded the maximum supported resource count",
      );
    }
    const results: ResourceSummaryProjection[] = [];
    for (const batch of chunk(uniqueIds, MAX_IN_CLAUSE_ITEMS)) {
      const rows = await this.executor
        .select({
          id: resource.id,
          environmentId: resource.environmentId,
          name: resource.name,
          type: resource.type,
          serverId: resource.serverId,
        })
        .from(resource)
        .where(inArray(resource.id, batch));
      results.push(...rows);
    }
    return results;
  }

  async findIdsByOrganizationId(organizationId: string): Promise<string[]> {
    const rows = await this.executor
      .select({ id: resource.id })
      .from(resource)
      .innerJoin(environment, eq(resource.environmentId, environment.id))
      .innerJoin(project, eq(environment.projectId, project.id))
      .where(
        and(
          eq(project.organizationId, organizationId),
          isNull(project.archivedAt),
        ),
      )
      .limit(MAX_HYDRATED_RESOURCE_READS + 1);
    assertHydratedResourceReadLimit(rows.length);
    return rows.map((row) => row.id);
  }

  async checkDuplicateServiceKey(
    appName: string,
    excludeResourceId?: string,
  ): Promise<Resource | null> {
    const serviceKey = appName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");
    const conditions = [
      sql`regexp_replace(lower(trim(${resource.appName})), '[^a-z0-9_-]', '-', 'g') = ${serviceKey}`,
    ];
    if (excludeResourceId) conditions.push(ne(resource.id, excludeResourceId));
    const [duplicate] = await this.executor
      .select({ id: resource.id })
      .from(resource)
      .where(and(...conditions))
      .limit(1);
    return duplicate ? this.findById(duplicate.id) : null;
  }

  async findMany(): Promise<Resource[]> {
    const rows = await this.executor
      .select()
      .from(resource)
      .limit(MAX_HYDRATED_RESOURCE_READS + 1);
    assertHydratedResourceReadLimit(rows.length);
    return this.hydrate(rows);
  }

  async create(data: CreateResourceDTO): Promise<Resource> {
    const { configuration, secrets, core } = splitResourceValues(data);
    let row: ResourceRow | undefined;
    try {
      [row] = await this.executor
        .insert(resource)
        .values(toResourceInsert(core))
        .returning();
    } catch (error) {
      throwResourceConstraintError(error);
    }
    if (!row) throw new Error("create: resource insert returned no row");
    await this.insertOwnedState(
      row.id,
      mergeConfiguration(defaultConfiguration(), configuration),
      mergeSecrets(defaultSecrets(), secrets),
    );
    return (await this.findById(row.id)) as Resource;
  }

  async createMany(values: CreateResourceDTO[]): Promise<Resource[]> {
    if (values.length === 0) return [];
    const split = values.map(splitResourceValues);
    const rows = await this.executor
      .insert(resource)
      .values(split.map(({ core }) => toResourceInsert(core)))
      .returning();
    await Promise.all(
      rows.map((row, index) =>
        this.insertOwnedState(
          row.id,
          mergeConfiguration(
            defaultConfiguration(),
            split[index]?.configuration,
          ),
          mergeSecrets(defaultSecrets(), split[index]?.secrets),
        ),
      ),
    );
    return this.hydrate(rows);
  }

  async updateById(
    id: string,
    patch: Partial<CreateResourceDTO>,
  ): Promise<Resource | null> {
    const { configuration, secrets, core } = splitResourceValues(patch);
    if (Object.keys(core).length > 0) {
      try {
        await this.executor
          .update(resource)
          .set(core)
          .where(eq(resource.id, id));
      } catch (error) {
        throwResourceConstraintError(error);
      }
    }
    if (configuration) {
      await this.patchConfiguration(id, configuration);
    }
    if (secrets) {
      await this.patchSecrets(id, secrets);
    }
    return this.findById(id);
  }

  async updateByIdIfUpdatedAt(
    id: string,
    expectedUpdatedAt: Date,
    patch: Partial<CreateResourceDTO>,
  ): Promise<Resource | null> {
    // PostgreSQL timestamps can retain microseconds while JavaScript Date
    // values only retain milliseconds. Match the complete millisecond bucket
    // represented by the value read by the caller instead of requiring an
    // impossible byte-for-byte timestamp equality.
    const nextMillisecond = new Date(expectedUpdatedAt.getTime() + 1);
    const { configuration, secrets, core } = splitResourceValues(patch);
    const [claimed] = await this.executor
      .update(resource)
      .set({ ...core, updatedAt: new Date() })
      .where(
        and(
          eq(resource.id, id),
          gte(resource.updatedAt, expectedUpdatedAt),
          lt(resource.updatedAt, nextMillisecond),
        ),
      )
      .returning({ id: resource.id });
    if (!claimed) return null;
    if (configuration) await this.patchConfiguration(id, configuration);
    if (secrets) await this.patchSecrets(id, secrets);
    return this.findById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const deleted = await this.executor
      .delete(resource)
      .where(eq(resource.id, id))
      .returning({ id: resource.id });
    return deleted.length > 0;
  }

  async count(): Promise<number> {
    const [row] = await this.executor.select({ value: count() }).from(resource);
    return row?.value ?? 0;
  }

  private async findRoutingProjection(
    condition?: ReturnType<typeof eq> | ReturnType<typeof or>,
  ): Promise<ResourceRoutingProjection[]> {
    const rows = await this.executor
      .select({
        id: resource.id,
        name: resource.name,
        type: resource.type,
        appName: resource.appName,
        domains: resourceConfiguration.domains,
        composeType: resource.composeType,
        serverId: resource.serverId,
        previewPort: resource.previewPort,
        previewHttps: resource.previewHttps,
        advancedConfig: resourceConfiguration.advancedConfig,
      })
      .from(resource)
      .leftJoin(
        resourceConfiguration,
        eq(resourceConfiguration.resourceId, resource.id),
      )
      .where(condition)
      .limit(MAX_CADDY_ROUTING_RESOURCES + 1);

    if (rows.length > MAX_CADDY_ROUTING_RESOURCES) {
      throw new Error(
        "Caddy routing discovery exceeded the maximum supported resource count",
      );
    }

    return rows.map((row) => ({
      ...row,
      domains: row.domains ?? DEFAULT_DOMAINS,
      advancedConfig: row.advancedConfig ?? DEFAULT_ADVANCED_CONFIG,
    }));
  }

  private async hydrate(rows: ResourceRow[]): Promise<Resource[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [configRows, secretRows] = await Promise.all([
      this.executor
        .select()
        .from(resourceConfiguration)
        .where(inArray(resourceConfiguration.resourceId, ids)),
      this.executor
        .select()
        .from(resourceSecret)
        .where(inArray(resourceSecret.resourceId, ids)),
    ]);
    await Promise.all(
      secretRows.map(async (secret) => {
        const credentials = normalizeStoredSecret(secret.credentials);
        const buildSecrets = normalizeStoredSecret(secret.buildSecrets);
        const buildEnvVars = normalizeStoredSecret(secret.buildEnvVars);
        const envVars = normalizeStoredSecret(secret.envVars);
        if (
          typeof credentials === "string" &&
          credentials !== secret.credentials &&
          typeof secret.credentials === "string"
        ) {
          await this.executor
            .update(resourceSecret)
            .set({ credentials })
            .where(
              and(
                eq(resourceSecret.resourceId, secret.resourceId),
                eq(resourceSecret.credentials, secret.credentials),
              ),
            );
        }
        if (
          typeof buildSecrets === "string" &&
          buildSecrets !== secret.buildSecrets &&
          typeof secret.buildSecrets === "string"
        ) {
          await this.executor
            .update(resourceSecret)
            .set({ buildSecrets })
            .where(
              and(
                eq(resourceSecret.resourceId, secret.resourceId),
                eq(resourceSecret.buildSecrets, secret.buildSecrets),
              ),
            );
        }
        if (
          typeof buildEnvVars === "string" &&
          buildEnvVars !== secret.buildEnvVars &&
          typeof secret.buildEnvVars === "string"
        ) {
          await this.executor
            .update(resourceSecret)
            .set({ buildEnvVars })
            .where(
              and(
                eq(resourceSecret.resourceId, secret.resourceId),
                eq(resourceSecret.buildEnvVars, secret.buildEnvVars),
              ),
            );
        }
        if (envVars !== secret.envVars) {
          await this.executor
            .update(resourceSecret)
            .set({ envVars })
            .where(
              and(
                eq(resourceSecret.resourceId, secret.resourceId),
                eq(resourceSecret.envVars, secret.envVars),
              ),
            );
        }
      }),
    );
    const configs = new Map(
      configRows.map((configuration) => [
        configuration.resourceId,
        configuration,
      ]),
    );
    const secretsById = new Map(
      secretRows.map((secret) => [secret.resourceId, secret]),
    );
    return rows.map((row) => {
      const configuration = configs.get(row.id);
      const secret = secretsById.get(row.id);
      return {
        ...row,
        credentials: secret?.credentials ?? null,
        buildConfig: configuration?.buildConfig ?? DEFAULT_BUILD_CONFIG,
        buildSecrets: secret?.buildSecrets ?? null,
        buildEnvVars: secret?.buildEnvVars ?? null,
        advancedConfig:
          configuration?.advancedConfig ?? DEFAULT_ADVANCED_CONFIG,
        envVars: secret?.envVars ?? DEFAULT_ENV_VARS,
        domains: configuration?.domains ?? DEFAULT_DOMAINS,
        watchPaths: configuration?.watchPaths ?? DEFAULT_WATCH_PATHS,
      } as Resource;
    });
  }

  private async insertOwnedState(
    resourceId: string,
    configuration: ResourceConfigurationValues,
    secrets: ResourceSecretValues,
  ): Promise<void> {
    await this.executor.insert(resourceConfiguration).values({
      resourceId,
      ...configuration,
    });
    await this.executor.insert(resourceSecret).values({
      resourceId,
      ...secrets,
    });
    await new DrizzleSecretVersionRepository(this.executor).append({
      scopeType: "resource",
      scopeId: resourceId,
      version: secrets.version,
      credentials: secrets.credentials,
      buildSecrets: secrets.buildSecrets,
      buildEnvVars: secrets.buildEnvVars,
      envVars: secrets.envVars,
      source: "local",
    });
  }

  private async patchConfiguration(
    resourceId: string,
    patch: Partial<ResourceConfigurationValues>,
  ): Promise<void> {
    const defaultVals = defaultConfiguration();
    const insertVals = {
      resourceId,
      version: patch.version ?? defaultVals.version,
      buildConfig: patch.buildConfig ?? defaultVals.buildConfig,
      advancedConfig: patch.advancedConfig ?? defaultVals.advancedConfig,
      watchPaths: patch.watchPaths ?? defaultVals.watchPaths,
      domains: patch.domains ?? defaultVals.domains,
    };
    await this.executor
      .insert(resourceConfiguration)
      .values(insertVals)
      .onConflictDoUpdate({
        target: resourceConfiguration.resourceId,
        set: patch,
      });
  }

  private async patchSecrets(
    resourceId: string,
    patch: Partial<ResourceSecretValues>,
  ): Promise<void> {
    const defaultVals = defaultSecrets();
    const [current] = await this.executor
      .select()
      .from(resourceSecret)
      .where(eq(resourceSecret.resourceId, resourceId))
      .limit(1);
    const nextVersion = (current?.version ?? defaultVals.version) + 1;
    const insertVals = {
      resourceId,
      version: nextVersion,
      credentials: patch.credentials ?? defaultVals.credentials,
      buildSecrets: patch.buildSecrets ?? defaultVals.buildSecrets,
      buildEnvVars: patch.buildEnvVars ?? defaultVals.buildEnvVars,
      envVars: patch.envVars ?? defaultVals.envVars,
    };
    await this.executor
      .insert(resourceSecret)
      .values(insertVals)
      .onConflictDoUpdate({
        target: resourceSecret.resourceId,
        set: { ...patch, version: nextVersion },
      });
    const [updated] = await this.executor
      .select()
      .from(resourceSecret)
      .where(eq(resourceSecret.resourceId, resourceId))
      .limit(1);
    if (updated) {
      await new DrizzleSecretVersionRepository(this.executor).append({
        scopeType: "resource",
        scopeId: resourceId,
        version: nextVersion,
        credentials: updated.credentials,
        buildSecrets: updated.buildSecrets,
        buildEnvVars: updated.buildEnvVars,
        envVars: updated.envVars,
        source: "local",
      });
    }
  }
}

function assertHydratedResourceReadLimit(rowCount: number): void {
  if (rowCount > MAX_HYDRATED_RESOURCE_READS) {
    throw new Error(
      "Resource discovery exceeded the maximum supported resource count",
    );
  }
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push([...values.slice(index, index + size)]);
  }
  return chunks;
}

type ResourceConfigurationValues = {
  version: number;
  buildConfig: string;
  advancedConfig: string;
  watchPaths: string;
  domains: string;
};

type ResourceSecretValues = {
  version: number;
  credentials: string | null;
  buildSecrets: string | null;
  buildEnvVars: string | null;
  envVars: string;
};

function defaultConfiguration(): ResourceConfigurationValues {
  return {
    version: RESOURCE_STATE_VERSION,
    buildConfig: DEFAULT_BUILD_CONFIG,
    advancedConfig: DEFAULT_ADVANCED_CONFIG,
    watchPaths: DEFAULT_WATCH_PATHS,
    domains: DEFAULT_DOMAINS,
  };
}

function defaultSecrets(): ResourceSecretValues {
  return {
    version: RESOURCE_STATE_VERSION,
    credentials: null,
    buildSecrets: null,
    buildEnvVars: null,
    envVars: DEFAULT_ENV_VARS,
  };
}

function mergeConfiguration(
  current: ResourceConfigurationValues,
  patch: ResourceConfigurationPatch | undefined,
): ResourceConfigurationValues {
  return { ...current, ...patch };
}

function mergeSecrets(
  current: ResourceSecretValues,
  patch: ResourceSecretPatch | undefined,
): ResourceSecretValues {
  return { ...current, ...patch };
}

function splitResourceValues(values: Partial<CreateResourceDTO>) {
  const {
    credentials,
    buildConfig,
    buildSecrets,
    buildEnvVars,
    advancedConfig,
    envVars,
    domains,
    watchPaths,
    ...core
  } = values;
  const configuration =
    buildConfig !== undefined ||
    advancedConfig !== undefined ||
    domains !== undefined ||
    watchPaths !== undefined
      ? {
          version: RESOURCE_STATE_VERSION,
          ...(buildConfig !== undefined ? { buildConfig } : {}),
          ...(advancedConfig !== undefined ? { advancedConfig } : {}),
          ...(domains !== undefined ? { domains } : {}),
          ...(watchPaths !== undefined ? { watchPaths } : {}),
        }
      : undefined;
  const secrets =
    credentials !== undefined ||
    buildSecrets !== undefined ||
    buildEnvVars !== undefined ||
    envVars !== undefined
      ? {
          version: RESOURCE_STATE_VERSION,
          ...(credentials !== undefined ? { credentials } : {}),
          ...(buildSecrets !== undefined ? { buildSecrets } : {}),
          ...(buildEnvVars !== undefined ? { buildEnvVars } : {}),
          ...(envVars !== undefined ? { envVars } : {}),
        }
      : undefined;
  return { core, configuration, secrets };
}

function throwResourceConstraintError(error: unknown): never {
  if (
    isPostgresUniqueViolation(error, "resource_normalized_service_key_uidx")
  ) {
    throw new ValidationError(
      "Docker service name is already used by another resource.",
    );
  }
  throw error;
}

type ResourceConfigurationPatch = Partial<ResourceConfigurationValues>;
type ResourceSecretPatch = Partial<ResourceSecretValues>;

function toResourceInsert(
  values: Partial<CreateResourceDTO>,
): typeof resource.$inferInsert {
  if (
    !values.id ||
    !values.environmentId ||
    !values.name ||
    !values.type ||
    !values.provider
  ) {
    throw new Error(
      "Resource inserts require id, environmentId, name, type, and provider",
    );
  }
  return {
    ...values,
    id: values.id,
    environmentId: values.environmentId,
    name: values.name,
    type: values.type,
    provider: values.provider,
  };
}
