import {
  type ApiKeyRoute as CatalogApiKeyRoute,
  API_KEY_ROUTE_CAPABILITIES as catalogRouteCapabilities,
} from "@upstand/domain";

/**
 * API-key capability declarations are transport policy, not domain data.
 * The domain export remains a compatibility source until all consumers move
 * to this application-owned registry.
 */
export const API_KEY_ROUTE_CAPABILITIES = catalogRouteCapabilities;
export type ApiKeyRoute = CatalogApiKeyRoute;

/**
 * Procedures that deliberately require an interactive session. Keeping this
 * list explicit makes new procedures fail closed instead of silently becoming
 * API-key accessible or silently bypassing coverage review.
 */
export const SESSION_ONLY_PROCEDURES = [
  "apiKey.create",
  "apiKey.list",
  "apiKey.revoke",
  "apiKey.update",
  "auth.isSession2faVerified",
  "backup.verifyRun",
  "backup.createWebServerSchedule",
  "backup.deleteWebServerSchedule",
  "backup.listWebServerRuns",
  "backup.listWebServerSchedules",
  "backup.restoreWebServer",
  "backup.runWebServerNow",
  "backup.updateWebServerSchedule",
  "containerFileManager.listFiles",
  "containerFileManager.readFile",
  "containerFileManager.writeFile",
  "containerFileManager.createItem",
  "containerFileManager.deleteItem",
  "containerFileManager.renameItem",
  "containerFileManager.changePermissions",
  "containerFileManager.searchFiles",
  "customRole.create",
  "customRole.list",
  "customRole.remove",
  "customRole.update",
  "database.runMigration",
  "deployment.retryDeployment",
  "environment.clone",
  "environment.diff",
  "environment.promote",
  "gitProvider.createGithubManifestState",
  "gitProvider.createOAuthState",
  "member.create",
  "member.invite",
  "member.list",
  "member.remove",
  "member.update",
  "outbox.deadLetters",
  "outbox.retryDeadLetter",
  "outbox.summary",
  "resource.getSecrets",
  "secret.createProvider",
  "secret.deleteProvider",
  "secret.providers",
  "secret.restore",
  "secret.rotate",
  "secret.sync",
  "secret.testConnection",
  "secret.updateProvider",
  "secret.versions",
  "secret.version",
  "secret.rotationSchedules",
  "secret.createRotationSchedule",
  "secret.updateRotationSchedule",
  "secret.deleteRotationSchedule",
  "server.migrateResource",
  "schedule.listForOrganization",
  "scim.create",
  "scim.list",
  "scim.remove",
  "scim.rotate",
  "sso.getSettings",
  "sso.updateSettings",
  "swarm.getInfo",
  "swarm.getJoinCommand",
  "swarm.getJoinCommands",
  "swarm.getNodes",
  "swarm.getTasks",
  "swarm.initSwarm",
  "swarm.removeNode",
  "swarm.rotateJoinToken",
  "swarm.updateNode",
  "topology.getGraph",
  "webServer.accessLogStats",
  "webServer.accessLogStatus",
  "webServer.accessLogs",
  "webServer.checkForUpdates",
  "webServer.checkGpuStatus",
  "webServer.cleanAll",
  "webServer.cleanAllDeploymentQueue",
  "webServer.cleanDockerBuilder",
  "webServer.cleanDockerPrune",
  "webServer.cleanRedis",
  "webServer.cleanStoppedContainers",
  "webServer.cleanUnusedImages",
  "webServer.cleanUnusedVolumes",
  "webServer.getLogs",
  "webServer.getServerLogs",
  "webServer.getSettings",
  "webServer.getSystemStatus",
  "webServer.getUpdateData",
  "webServer.reload",
  "webServer.reloadRedis",
  "webServer.reloadServer",
  "webServer.securityAudit",
  "webServer.setupGpuSupport",
  "webServer.toggleAccessLogs",
  "webServer.triggerUpdate",
  "webServer.updateAccessLogCleanup",
  "webServer.updateServerIp",
  "webServer.updateSettings",
] as const;

export type SessionOnlyProcedure = (typeof SESSION_ONLY_PROCEDURES)[number];

export const PUBLIC_PROCEDURES = [
  "healthCheck",
  "platform.getCapabilities",
] as const;

export function authorizationCoverageGaps(
  procedurePaths: readonly string[],
): string[] {
  const declared = new Set<string>([
    ...Object.keys(API_KEY_ROUTE_CAPABILITIES),
    ...SESSION_ONLY_PROCEDURES,
    ...PUBLIC_PROCEDURES,
  ]);
  return procedurePaths.filter((path) => !declared.has(path));
}

export function staleAuthorizationDeclarations(
  procedurePaths: readonly string[],
): string[] {
  const actual = new Set(procedurePaths);
  return Object.keys(API_KEY_ROUTE_CAPABILITIES).filter(
    (path) => !actual.has(path),
  );
}

export function staleSessionOnlyDeclarations(
  procedurePaths: readonly string[],
): string[] {
  const actual = new Set(procedurePaths);
  return SESSION_ONLY_PROCEDURES.filter((path) => !actual.has(path));
}
