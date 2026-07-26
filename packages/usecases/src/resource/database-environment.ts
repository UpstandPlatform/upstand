import type { Resource } from "@upstand/domain";
import { parseResourceCredentials } from "./resource-credentials";
import { parseResourceEnvironmentVariables } from "./resource-environment";

type DatabaseCredentials = Record<string, string>;

/**
 * Derive the environment owned by a database engine from its protected
 * credentials. These values are distinct from user-managed resource variables.
 */
export function getManagedDatabaseEnvironment(
  resource: Resource,
): Record<string, string> {
  const credentials: DatabaseCredentials = {};

  for (const [key, value] of Object.entries(
    parseResourceCredentials(resource.credentials),
  )) {
    if (typeof value === "string") credentials[key] = value;
  }

  const databaseEnvironment: Record<string, string> = {};
  const dbType = resource.dbType?.toLowerCase() || "";
  if (dbType === "postgres") {
    if (credentials.dbUser)
      databaseEnvironment.POSTGRES_USER = credentials.dbUser;
    if (credentials.dbPassword)
      databaseEnvironment.POSTGRES_PASSWORD = credentials.dbPassword;
    if (credentials.dbName)
      databaseEnvironment.POSTGRES_DB = credentials.dbName;
  } else if (dbType === "mysql" || dbType === "mariadb") {
    if (credentials.dbRootPassword)
      databaseEnvironment.MYSQL_ROOT_PASSWORD = credentials.dbRootPassword;
    if (credentials.dbUser) databaseEnvironment.MYSQL_USER = credentials.dbUser;
    if (credentials.dbPassword)
      databaseEnvironment.MYSQL_PASSWORD = credentials.dbPassword;
    if (credentials.dbName)
      databaseEnvironment.MYSQL_DATABASE = credentials.dbName;
  } else if (dbType === "mongodb") {
    if (credentials.dbUser)
      databaseEnvironment.MONGO_INITDB_ROOT_USERNAME = credentials.dbUser;
    if (credentials.dbPassword)
      databaseEnvironment.MONGO_INITDB_ROOT_PASSWORD = credentials.dbPassword;
  } else if (dbType === "redis") {
    if (credentials.dbPassword)
      databaseEnvironment.REDIS_PASSWORD = credentials.dbPassword;
  } else if (dbType === "libsql") {
    if (credentials.dbUser && credentials.dbPassword) {
      databaseEnvironment.SQLD_HTTP_AUTH = `basic:${Buffer.from(`${credentials.dbUser}:${credentials.dbPassword}`).toString("base64")}`;
    }
  }

  return databaseEnvironment;
}

/** Resolve the complete runtime environment without persisting derived secrets twice. */
export function getDatabaseEnvironment(
  resource: Resource,
): Record<string, string> {
  return {
    ...getManagedDatabaseEnvironment(resource),
    ...parseResourceEnvironmentVariables(resource.envVars),
  };
}
