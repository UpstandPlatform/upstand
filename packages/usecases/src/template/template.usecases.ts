import { randomUUID } from "node:crypto";
import type {
  IUnitOfWork,
  Resource,
  Template,
  TemplatePage,
} from "@upstand/domain";
import {
  DEFAULT_RESOURCE_ADVANCED_CONFIG,
  serializeResourceAdvancedConfig,
} from "@upstand/domain";
import yaml from "yaml";
import { z } from "zod";
import {
  CreateResourceInputSchema,
  type CreateResourceUseCase,
} from "../resource/create-resource.usecase";
import {
  DeployResourceInputSchema,
  type DeployResourceUseCase,
} from "../resource/deploy-resource.usecase";
import { extractAndParametrizeEnvVars } from "../resource/resource-environment";
import { getNativeTemplate, type NativeTemplate } from "./native-catalog";

const TemplateTagsSchema = z
  .array(z.string().trim().min(1).max(64))
  .max(32)
  .default([]);

export const ListTemplatesInputSchema = z.object({
  organizationId: z.string().min(1),
  search: z.string().trim().max(120).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(48).default(12),
});

export const CreateTemplateInputSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  tags: TemplateTagsSchema,
  composeFile: z.string().trim().min(1).max(1_048_576),
});

export const UpdateTemplateInputSchema = CreateTemplateInputSchema.extend({
  id: z.string().min(1),
}).partial({ name: true, description: true, tags: true, composeFile: true });

export const DeleteTemplateInputSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
});

export const DeployTemplateInputSchema = z.object({
  organizationId: z.string().min(1),
  templateId: z.string().min(1),
  source: z.enum(["custom", "builtin"]).default("custom"),
  environmentId: z.string().min(1),
  resourceName: z.string().trim().min(1).max(120),
  appName: z.string().trim().min(1).max(120),
  composeType: z.enum(["compose", "stack"]).default("stack"),
  serverId: z.string().optional(),
  buildServerId: z.string().nullable().optional(),
  randomize: z.boolean().default(false),
});

