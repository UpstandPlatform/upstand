import { publicProcedure, router } from "../index";
import { aiRouter } from "./ai.router";
import { apiKeyRouter } from "./api-key.router";
import { applicationRouter } from "./application.router";
import { auditLogRouter } from "./audit-log.router";
import { authRouter } from "./auth.router";
import { backupRouter } from "./backup.router";
import { certificateRouter } from "./certificate.router";
import { composeRouter } from "./compose.router";
import { containerFileManagerRouter } from "./container-file-manager.router";
import { customRoleRouter } from "./custom-role.router";
import { databaseRouter } from "./database.router";
import { deploymentRouter } from "./deployment.router";
import { dockerRegistryRouter } from "./docker-registry.router";
import { domainRouter } from "./domain.router";
import { environmentRouter } from "./environment.router";
import { gitProviderRouter } from "./git-provider.router";
import { memberRouter } from "./member.router";
import { notificationRouter } from "./notification.router";
import { outboxRouter } from "./outbox.router";
import { projectRouter } from "./project.router";
import { resourceRouter } from "./resource.router";
import { mountRouter, portRouter } from "./resource-config.router";
import { s3DestinationRouter } from "./s3-destination.router";
import { scheduleRouter } from "./schedule.router";
import { scimRouter } from "./scim.router";
import { searchRouter } from "./search.router";
import { secretRouter } from "./secret.router";
import { serverRouter } from "./server.router";
import { sshKeyRouter } from "./ssh-key.router";
import { ssoRouter } from "./sso.router";
import { swarmRouter } from "./swarm.router";
import { tagRouter } from "./tag.router";
import { templateRouter } from "./template.router";
import { webServerRouter } from "./web-server.router";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  project: projectRouter,
  environment: environmentRouter,
  resource: resourceRouter,
  application: applicationRouter,
  database: databaseRouter,
  domain: domainRouter,
  sshKey: sshKeyRouter,
  gitProvider: gitProviderRouter,
  compose: composeRouter,
  port: portRouter,
  mount: mountRouter,
  s3Destination: s3DestinationRouter,
  auth: authRouter,
  webServer: webServerRouter,
  swarm: swarmRouter,
  deployment: deploymentRouter,
  dockerRegistry: dockerRegistryRouter,
  server: serverRouter,
  notification: notificationRouter,
  outbox: outboxRouter,
  member: memberRouter,
  customRole: customRoleRouter,
  backup: backupRouter,
  certificate: certificateRouter,
  ai: aiRouter,
  apiKey: apiKeyRouter,
  auditLog: auditLogRouter,
  tag: tagRouter,
  template: templateRouter,
  search: searchRouter,
  scim: scimRouter,
  schedule: scheduleRouter,
  sso: ssoRouter,
  containerFileManager: containerFileManagerRouter,
  secret: secretRouter,
});

export type AppRouter = typeof appRouter;
