import { randomUUID } from "node:crypto";
import type { Environment, IUnitOfWork, Resource } from "@upstand/domain";
import { z } from "zod";
import {
  parseResourceEnvironmentVariables,
  serializeResourceEnvironmentVariables,
} from "../resource/resource-environment";
import { resolveEnvironmentVariables } from "./update-environment.usecase";

export const CloneEnvironmentInputSchema = z.object({
  sourceEnvironmentId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  includeResources: z.boolean().default(true),
  includeSecrets: z.boolean().default(false),
});

export const DiffEnvironmentsInputSchema = z.object({
  sourceEnvironmentId: z.string().min(1),
  targetEnvironmentId: z.string().min(1),
});

export const PromoteEnvironmentInputSchema = z.object({
  sourceEnvironmentId: z.string().min(1),
  targetEnvironmentId: z.string().min(1),
  includeResources: z.boolean().default(true),
  includeSecrets: z.boolean().default(false),
});

export type EnvironmentDiffEntry = {
  key: string;
  source: "present" | "absent";
  target: "present" | "absent";
  sensitive: true;
};

export type EnvironmentDiff = {
  sourceEnvironmentId: string;
  targetEnvironmentId: string;
  variables: EnvironmentDiffEntry[];
  resources: Array<{
    key: string;
    source: "present" | "absent";
    target: "present" | "absent";
    action: "add" | "update" | "remove" | "unchanged";
    changed: boolean;
    secretsChanged: boolean;
  }>;
};

function resourceKey(resource: Resource): string {
  // appName is deliberately suffixed when a clone is deployed so its Swarm
  // service remains globally unique. The resource name is the stable logical
  // identity used for diff and promotion workflows.
  return resource.name.trim().toLowerCase();
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "environment"
  );
}

export class CloneEnvironmentUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: z.infer<typeof CloneEnvironmentInputSchema>,
  ): Promise<Environment> {
    return this.uow.transaction(async (tx) => {
      const source = await tx.environmentRepository.findById(
        input.sourceEnvironmentId,
      );
      if (!source) throw new Error("Source environment not found");
      const environments = await tx.environmentRepository.findByProjectId(
        source.projectId,
      );
      const baseSlug = slugify(input.name);
      let slug = baseSlug;
      let suffix = 2;
      while (environments.some((environment) => environment.slug === slug))
        slug = `${baseSlug}-${suffix++}`;
      const created = await tx.environmentRepository.create({
        id: randomUUID(),
        projectId: source.projectId,
        name: input.name,
        slug,
        description: source.description,
        isDefault: false,
        isProtected: false,
        resourceCount: 0,
        parentEnvironmentId: source.id,
        inheritsVariables: input.includeSecrets,
      });
      if (input.includeSecrets && source.envVars)
        await tx.environmentRepository.updateEnvironment(created.id, {
          envVars: source.envVars,
        });
      if (!input.includeResources)
        return (await tx.environmentRepository.findById(
          created.id,
        )) as Environment;
      const resources = await tx.resourceRepository.findByEnvironmentId(
        source.id,
      );
      for (const sourceResource of resources) {
        await tx.resourceRepository.create({
          id: randomUUID(),
          environmentId: created.id,
          name: sourceResource.name,
          type: sourceResource.type,
          status: "idle",
          provider: sourceResource.provider,
          appName: sourceResource.appName
            ? `${sourceResource.appName}-${slug}`.slice(0, 63)
            : null,
          description: sourceResource.description,
          dbType: sourceResource.dbType,
          composeType: sourceResource.composeType,
          dockerImage: sourceResource.dockerImage,
          buildRegistryId: sourceResource.buildRegistryId,
          rollbackActive: sourceResource.rollbackActive,
          rollbackRegistryId: sourceResource.rollbackRegistryId,
          credentials: input.includeSecrets ? sourceResource.credentials : "{}",
          triggerType: sourceResource.triggerType,
          tagPattern: sourceResource.tagPattern,
          watchPaths: sourceResource.watchPaths,
          buildConfig: sourceResource.buildConfig,
          buildSecrets: input.includeSecrets
            ? sourceResource.buildSecrets
            : null,
          buildEnvVars: input.includeSecrets
            ? sourceResource.buildEnvVars
            : null,
          advancedConfig: sourceResource.advancedConfig,
          envVars: input.includeSecrets ? sourceResource.envVars : "{}",
          domains: "[]",
          serverId: sourceResource.serverId,
          buildServerId: sourceResource.buildServerId,
          isPreviewDeploymentsActive: false,
          previewLimit: sourceResource.previewLimit,
          previewWildcard: null,
          previewHttps: sourceResource.previewHttps,
          previewPort: sourceResource.previewPort,
          cronJobsEnabled: sourceResource.cronJobsEnabled,
        });
      }
      await tx.environmentRepository.updateById(created.id, {
        resourceCount: resources.length,
      });
      return (await tx.environmentRepository.findById(
        created.id,
      )) as Environment;
    });
  }
}

