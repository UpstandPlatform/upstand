import { randomBytes, randomUUID } from "node:crypto";
import yaml from "yaml";
import catalog from "./catalog.json";

export type NativeTemplateMetadata = {
  id: string;
  name: string;
  version: string;
  description: string;
  logo: string;
  links: Record<string, string | undefined>;
  tags: string[];
  logoUrl?: string;
};

export type NativeTemplate = NativeTemplateMetadata & {
  composeFile: string;
  variables: Record<string, string>;
  source: "builtin";
};

type RawTemplate = Omit<NativeTemplateMetadata, "links" | "logoUrl"> & {
  links: Record<string, string | undefined>;
  composeFile: string;
  variables: Record<string, string>;
};

const rawCatalog = catalog as unknown as RawTemplate[];

function randomToken(length: number): string {
  return randomBytes(Math.ceil(length * 0.75))
    .toString("base64url")
    .slice(0, length)
    .toLowerCase();
}

function renderValue(value: string, variables: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, expression: string) => {
    if (expression === "password") return randomToken(16);
    if (expression.startsWith("password:")) {
      return randomToken(Number.parseInt(expression.slice(9), 10) || 16);
    }
    if (expression === "base64") return randomBytes(32).toString("base64");
    if (expression.startsWith("base64:")) {
      return randomBytes(
        Number.parseInt(expression.slice(7), 10) || 32,
      ).toString("base64");
    }
    if (expression === "hash") return randomToken(8);
    if (expression.startsWith("hash:")) {
      return randomToken(Number.parseInt(expression.slice(5), 10) || 8);
    }
    if (expression === "uuid") return randomUUID();
    if (expression === "timestamp" || expression === "timestampms") {
      return Date.now().toString();
    }
    if (expression === "timestamps") {
      return Math.floor(Date.now() / 1000).toString();
    }
    if (expression === "email") return `admin-${randomToken(6)}@example.com`;
    if (expression === "username") return `admin-${randomToken(6)}`;
    return expression in variables ? (variables[expression] ?? match) : match;
  });
}

function renderVariables(raw: Record<string, string>): Record<string, string> {
  const variables = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, renderValue(value, {})]),
  );
  for (let pass = 0; pass < 3; pass += 1) {
    for (const [key, value] of Object.entries(variables)) {
      variables[key] = renderValue(value, variables);
    }
  }
  return variables;
}

function normalizeRelativeMounts(composeFile: string, templateId: string) {
  const document = yaml.parse(composeFile) as Record<string, unknown>;
  const services = document.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    return composeFile;
  }
  const rootVolumes =
    document.volumes &&
    typeof document.volumes === "object" &&
    !Array.isArray(document.volumes)
      ? (document.volumes as Record<string, unknown>)
      : {};

  for (const [serviceName, rawService] of Object.entries(
    services as Record<string, unknown>,
  )) {
    if (
      !rawService ||
      typeof rawService !== "object" ||
      Array.isArray(rawService)
    )
      continue;
    const service = rawService as Record<string, unknown>;
    if (!Array.isArray(service.volumes)) continue;
    service.volumes = service.volumes.map((volume, index) => {
      if (typeof volume !== "string") return volume;
      const parts = volume.split(":");
      const source = parts[0] ?? "";
      if (!(source.startsWith("./") || source.startsWith("../"))) return volume;
      const target = parts[1];
      if (!target) return volume;
      const name = `${templateId}-${serviceName}-${index}`.replace(
        /[^a-zA-Z0-9_.-]/g,
        "-",
      );
      rootVolumes[name] = rootVolumes[name] ?? {};
      return [name, target, ...parts.slice(2)].join(":");
    });
  }
  if (Object.keys(rootVolumes).length > 0) document.volumes = rootVolumes;
  return yaml.stringify(document);
}

export function listNativeTemplates(search?: string): NativeTemplateMetadata[] {
  const normalized = search?.trim().toLocaleLowerCase();
  return rawCatalog
    .filter((template) => {
      if (!normalized) return true;
      return [template.name, template.description, ...template.tags].some(
        (value) => value.toLocaleLowerCase().includes(normalized),
      );
    })
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(({ composeFile: _composeFile, variables: _variables, ...metadata }) =>
      toNativeTemplateMetadata(metadata),
    );
}

export const NATIVE_TEMPLATE_ASSET_BASE_URL =
  "https://raw.githubusercontent.com/Dokploy/templates/canary/blueprints";

function toNativeTemplateMetadata(
  template: Omit<RawTemplate, "composeFile" | "variables">,
): NativeTemplateMetadata {
  return {
    ...template,
    logoUrl: `${NATIVE_TEMPLATE_ASSET_BASE_URL}/${encodeURIComponent(template.id)}/${encodeURIComponent(template.logo)}`,
  };
}

export function getNativeTemplate(templateId: string): NativeTemplate {
  const template = rawCatalog.find((candidate) => candidate.id === templateId);
  if (!template)
    throw new Error(`Built-in template '${templateId}' was not found.`);
  const variables = renderVariables(template.variables);
  return {
    ...template,
    ...toNativeTemplateMetadata(template),
    variables,
    composeFile: normalizeRelativeMounts(
      renderValue(template.composeFile, variables),
      template.id,
    ),
    source: "builtin",
  };
}

export const NATIVE_TEMPLATE_COUNT = rawCatalog.length;
