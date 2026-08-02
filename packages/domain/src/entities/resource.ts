import { z } from "zod";
import { EntityIconSchema } from "./icon";

/**
 * Resource app names are also used as internal Docker DNS hostnames by
 * scheduled HTTP callbacks. Keep them within one DNS label so they cannot
 * introduce a port, path, credentials, or another hostname.
 */
const RESERVED_RESOURCE_APP_NAMES = new Set([
  "localhost",
  "localhost6",
  "ip6-localhost",
  "ip6-loopback",
  "loopback",
  "host",
  "gateway",
]);

export const ResourceAppNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "App Name is required")
  .max(63, "App names must not exceed 63 characters")
  .regex(
    /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/,
    "App names may contain only lowercase letters, numbers, hyphens, and underscores",
  )
  .refine(
    (value) => !RESERVED_RESOURCE_APP_NAMES.has(value),
    "This app name is reserved and cannot be used as an internal callback host",
  );

const RelativeBuildPathSchema = z
  .string()
  .trim()
  .min(1, "A build path is required")
  .max(512, "Build paths must not exceed 512 characters");

export const ApplicationBuildTypeSchema = z.enum([
  "dockerfile",
  "railpack",
  "nixpacks",
  "heroku-buildpacks",
  "paketo-buildpacks",
  "static",
]);

export const DATABASE_IMAGE_OPTIONS = {
  postgres: ["postgres:18-alpine"],
  mysql: ["mysql:8.0", "mysql:8.4"],
  mariadb: ["mariadb:10.11", "mariadb:11"],
  mongodb: ["mongo:6.0", "mongo:7.0"],
  redis: ["redis:8.8-alpine"],
  libsql: ["ghcr.io/tursodatabase/libsql-server:0.24.32"],
} as const;

export type DatabaseType = keyof typeof DATABASE_IMAGE_OPTIONS;

/** Conservative validation for an explicitly selected custom Docker image. */
export const DockerImageReferenceSchema = z
  .string()
  .trim()
  .min(1, "Docker image is required")
  .max(512, "Docker image reference is too long")
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._/@:-]*$/,
    "Docker image reference contains unsupported characters",
  );

export function isValidDockerImageReference(
  value: string | null | undefined,
): boolean {
  return (
    typeof value === "string" &&
    DockerImageReferenceSchema.safeParse(value).success
  );
}

export const ResourceComposeTypeSchema = z.enum(["compose", "stack"]);
export type ResourceComposeType = z.infer<typeof ResourceComposeTypeSchema>;

export function isSupportedDatabaseImage(
  databaseType: string | undefined,
  image: string | null | undefined,
  allowCustom = false,
): boolean {
  if (!databaseType || !image) return false;
  const options = DATABASE_IMAGE_OPTIONS[databaseType as DatabaseType];
  return Boolean(
    (options as readonly string[] | undefined)?.includes(image) ||
      (allowCustom && isValidDockerImageReference(image)),
  );
}

export const ResourcePortSchema = z.object({
  publishedPort: z.number().int().min(1).max(65535),
  targetPort: z.number().int().min(1).max(65535),
  protocol: z.enum(["tcp", "udp"]).default("tcp"),
});

export const ResourceVolumeSchema = z.object({
  source: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
      "Volume sources must be named Docker volumes",
    ),
  target: z
    .string()
    .trim()
    .regex(/^\/.+/, "Volume targets must be absolute paths"),
  readOnly: z.boolean().default(false),
});

const SafeCommandTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) =>
        ![...value].some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        }),
      "Commands cannot contain control characters",
    );

const ResourceHealthcheckSchema = z.object({
  command: z.array(SafeCommandTextSchema(4096).min(1)).min(1).max(32),
  intervalSeconds: z.number().int().min(1).max(86400).default(30),
  timeoutSeconds: z.number().int().min(1).max(86400).default(5),
  retries: z.number().int().min(1).max(100).default(3),
  startPeriodSeconds: z.number().int().min(0).max(86400).default(10),
});

