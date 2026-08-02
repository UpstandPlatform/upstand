import { randomBytes } from "node:crypto";
import { ValidationError } from "@upstand/domain";

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function generatedSecret(): string {
  return randomBytes(32).toString("base64url");
}

function setIfMissing(
  credentials: Record<string, unknown>,
  key: string,
  value: string,
): void {
  if (!hasText(credentials[key])) credentials[key] = value;
}

export function requiredManagedDatabaseCredentialKeys(
  databaseType: string,
): string[] {
  switch (databaseType.toLowerCase()) {
    case "postgres":
      return ["POSTGRES_PASSWORD"];
    case "mysql":
    case "mariadb":
      return ["MYSQL_ROOT_PASSWORD", "MYSQL_PASSWORD"];
    case "mongodb":
      return ["MONGO_INITDB_ROOT_PASSWORD"];
    case "redis":
      return ["REDIS_PASSWORD"];
    case "libsql":
      return ["SQLD_HTTP_AUTH"];
    default:
      return [];
  }
}

export function assertManagedDatabaseCredentials(
  databaseType: string,
  environment: Record<string, string>,
): void {
  for (const key of requiredManagedDatabaseCredentialKeys(databaseType)) {
    if (!environment[key]?.trim()) {
      throw new ValidationError(
        `Managed ${databaseType} deployment requires ${key}; configure database credentials before deploying`,
      );
    }
  }
}

/**
 * Ensure managed database resources have unique credentials before their
 * encrypted credential document is persisted. User-provided values are
 * preserved so updates and imports remain stable.
 */
export function ensureManagedDatabaseCredentials(
  databaseType: string | undefined,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const credentials = { ...current };

  switch (databaseType?.toLowerCase()) {
    case "postgres":
      setIfMissing(credentials, "dbUser", "upstand");
      setIfMissing(credentials, "dbPassword", generatedSecret());
      setIfMissing(credentials, "dbName", "upstand");
      break;
    case "mysql":
    case "mariadb":
      setIfMissing(credentials, "dbRootPassword", generatedSecret());
      setIfMissing(credentials, "dbUser", "upstand");
      setIfMissing(credentials, "dbPassword", generatedSecret());
      setIfMissing(credentials, "dbName", "upstand");
      break;
    case "mongodb":
      setIfMissing(credentials, "dbUser", "upstand");
      setIfMissing(credentials, "dbPassword", generatedSecret());
      break;
    case "redis":
      setIfMissing(credentials, "dbPassword", generatedSecret());
      break;
    case "libsql":
      setIfMissing(credentials, "dbUser", "upstand");
      setIfMissing(credentials, "dbPassword", generatedSecret());
      break;
  }

  return credentials;
}