export class DiffEnvironmentsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: z.infer<typeof DiffEnvironmentsInputSchema>,
  ): Promise<EnvironmentDiff> {
    const [source, target] = await Promise.all([
      this.uow.environmentRepository.findById(input.sourceEnvironmentId),
      this.uow.environmentRepository.findById(input.targetEnvironmentId),
    ]);
    if (!source || !target) throw new Error("Environment not found");
    const [sourceVars, targetVars, sourceResources, targetResources] =
      await Promise.all([
        resolveEnvironmentVariables(this.uow, source.id),
        resolveEnvironmentVariables(this.uow, target.id),
        this.uow.resourceRepository.findByEnvironmentId(source.id),
        this.uow.resourceRepository.findByEnvironmentId(target.id),
      ]);
    const keys = [
      ...new Set([...Object.keys(sourceVars), ...Object.keys(targetVars)]),
    ].sort();
    const variables: EnvironmentDiffEntry[] = keys
      .filter((key) => sourceVars[key] !== targetVars[key])
      .map((key) => ({
        key,
        source:
          sourceVars[key] === undefined
            ? ("absent" as const)
            : ("present" as const),
        target:
          targetVars[key] === undefined
            ? ("absent" as const)
            : ("present" as const),
        sensitive: true as const,
      }));
    const sourceByKey = new Map(
      sourceResources.map((resource) => [resourceKey(resource), resource]),
    );
    const targetByKey = new Map(
      targetResources.map((resource) => [resourceKey(resource), resource]),
    );
    const resourceKeys = [
      ...new Set([...sourceByKey.keys(), ...targetByKey.keys()]),
    ].sort();
    const resources = resourceKeys.map((key) => {
      const left = sourceByKey.get(key);
      const right = targetByKey.get(key);
      const secretsChanged = Boolean(
        left &&
          right &&
          JSON.stringify({
            credentials: left.credentials,
            buildSecrets: left.buildSecrets,
            buildEnvVars: left.buildEnvVars,
            envVars: parseResourceEnvironmentVariables(left.envVars),
          }) !==
            JSON.stringify({
              credentials: right.credentials,
              buildSecrets: right.buildSecrets,
              buildEnvVars: right.buildEnvVars,
              envVars: parseResourceEnvironmentVariables(right.envVars),
            }),
      );
      const configurationChanged = Boolean(
        left &&
          right &&
          JSON.stringify({
            buildConfig: left.buildConfig,
            advancedConfig: left.advancedConfig,
          }) !==
            JSON.stringify({
              buildConfig: right.buildConfig,
              advancedConfig: right.advancedConfig,
            }),
      );
      const action: EnvironmentDiff["resources"][number]["action"] = !right
        ? "add"
        : !left
          ? "remove"
          : configurationChanged || secretsChanged
            ? "update"
            : "unchanged";
      return {
        key,
        source: left ? ("present" as const) : ("absent" as const),
        target: right ? ("present" as const) : ("absent" as const),
        action,
        changed: action !== "unchanged",
        secretsChanged,
      };
    });
    return {
      sourceEnvironmentId: source.id,
      targetEnvironmentId: target.id,
      variables,
      resources,
    };
  }
}

export class PromoteEnvironmentUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: z.infer<typeof PromoteEnvironmentInputSchema>,
  ): Promise<EnvironmentDiff> {
    if (input.sourceEnvironmentId === input.targetEnvironmentId)
      throw new Error("Source and target environments must differ");
    await this.uow.transaction(async (tx) => {
      const [source, target] = await Promise.all([
        tx.environmentRepository.findById(input.sourceEnvironmentId),
        tx.environmentRepository.findById(input.targetEnvironmentId),
      ]);
      if (!source || !target) throw new Error("Environment not found");
      if (target.isProtected)
        throw new Error(
          "Protected environments require an explicit deployment approval",
        );
      if (input.includeSecrets) {
        const sourceVars = await resolveEnvironmentVariables(tx, source.id);
        await tx.environmentRepository.updateEnvironment(target.id, {
          envVars: serializeResourceEnvironmentVariables(sourceVars),
        });
      }
      if (input.includeResources) {
        const sourceResources = await tx.resourceRepository.findByEnvironmentId(
          source.id,
        );
        const targetResources = await tx.resourceRepository.findByEnvironmentId(
          target.id,
        );
        const targetByKey = new Map(
          targetResources.map((resource) => [resourceKey(resource), resource]),
        );
        for (const sourceResource of sourceResources) {
          const targetResource = targetByKey.get(resourceKey(sourceResource));
          if (!targetResource) continue;
          await tx.resourceRepository.updateById(targetResource.id, {
            provider: sourceResource.provider,
            dbType: sourceResource.dbType,
            dockerImage: sourceResource.dockerImage,
            buildRegistryId: sourceResource.buildRegistryId,
            rollbackActive: sourceResource.rollbackActive,
            rollbackRegistryId: sourceResource.rollbackRegistryId,
            credentials: input.includeSecrets
              ? sourceResource.credentials
              : undefined,
            triggerType: sourceResource.triggerType,
            tagPattern: sourceResource.tagPattern,
            watchPaths: sourceResource.watchPaths,
            buildConfig: sourceResource.buildConfig,
            buildSecrets: input.includeSecrets
              ? sourceResource.buildSecrets
              : undefined,
            buildEnvVars: input.includeSecrets
              ? sourceResource.buildEnvVars
              : undefined,
            advancedConfig: sourceResource.advancedConfig,
            envVars: input.includeSecrets ? sourceResource.envVars : undefined,
          });
        }
      }
    });
    return new DiffEnvironmentsUseCase(this.uow).execute(input);
  }
}
