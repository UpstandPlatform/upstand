import { ValidationError } from "@upstand/domain";
import {
  decryptSecret,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";
import yaml from "yaml";
import { z } from "zod";

export const ResourceEnvironmentVariableNameSchema = z
  .string()
  .max(256)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "Environment variable names must use POSIX identifier syntax",
  );

export const ResourceEnvironmentVariablesSchema = z.record(
  ResourceEnvironmentVariableNameSchema,
  z.string().max(16_384),
);

type EncryptedResourceEnvironment = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEncryptedResourceEnvironment(
  value: unknown,
): value is EncryptedResourceEnvironment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ciphertext === "string" &&
    typeof candidate.iv === "string" &&
    typeof candidate.authTag === "string" &&
    typeof candidate.keyVersion === "number"
  );
}

function parseEnvironmentObject(value: unknown): Record<string, string> {
  const parsed = ResourceEnvironmentVariablesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function parseEnvironmentObjectForWrite(
  value: unknown,
): Record<string, string> {
  const parsed = ResourceEnvironmentVariablesSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const location = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
  throw new ValidationError(
    `Invalid environment variables${location}: ${issue?.message ?? "expected a key/value object"}`,
  );
}

/**
 * Environment variables are encrypted as one authenticated document. The
 * decoder intentionally accepts legacy plaintext JSON so existing rows remain
 * deployable and are upgraded the next time they are written.
 */
export function parseResourceEnvironmentVariables(
  value: string | null | undefined,
): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isEncryptedResourceEnvironment(parsed)) {
      return parseEnvironmentObject(JSON.parse(decryptSecret(parsed)));
    }
    return parseEnvironmentObject(parsed);
  } catch {
    return {};
  }
}

export function serializeResourceEnvironmentVariables(
  value: string | Record<string, string> | null | undefined,
): string {
  let variables: Record<string, string>;
  if (typeof value === "string") {
    if (!value.trim()) {
      variables = {};
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value) as unknown;
      } catch {
        throw new ValidationError("Environment variables must be valid JSON");
      }
      if (isEncryptedResourceEnvironment(parsed)) return value;
      variables = parseEnvironmentObjectForWrite(parsed);
    }
  } else {
    variables = parseEnvironmentObjectForWrite(value ?? {});
  }
  return JSON.stringify(encryptSecret(JSON.stringify(variables)));
}

export function extractAndParametrizeEnvVars(composeFile: string): {
  composeFile: string;
  envVars: Record<string, string>;
} {
  let finalComposeFile = composeFile;
  const envVars: Record<string, string> = {};
  let parsed: unknown;
  try {
    parsed = yaml.parse(composeFile);
  } catch {
    return { composeFile, envVars };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("services" in parsed) ||
    typeof parsed.services !== "object" ||
    parsed.services === null ||
    Array.isArray(parsed.services)
  ) {
    return { composeFile: finalComposeFile, envVars };
  }

  const services: Record<string, unknown> = isRecord(parsed.services)
    ? parsed.services
    : {};
  for (const serviceName of Object.keys(services)) {
    const serviceValue: unknown = services[serviceName];
    if (
      !serviceValue ||
      typeof serviceValue !== "object" ||
      Array.isArray(serviceValue) ||
      !("environment" in serviceValue)
    ) {
      continue;
    }
    const service: Record<string, unknown> = isRecord(serviceValue)
      ? serviceValue
      : {};
    const environment: unknown = service.environment;
    if (environment !== undefined && environment !== null) {
      if (Array.isArray(environment)) {
        const newEnvList: unknown[] = [];
        const environmentItems: unknown[] = environment;
        for (const item of environmentItems) {
          if (typeof item === "string") {
            const index = item.indexOf("=");
            if (index > -1) {
              const key = item.slice(0, index).trim();
              const val = item.slice(index + 1).trim();
              if (key) {
                envVars[key] = val;
                newEnvList.push(`${key}=\${${key}}`);
              }
            } else {
              const key = item.trim();
              if (key) {
                envVars[key] = "";
                newEnvList.push(`${key}=\${${key}}`);
              }
            }
          } else {
            newEnvList.push(item);
          }
        }
        service.environment = newEnvList;
      } else if (typeof environment === "object") {
        const newEnvObj: Record<string, string> = {};
        for (const [key, value] of Object.entries(environment)) {
          const normalizedKey = key.trim();
          if (normalizedKey) {
            envVars[normalizedKey] =
              value !== null && value !== undefined ? String(value).trim() : "";
            newEnvObj[normalizedKey] = `\${${normalizedKey}}`;
          }
        }
        service.environment = newEnvObj;
      }
    }
  }
  finalComposeFile = yaml.stringify(parsed);

  return { composeFile: finalComposeFile, envVars };
}

/**
 * PROJECT-LEVEL VARIABLE SUBSTITUTION
 *
 * Resources can reference project-level environment variables using the syntax:
 *   DATABASE_URL=${{project.DATABASE_URL}}
 *
 * At deploy time, these placeholders are resolved against the current
 * environment's project-level variables before the env vars are injected into
 * the container. Unresolvable references evaluate to an empty string.
 */

/** Regex that matches ${{project.VAR_NAME}} or ${{env.VAR_NAME}} with optional surrounding spaces. */
const PROJECT_VAR_PATTERN =
  /\$\{\{\s*(?:project|env)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Substitutes all `${{project.VAR_NAME}}` or `${{env.VAR_NAME}}` placeholders found in the *values*
 * of `resourceEnvVars` with the corresponding value from `projectEnvVars`.
 * Placeholders that have no matching project variable resolve to an empty string.
 *
 * Keys are never transformed.
 */
export function substituteProjectEnvVars(
  resourceEnvVars: Record<string, string>,
  projectEnvVars: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(resourceEnvVars)) {
    result[key] = value.replace(
      PROJECT_VAR_PATTERN,
      (_match, varName: string) => projectEnvVars[varName] ?? "",
    );
  }
  return result;
}

/**
 * Parses the raw encrypted/serialised environment variable strings for both
 * the resource and the project environment, then returns a merged record where
 * `${{project.VAR_NAME}}` placeholders in resource values are resolved.
 *
 * This is the single entry point used by the deployment pipeline.
 */
export function resolveResourceEnvironmentVariables(
  rawResourceEnvVars: string | null | undefined,
  rawProjectEnvVars: string | null | undefined,
): Record<string, string> {
  const resourceVars = parseResourceEnvironmentVariables(rawResourceEnvVars);
  const projectVars = parseResourceEnvironmentVariables(rawProjectEnvVars);
  return substituteProjectEnvVars(resourceVars, projectVars);
}

/**
 * Build processes retain the historical runtime variables for compatibility,
 * then layer explicitly build-only variables on top. Build-only values never
 * flow back into the container runtime environment.
 */
export function resolveResourceBuildEnvironmentVariables(
  rawBuildEnvVars: string | null | undefined,
  rawRuntimeEnvVars: string | null | undefined,
  rawProjectEnvVars: string | null | undefined,
): Record<string, string> {
  return {
    ...resolveResourceEnvironmentVariables(
      rawRuntimeEnvVars,
      rawProjectEnvVars,
    ),
    ...resolveResourceEnvironmentVariables(rawBuildEnvVars, rawProjectEnvVars),
  };
}
