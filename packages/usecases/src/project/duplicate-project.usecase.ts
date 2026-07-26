import { randomUUID } from "node:crypto";
import type { IUnitOfWork, Project } from "@upstand/domain";
import { z } from "zod";
import { generateWebhookToken } from "../resource/webhook-token";

export const DuplicateProjectInputSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
});

export class DuplicateProjectUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: z.infer<typeof DuplicateProjectInputSchema>,
  ): Promise<Project> {
    return this.uow.transaction(async (tx) => {
      const source = await tx.projectRepository.findById(input.id);
      if (!source || source.organizationId !== input.organizationId) {
        throw new Error("Project not found");
      }

      const copiedProject = await tx.projectRepository.create({
        id: randomUUID(),
        name: input.name,
        description: source.description,
        icon: source.icon,
        organizationId: input.organizationId,
      });
      const environments = await tx.environmentRepository.findByProjectId(
        source.id,
      );

      for (const environment of environments) {
        const copiedEnvironment = await tx.environmentRepository.create({
          id: randomUUID(),
          projectId: copiedProject.id,
          name: environment.name,
          slug: `${environment.slug}-copy`.slice(0, 64),
          description: environment.description,
          parentEnvironmentId: null,
          inheritsVariables: environment.inheritsVariables,
          isDefault: environment.isDefault,
          isProtected: environment.isProtected,
          resourceCount: 0,
        });
        if (environment.envVars) {
          await tx.environmentRepository.updateEnvironment(
            copiedEnvironment.id,
            {
              envVars: environment.envVars,
            },
          );
        }
        const resources = await tx.resourceRepository.findByEnvironmentId(
          environment.id,
        );
        for (const resource of resources) {
          const webhookToken = generateWebhookToken();
          const copiedResource = await tx.resourceRepository.create({
            id: randomUUID(),
            environmentId: copiedEnvironment.id,
            name: resource.name,
            type: resource.type,
            status: "idle",
            provider: resource.provider,
            appName: resource.appName
              ? `${resource.appName}-copy`.slice(0, 63)
              : null,
            description: resource.description,
            dbType: resource.dbType,
            composeType: resource.composeType,
            dockerImage: resource.dockerImage,
            buildRegistryId: resource.buildRegistryId,
            rollbackActive: resource.rollbackActive,
            rollbackRegistryId: resource.rollbackRegistryId,
            credentials: resource.credentials,
            triggerType: resource.triggerType,
            watchPaths: resource.watchPaths,
            webhookTokenHash: webhookToken.hash,
            webhookTokenPrefix: webhookToken.prefix,
            buildConfig: resource.buildConfig,
            buildSecrets: resource.buildSecrets,
            buildEnvVars: resource.buildEnvVars,
            advancedConfig: resource.advancedConfig,
            envVars: resource.envVars,
            domains: "[]",
            serverId: resource.serverId,
            buildServerId: resource.buildServerId,
          });
          const tags = await tx.tagRepository.findByResourceId(resource.id);
          for (const tag of tags) {
            await tx.tagRepository.attachToResource(copiedResource.id, tag.id);
          }
        }
        if (resources.length > 0) {
          await tx.environmentRepository.updateById(copiedEnvironment.id, {
            resourceCount: resources.length,
          });
        }
      }
      return copiedProject;
    });
  }
}