export const ResourceAdvancedConfigSchema = z.object({
  source: z
    .object({
      reuseWorkspace: z.boolean().default(false),
      gitLfs: z.boolean().default(false),
      fetchDepth: z.number().int().min(0).max(100_000).default(1),
      timeoutSeconds: z.number().int().min(30).max(86_400).default(900),
    })
    .default({
      reuseWorkspace: false,
      gitLfs: false,
      fetchDepth: 1,
      timeoutSeconds: 900,
    }),
  smokeTest: z
    .object({
      enabled: z.boolean().default(false),
      type: z.enum(["http", "tcp"]).default("http"),
      target: z.string().trim().min(1).max(2048),
      expectedStatus: z.number().int().min(100).max(599).default(200),
      timeoutSeconds: z.number().int().min(1).max(120).default(10),
      retries: z.number().int().min(1).max(10).default(3),
    })
    .nullable()
    .default(null),
  deploymentReliability: z
    .object({
      maxAttempts: z.number().int().min(1).max(10).default(3),
      retryBaseSeconds: z.number().int().min(1).max(300).default(2),
      retryMaxSeconds: z.number().int().min(1).max(3600).default(60),
      staleAfterSeconds: z.number().int().min(60).max(86400).default(1800),
    })
    .superRefine((value, context) => {
      if (value.retryMaxSeconds < value.retryBaseSeconds) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "retryMaxSeconds cannot be less than retryBaseSeconds",
          path: ["retryMaxSeconds"],
        });
      }
    })
    .default({
      maxAttempts: 3,
      retryBaseSeconds: 2,
      retryMaxSeconds: 60,
      staleAfterSeconds: 1800,
    }),
  autoscaling: z
    .object({
      enabled: z.boolean().default(false),
      minReplicas: z.number().int().min(0).max(1000).default(1),
      maxReplicas: z.number().int().min(1).max(1000).default(10),
      targetCpuPercent: z.number().min(1).max(100).optional(),
      targetMemoryPercent: z.number().min(1).max(100).optional(),
      targetRequestsPerSecond: z.number().positive().optional(),
      customMetric: z.string().trim().max(128).optional(),
      customMetricTarget: z.number().finite().optional(),
      scaleUpStep: z.number().int().min(1).max(100).default(1),
      scaleDownStep: z.number().int().min(1).max(100).default(1),
      cooldownSeconds: z.number().int().min(10).max(86400).default(180),
    })
    .superRefine((value, context) => {
      if (value.minReplicas > value.maxReplicas) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "minReplicas cannot exceed maxReplicas",
          path: ["minReplicas"],
        });
      }
      if (
        value.enabled &&
        value.targetCpuPercent === undefined &&
        value.targetMemoryPercent === undefined &&
        value.targetRequestsPerSecond === undefined &&
        value.customMetricTarget === undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Autoscaling requires at least one target metric",
          path: ["targetCpuPercent"],
        });
      }
    })
    .default({
      enabled: false,
      minReplicas: 1,
      maxReplicas: 10,
      scaleUpStep: 1,
      scaleDownStep: 1,
      cooldownSeconds: 180,
    }),
  deploymentStrategy: z
    .object({
      type: z
        .enum(["rolling", "canary", "blue-green", "progressive"])
        .default("rolling"),
      canaryReplicas: z.number().int().min(1).max(1000).optional(),
      canaryPercent: z.number().min(1).max(99).optional(),
      bakeTimeSeconds: z.number().int().min(0).max(86400).default(60),
      steps: z.array(z.number().int().min(1).max(100)).max(20).default([]),
      automaticRollback: z.boolean().default(true),
    })
    .default({
      type: "rolling",
      bakeTimeSeconds: 60,
      steps: [],
      automaticRollback: true,
    }),
  preDeployHook: z
    .object({
      command: SafeCommandTextSchema(1024).optional(),
      enabled: z.boolean().default(false),
      timeoutSeconds: z.number().int().min(10).max(1800).default(300),
    })
    .default({ enabled: false, timeoutSeconds: 300 }),
  postDeployHook: z
    .object({
      command: SafeCommandTextSchema(1024).optional(),
      enabled: z.boolean().default(false),
      timeoutSeconds: z.number().int().min(10).max(1800).default(300),
      onFailure: z.enum(["warn", "fail"]).default("warn"),
    })
    .default({ enabled: false, timeoutSeconds: 300, onFailure: "warn" }),
  databaseReplication: z
    .object({
      enabled: z.boolean().default(false),
      replicaCount: z.number().int().min(1).max(5).default(1),
      automaticFailover: z.boolean().default(true),
      replicationUser: z.string().trim().min(1).max(128).default("repmgr"),
    })
    .default({
      enabled: false,
      replicaCount: 1,
      automaticFailover: true,
      replicationUser: "repmgr",
    }),
  trafficSplits: z
    .array(
      z.object({
        serviceName: z.string().trim().min(1).max(253),
        weight: z.number().int().min(1).max(100),
      }),
    )
    .max(8)
    .default([]),
  serviceName: z
    .string()
    .trim()
    .max(253)
    .optional()
    .describe("Compose service to receive resource-level overrides."),
  isolatedDeployment: z
    .boolean()
    .default(false)
    .describe("Use a dedicated Swarm overlay network for this resource."),
  isolatedDeploymentsVolume: z
    .boolean()
    .default(false)
    .describe("Prefix Compose named volumes when isolation is enabled."),
  randomize: z
    .boolean()
    .default(false)
    .describe("Randomize Compose resource names to avoid collisions."),
  randomSuffix: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
    .optional(),
  command: z.array(z.string().trim().min(1)).max(64).default([]),
  args: z.array(z.string().max(4096)).max(128).default([]),
  ports: z.array(ResourcePortSchema).max(32).default([]),
  volumes: z.array(ResourceVolumeSchema).max(32).default([]),
  environment: z.record(z.string(), z.string()).default({}),
  labels: z.record(z.string(), z.string()).default({}),
  placementConstraints: z
    .array(z.string().trim().min(1).max(256))
    .max(32)
    .default([]),
  resources: z
    .object({
      cpuLimit: z.number().positive().max(1024).optional(),
      cpuReservation: z.number().positive().max(1024).optional(),
      memoryLimitMb: z.number().int().positive().max(1_048_576).optional(),
      memoryReservationMb: z
        .number()
        .int()
        .positive()
        .max(1_048_576)
        .optional(),
    })
    .default({}),
  restartPolicy: z
    .object({
      condition: z.enum(["none", "on-failure", "any"]).default("any"),
      maxAttempts: z.number().int().min(0).max(1000).optional(),
      delaySeconds: z.number().int().min(0).max(86400).optional(),
      windowSeconds: z.number().int().min(0).max(86400).optional(),
    })
    .default({ condition: "any" }),
  replicas: z.number().int().min(0).max(1000).optional(),
  stopGracePeriodSeconds: z.number().int().min(0).max(86400).optional(),
  workingDir: z.string().trim().max(4096).optional(),
  user: z.string().trim().max(256).optional(),
  hostname: z.string().trim().max(253).optional(),
  dns: z.array(z.string().trim().min(1).max(253)).max(16).default([]),
  dnsSearch: z.array(z.string().trim().min(1).max(253)).max(16).default([]),
  extraHosts: z.array(z.string().trim().min(1).max(512)).max(64).default([]),
  sysctls: z.record(z.string(), z.string()).default({}),
  capAdd: z
    .array(z.string().trim().min(1).max(128))
    .max(64)
    .default([])
    .refine(
      (capabilities) => capabilities.length === 0,
      "Added Linux capabilities are not supported for workload isolation",
    ),
  capDrop: z.array(z.string().trim().min(1).max(128)).max(64).default([]),
  updateConfig: z
    .object({
      parallelism: z.number().int().min(0).max(1000).optional(),
      delaySeconds: z.number().int().min(0).max(86400).optional(),
      monitorSeconds: z.number().int().min(0).max(86400).optional(),
      failureAction: z.enum(["continue", "pause", "rollback"]).optional(),
      order: z.enum(["stop-first", "start-first"]).optional(),
    })
    .default({}),
  rollbackConfig: z
    .object({
      parallelism: z.number().int().min(0).max(1000).optional(),
      delaySeconds: z.number().int().min(0).max(86400).optional(),
      monitorSeconds: z.number().int().min(0).max(86400).optional(),
      failureAction: z.enum(["continue", "pause"]).optional(),
      order: z.enum(["stop-first", "start-first"]).optional(),
    })
    .default({}),
  healthcheck: ResourceHealthcheckSchema.nullable().default(null),
  init: z.boolean().default(false),
  readOnlyRootFilesystem: z.boolean().default(false),
  tty: z.boolean().default(false),
  privileged: z
    .boolean()
    .default(false)
    .refine(
      (enabled) => !enabled,
      "Privileged containers are not supported for workload isolation",
    ),
});

