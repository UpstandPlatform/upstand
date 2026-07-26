import { z } from "zod";
import {
  type DomainMapping,
  DomainMappingSchema,
  parseDomainMappings,
  serializeDomainMappings,
} from "./domain-mapping";
import {
  ApplicationBuildConfigSchema,
  DEFAULT_APPLICATION_BUILD_CONFIG,
  DEFAULT_RESOURCE_ADVANCED_CONFIG,
  parseApplicationBuildConfig,
  parseResourceAdvancedConfig,
  ResourceAdvancedConfigSchema,
  serializeApplicationBuildConfig,
  serializeResourceAdvancedConfig,
} from "./resource";

export const RESOURCE_STATE_VERSION = 1 as const;

export const ResourceConfigurationDocumentSchema = z.object({
  version: z.literal(RESOURCE_STATE_VERSION),
  buildConfig: ApplicationBuildConfigSchema,
  advancedConfig: ResourceAdvancedConfigSchema,
  watchPaths: z.array(z.string().trim().min(1).max(512)).max(64),
  domains: z.array(DomainMappingSchema).max(128),
});

export type ResourceConfigurationDocument = z.infer<
  typeof ResourceConfigurationDocumentSchema
>;

export function parseResourceConfiguration(input: {
  buildConfig?: string | null;
  advancedConfig?: string | null;
  watchPaths?: string | null;
  domains?: string | null;
}): ResourceConfigurationDocument {
  return ResourceConfigurationDocumentSchema.parse({
    version: RESOURCE_STATE_VERSION,
    buildConfig: parseApplicationBuildConfig(input.buildConfig),
    advancedConfig: parseResourceAdvancedConfig(input.advancedConfig),
    watchPaths: parseStringArray(input.watchPaths, 64),
    domains: parseDomainMappingsSafely(input.domains),
  });
}

export function serializeResourceConfiguration(
  input: Partial<
    Pick<
      ResourceConfigurationDocument,
      "buildConfig" | "advancedConfig" | "watchPaths" | "domains"
    >
  >,
): {
  version: typeof RESOURCE_STATE_VERSION;
  buildConfig: string;
  advancedConfig: string;
  watchPaths: string;
  domains: string;
} {
  const document = ResourceConfigurationDocumentSchema.parse({
    version: RESOURCE_STATE_VERSION,
    buildConfig: input.buildConfig ?? DEFAULT_APPLICATION_BUILD_CONFIG,
    advancedConfig: input.advancedConfig ?? DEFAULT_RESOURCE_ADVANCED_CONFIG,
    watchPaths: input.watchPaths ?? [],
    domains: input.domains ?? [],
  });
  return {
    version: document.version,
    buildConfig: serializeApplicationBuildConfig(document.buildConfig),
    advancedConfig: serializeResourceAdvancedConfig(document.advancedConfig),
    watchPaths: JSON.stringify(document.watchPaths),
    domains: serializeDomainMappings(document.domains),
  };
}

function parseStringArray(value: string | null | undefined, maxItems: number) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is string =>
              typeof item === "string" && item.trim().length > 0,
          )
          .slice(0, maxItems)
      : [];
  } catch {
    return [];
  }
}

function parseDomainMappingsSafely(value: string | null | undefined) {
  if (!value) return [] as DomainMapping[];
  try {
    return parseDomainMappings(value);
  } catch {
    return [] as DomainMapping[];
  }
}
