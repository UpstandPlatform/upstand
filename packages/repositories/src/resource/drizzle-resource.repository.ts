import { resource, resourceConfiguration, resourceSecret } from "@upstand/db";
import type {
  CreateResourceDTO,
  IResourceRepository,
  Resource,
} from "@upstand/domain";
import {
  RESOURCE_STATE_VERSION,
  serializeResourceConfiguration,
  ValidationError,
} from "@upstand/domain";
import { and, count, eq, inArray, ne, or, sql } from "drizzle-orm";
import { DrizzleSecretVersionRepository } from "../secret/drizzle-secret-version.repository";
import { isPostgresUniqueViolation } from "../shared/database-errors";
import type { Executor } from "../shared/types";

const DEFAULT_CONFIGURATION = serializeResourceConfiguration({});
const DEFAULT_BUILD_CONFIG = DEFAULT_CONFIGURATION.buildConfig;
const DEFAULT_ADVANCED_CONFIG = DEFAULT_CONFIGURATION.advancedConfig;
const DEFAULT_WATCH_PATHS = DEFAULT_CONFIGURATION.watchPaths;
const DEFAULT_DOMAINS = DEFAULT_CONFIGURATION.domains;
const DEFAULT_ENV_VARS = "{}";

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
      .where(eq(resource.environmentId, environmentId));
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
      );
    return this.hydrate(rows);
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
    return this.hydrate(await this.executor.select().from(resource));
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
    const { configuration, secrets, core } = splitResourceValues(patch);
    const [claimed] = await this.executor
      .update(resource)
      .set({ ...core, updatedAt: new Date() })
      .where(
        and(eq(resource.id, id), eq(resource.updatedAt, expectedUpdatedAt)),
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
