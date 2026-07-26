import { ValidationError } from "@upstand/domain";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

const ComposeDocumentSchema = z
  .string()
  .trim()
  .min(1, "Compose file is required")
  .max(1_048_576, "Compose files must not exceed 1 MB");

export const InspectComposeInputSchema = z.object({
  composeFile: ComposeDocumentSchema,
});

export const ConvertComposeInputSchema = z.object({
  composeFile: ComposeDocumentSchema,
  target: z.enum(["compose", "stack"]),
});

export type InspectComposeInput = z.infer<typeof InspectComposeInputSchema>;
export type ConvertComposeInput = z.infer<typeof ConvertComposeInputSchema>;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.keys(value);
  return [];
}

function portList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string" || typeof item === "number")
      return String(item);
    const port = record(item);
    const target = port.target ?? port.TargetPort ?? "";
    const published = port.published ?? port.PublishedPort ?? "";
    const protocol =
      typeof port.protocol === "string" ? `/${port.protocol}` : "";
    return published
      ? `${published}:${target}${protocol}`
      : `${target}${protocol}`;
  });
}

function composeDocument(composeFile: string): UnknownRecord {
  let parsed: unknown;
  try {
    parsed = parseYaml(composeFile);
  } catch (error) {
    throw new ValidationError(
      `Compose YAML is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const document = record(parsed);
  const services = record(document.services);
  if (Object.keys(services).length === 0) {
    throw new ValidationError("Compose file must define at least one service");
  }
  return document;
}

function inspect(document: UnknownRecord) {
  const services = record(document.services);
  const warnings: string[] = [];
  const serviceRows = Object.entries(services).map(([name, raw]) => {
    const service = record(raw);
    const build = record(service.build);
    const deploy = record(service.deploy);
    const restart = service.restart;
    if (service.container_name) {
      warnings.push(
        `Service '${name}' uses container_name, which is ignored by Swarm stacks.`,
      );
    }
    if (restart && !deploy.restart_policy) {
      warnings.push(
        `Service '${name}' uses restart; Swarm stacks use deploy.restart_policy.`,
      );
    }
    return {
      name,
      image: typeof service.image === "string" ? service.image : null,
      build:
        Object.keys(build).length > 0
          ? {
              context: typeof build.context === "string" ? build.context : ".",
              dockerfile:
                typeof build.dockerfile === "string"
                  ? build.dockerfile
                  : "Dockerfile",
              target: typeof build.target === "string" ? build.target : null,
            }
          : null,
      command: stringList(service.command),
      dependsOn: stringList(service.depends_on),
      ports: portList(service.ports),
      volumes: stringList(service.volumes),
      networks: stringList(service.networks),
      replicas: typeof deploy.replicas === "number" ? deploy.replicas : 1,
      healthcheck: !!service.healthcheck,
    };
  });

  return {
    version: typeof document.version === "string" ? document.version : null,
    services: serviceRows,
    volumes: Object.keys(record(document.volumes)),
    networks: Object.keys(record(document.networks)),
    configs: Object.keys(record(document.configs)),
    secrets: Object.keys(record(document.secrets)),
    warnings: [...new Set(warnings)],
  };
}

function convert(
  document: UnknownRecord,
  target: "compose" | "stack",
): UnknownRecord {
  const result = structuredClone(document) as UnknownRecord;
  const services = record(result.services);
  if (target === "stack") {
    for (const service of Object.values(services)) {
      const item = record(service);
      if (item.container_name !== undefined) delete item.container_name;
      if (item.restart !== undefined) {
        const deploy = record(item.deploy);
        deploy.restart_policy = {
          condition:
            item.restart === "no"
              ? "none"
              : item.restart === "on-failure"
                ? "on-failure"
                : "any",
        };
        item.deploy = deploy;
        delete item.restart;
      }
    }
  } else if (target === "compose") {
    for (const service of Object.values(services)) {
      const item = record(service);
      if (item.deploy !== undefined && typeof item.deploy === "object") {
        const deploy = record(item.deploy);
        if (
          deploy.restart_policy !== undefined &&
          typeof deploy.restart_policy === "object"
        ) {
          const restartPolicy = record(deploy.restart_policy);
          if (typeof restartPolicy.condition === "string") {
            const cond = restartPolicy.condition;
            item.restart =
              cond === "none"
                ? "no"
                : cond === "on-failure"
                  ? "on-failure"
                  : "always";
          }
          delete deploy.restart_policy;
        }
        if (Object.keys(deploy).length === 0) {
          delete item.deploy;
        } else {
          item.deploy = deploy;
        }
      }
    }
  }
  result.services = services;
  return result;
}

export class InspectComposeUseCase {
  async execute(input: InspectComposeInput) {
    return inspect(composeDocument(input.composeFile));
  }

  async convert(input: ConvertComposeInput) {
    return {
      composeFile: stringifyYaml(
        convert(composeDocument(input.composeFile), input.target),
      ),
      target: input.target,
    };
  }
}