export type ResourceAdvancedConfig = z.infer<
  typeof ResourceAdvancedConfigSchema
>;

export const DEFAULT_RESOURCE_ADVANCED_CONFIG: ResourceAdvancedConfig =
  ResourceAdvancedConfigSchema.parse({});

export const serializeResourceAdvancedConfig = (
  config: ResourceAdvancedConfig,
): string => JSON.stringify(ResourceAdvancedConfigSchema.parse(config));

export const parseResourceAdvancedConfig = (
  value: string | null | undefined,
): ResourceAdvancedConfig => {
  if (!value) return DEFAULT_RESOURCE_ADVANCED_CONFIG;
  try {
    return ResourceAdvancedConfigSchema.parse(JSON.parse(value));
  } catch {
    return DEFAULT_RESOURCE_ADVANCED_CONFIG;
  }
};

export const DockerfileBuildConfigSchema = z.object({
  type: z.literal("dockerfile"),
  autoDetect: z.boolean().default(true).optional(),
  buildPath: RelativeBuildPathSchema.default("."),
  dockerfilePath: RelativeBuildPathSchema.default("Dockerfile"),
  dockerContextPath: RelativeBuildPathSchema.default("."),
  dockerBuildStage: z.string().trim().min(1).max(128).optional(),
  dockerBuildArgs: z.record(z.string(), z.string()).default({}),
  dockerNoCache: z.boolean().default(false),
  dockerCleanupCache: z.boolean().default(false),
});