export function validateTemplateComposeFile(composeFile: string): string {
  let parsed: unknown;
  try {
    parsed = yaml.parse(composeFile);
  } catch (error) {
    throw new Error(
      `Template Compose YAML is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const document =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const services = document?.services;
  if (
    !document ||
    !services ||
    typeof services !== "object" ||
    Array.isArray(services) ||
    Object.keys(services).length === 0
  ) {
    throw new Error("Template Compose YAML must define at least one service.");
  }
  validateTemplateSafety(document);
  return composeFile;
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
}

function validateTemplateSafety(document: Record<string, unknown>) {
  const services = document.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    return;
  }
  for (const [serviceName, value] of Object.entries(
    services as Record<string, unknown>,
  )) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const service = value as Record<string, unknown>;
    if (
      service.privileged === true ||
      ["host", "container:host"].includes(String(service.network_mode ?? "")) ||
      ["host", "container:host"].includes(String(service.pid ?? "")) ||
      ["host", "container:host"].includes(String(service.ipc ?? ""))
    ) {
      throw new Error(
        `Template service '${serviceName}' requests host-level isolation; remove privileged, host namespace, or host networking settings.`,
      );
    }
    if (
      (Array.isArray(service.cap_add) && service.cap_add.length > 0) ||
      (Array.isArray(service.devices) && service.devices.length > 0)
    ) {
      throw new Error(
        `Template service '${serviceName}' requests host capabilities or devices.`,
      );
    }
    if (Array.isArray(service.volumes)) {
      for (const volume of service.volumes) {
        const source =
          typeof volume === "string"
            ? volume.split(":", 1)[0]
            : volume && typeof volume === "object"
              ? (volume as Record<string, unknown>).source
              : undefined;
        if (
          typeof source === "string" &&
          (source.startsWith("/") ||
            source.startsWith("./") ||
            source.startsWith("../") ||
            source.startsWith("~") ||
            /^[A-Za-z]:[\\/]/.test(source) ||
            source.startsWith("\\\\") ||
            source.includes("docker.sock"))
        ) {
          throw new Error(
            `Template service '${serviceName}' contains a host bind or Docker socket mount.`,
          );
        }
      }
    }
  }
}

export class ListTemplatesUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  execute(
    input: z.infer<typeof ListTemplatesInputSchema>,
  ): Promise<TemplatePage> {
    return this.uow.templateRepository.findPageByOrganizationId({
      organizationId: input.organizationId,
      search: input.search,
      page: input.page,
      pageSize: input.pageSize,
    });
  }
}

export class CreateTemplateUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: z.infer<typeof CreateTemplateInputSchema>,
  ): Promise<Template> {
    const composeFile = validateTemplateComposeFile(input.composeFile);
    return this.uow.templateRepository.create({
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      tags: normalizeTags(input.tags),
      composeFile,
    });
  }
}

export class UpdateTemplateUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: z.infer<typeof UpdateTemplateInputSchema>,
  ): Promise<Template> {
    const current = await this.uow.templateRepository.findById(input.id);
    if (!current || current.organizationId !== input.organizationId) {
      throw new Error("Template not found");
    }
    const composeFile =
      input.composeFile === undefined
        ? undefined
        : validateTemplateComposeFile(input.composeFile);
    const updated = await this.uow.templateRepository.updateById(input.id, {
      name: input.name,
      description: input.description,
      tags: input.tags ? normalizeTags(input.tags) : undefined,
      composeFile,
    });
    if (!updated) throw new Error("Template not found");
    return updated;
  }
}

export class DeleteTemplateUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: z.infer<typeof DeleteTemplateInputSchema>) {
    const current = await this.uow.templateRepository.findById(input.id);
    if (!current || current.organizationId !== input.organizationId) {
      throw new Error("Template not found");
    }
    await this.uow.templateRepository.deleteById(input.id);
    return { deleted: true };
  }
}

export class DeployTemplateUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly createResource: CreateResourceUseCase,
    private readonly deployResource: DeployResourceUseCase,
    private readonly loadNativeTemplate: (
      templateId: string,
    ) => NativeTemplate = getNativeTemplate,
  ) {}

  async execute(
    input: z.infer<typeof DeployTemplateInputSchema>,
  ): Promise<Resource> {
    let composeFile: string;
    if (input.source === "builtin") {
      const blueprint = this.loadNativeTemplate(input.templateId);
      composeFile = validateTemplateComposeFile(blueprint.composeFile);
    } else {
      const template = await this.uow.templateRepository.findById(
        input.templateId,
      );
      if (!template || template.organizationId !== input.organizationId) {
        throw new Error("Template not found");
      }
      composeFile = template.composeFile;
    }
    const environment = await this.uow.environmentRepository.findById(
      input.environmentId,
    );
    if (!environment) throw new Error("Environment not found");
    const project = await this.uow.projectRepository.findById(
      environment.projectId,
    );
    if (!project || project.organizationId !== input.organizationId) {
      throw new Error("Environment is not part of the active organization");
    }

    const { composeFile: parametrizedCompose, envVars: defaultEnvVars } =
      extractAndParametrizeEnvVars(composeFile);

    const resource = await this.createResource.execute(
      CreateResourceInputSchema.parse({
        environmentId: input.environmentId,
        name: input.resourceName,
        appName: input.appName,
        type: "compose",
        composeType: input.composeType,
        serverId: input.serverId,
        buildServerId: input.buildServerId,
        credentials: JSON.stringify({
          provider: "raw",
          autoDeploy: false,
          composeFile: parametrizedCompose,
        }),
        envVars: defaultEnvVars,
      }),
    );

    if (input.randomize) {
      await this.uow.resourceRepository.updateById(resource.id, {
        advancedConfig: serializeResourceAdvancedConfig({
          ...DEFAULT_RESOURCE_ADVANCED_CONFIG,
          randomize: true,
        }),
      });
    }
    return this.deployResource.execute(
      DeployResourceInputSchema.parse({ id: resource.id }),
    );
  }
}