export const RailpackBuildConfigSchema = z.object({
  type: z.literal("railpack"),
  autoDetect: z.boolean().default(true).optional(),
  buildPath: RelativeBuildPathSchema.default("."),
  railpackVersion: z
    .string()
    .trim()
    .regex(
      /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/,
      "Use a valid Railpack version",
    )
    .default("0.15.4"),
});

export const NixpacksBuildConfigSchema = z.object({
  type: z.literal("nixpacks"),
  autoDetect: z.boolean().default(true).optional(),
  buildPath: RelativeBuildPathSchema.default("."),
  publishDirectory: RelativeBuildPathSchema.optional(),
});

export const HerokuBuildpacksBuildConfigSchema = z.object({
  type: z.literal("heroku-buildpacks"),
  autoDetect: z.boolean().default(true).optional(),
  buildPath: RelativeBuildPathSchema.default("."),
  herokuVersion: z.enum(["24", "26"]).default("24"),
});

export const PaketoBuildpacksBuildConfigSchema = z.object({
  type: z.literal("paketo-buildpacks"),
  autoDetect: z.boolean().default(true).optional(),
  buildPath: RelativeBuildPathSchema.default("."),
});

export const StaticBuildConfigSchema = z.object({
  type: z.literal("static"),
  autoDetect: z.boolean().default(true).optional(),
  buildPath: RelativeBuildPathSchema.default("."),
  publishDirectory: RelativeBuildPathSchema,
  spa: z.boolean().default(false),
});

export const ApplicationBuildConfigSchema = z.discriminatedUnion("type", [
  DockerfileBuildConfigSchema,
  RailpackBuildConfigSchema,
  NixpacksBuildConfigSchema,
  HerokuBuildpacksBuildConfigSchema,
  PaketoBuildpacksBuildConfigSchema,
  StaticBuildConfigSchema,
]);

export type ApplicationBuildConfig = z.infer<
  typeof ApplicationBuildConfigSchema
>;

export const DEFAULT_APPLICATION_BUILD_CONFIG: ApplicationBuildConfig = {
  autoDetect: true,
  type: "dockerfile",
  buildPath: ".",
  dockerfilePath: "Dockerfile",
  dockerContextPath: ".",
  dockerBuildArgs: {},
  dockerNoCache: false,
  dockerCleanupCache: false,
};

export const serializeApplicationBuildConfig = (
  config: ApplicationBuildConfig,
): string => JSON.stringify(ApplicationBuildConfigSchema.parse(config));

export const parseApplicationBuildConfig = (
  value: string | null | undefined,
): ApplicationBuildConfig => {
  if (!value) {
    return DEFAULT_APPLICATION_BUILD_CONFIG;
  }

  try {
    return ApplicationBuildConfigSchema.parse(JSON.parse(value));
  } catch {
    return DEFAULT_APPLICATION_BUILD_CONFIG;
  }
};

export const ResourceSchema = z.object({
  id: z.string(),
  environmentId: z.string(),
  name: z.string(),
  type: z.string(),
  status: z.string(),
  provider: z.string(),
  appName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  dbType: z.string().nullable().optional(),
  composeType: z.string().nullable().optional(),
  dockerImage: z.string().nullable().optional(),
  buildRegistryId: z.string().nullable().optional(),
  rollbackActive: z.boolean().optional(),
  rollbackRegistryId: z.string().nullable().optional(),
  externalPort: z.number().int().min(1).max(65535).nullable().optional(),
  libsqlGrpcPort: z.number().int().min(1).max(65535).nullable().optional(),
  libsqlAdminPort: z.number().int().min(1).max(65535).nullable().optional(),
  credentials: z.string().nullable().optional(),
  triggerType: z.enum(["push", "tag"]).optional(),
  tagPattern: z.string().nullable().optional(),
  watchPaths: z.string().optional(),
  webhookTokenHash: z.string().nullable().optional(),
  webhookTokenPrefix: z.string().nullable().optional(),
  buildConfig: z.string(),
  buildSecrets: z.string().nullable().optional(),
  buildEnvVars: z.string().nullable().optional(),
  isPreviewDeploymentsActive: z.boolean().optional(),
  previewLimit: z.number().int().min(1).max(100).optional(),
  previewWildcard: z.string().nullable().optional(),
  previewHttps: z.boolean().optional(),
  previewPort: z.number().int().min(1).max(65535).optional(),
  advancedConfig: z.string().optional(),
  envVars: z.string(),
  domains: z.string(),
  serverId: z.string().nullable().optional(),
  buildServerId: z.string().nullable().optional(),
  cronJobsEnabled: z.boolean().default(true).optional(),
  icon: EntityIconSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Resource = z.infer<typeof ResourceSchema>;

export interface CreateResourceDTO {
  id?: string;
  environmentId: string;
  name: string;
  type: string;
  status?: string;
  provider: string;
  appName?: string | null;
  description?: string | null;
  dbType?: string | null;
  composeType?: string | null;
  dockerImage?: string | null;
  buildRegistryId?: string | null;
  rollbackActive?: boolean;
  rollbackRegistryId?: string | null;
  externalPort?: number | null;
  libsqlGrpcPort?: number | null;
  libsqlAdminPort?: number | null;
  credentials?: string | null;
  triggerType?: "push" | "tag";
  tagPattern?: string | null;
  watchPaths?: string;
  webhookTokenHash?: string | null;
  webhookTokenPrefix?: string | null;
  buildConfig?: string;
  buildSecrets?: string | null;
  buildEnvVars?: string | null;
  isPreviewDeploymentsActive?: boolean;
  previewLimit?: number;
  previewWildcard?: string | null;
  previewHttps?: boolean;
  previewPort?: number;
  advancedConfig?: string;
  envVars?: string;
  domains?: string;
  serverId?: string | null;
  buildServerId?: string | null;
  cronJobsEnabled?: boolean;
  icon?: string | null;
}

export type UpdateResourceDTO = Partial<CreateResourceDTO>;
