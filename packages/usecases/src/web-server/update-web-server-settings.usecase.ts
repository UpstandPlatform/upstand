import {
  CaddyMiddlewareListSchema,
  type IUnitOfWork,
  serializeCaddyMiddlewares,
  type WebServerSettings,
} from "@upstand/domain";
import { env } from "@upstand/env/server";
import { Cron } from "croner";
import { z } from "zod";
import type { CaddyService } from "./caddy.service";
import { syncServerDomainInCaddySnippets } from "./server-domain-caddy.helper";

export const AccessLogCleanupCronSchema = z
  .string()
  .trim()
  .min(9)
  .max(100)
  .regex(/^(?:\S+\s+){4}\S+$/, "Use a valid five-field cron expression")
  .superRefine((value, context) => {
    try {
      const cron = new Cron(value);
      cron.stop();
    } catch {
      context.addIssue({
        code: "custom",
        message: "Use a valid cron expression",
      });
    }
  });

export const UpdateWebServerSettingsInputSchema = z.object({
  serverDomain: z.string().nullable().optional(),
  httpsEnabled: z.boolean().optional(),
  certificateProvider: z
    .enum(["letsencrypt", "zerossl", "self-signed", "custom", "none"])
    .optional(),
  certificateId: z.string().nullable().optional(),
  letsEncryptEmail: z.string().nullable().optional(),
  cloudflareApiToken: z.string().nullable().optional(),
  httpPort: z.number().int().min(1).max(65535).optional(),
  httpsPort: z.number().int().min(1).max(65535).optional(),
  enableHttp3: z.boolean().optional(),
  globalCaddyfile: z.string().nullable().optional(),
  caddySnippets: z.string().optional(),
  caddyMiddlewares: CaddyMiddlewareListSchema.optional(),
  serverIp: z.string().nullable().optional(),
  dailyDockerCleanup: z.boolean().optional(),
  caddyEnvironment: z
    .string()
    .optional()
    .refine((val) => {
      if (!val) return true;
      try {
        const parsed = JSON.parse(val);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed);
      } catch {
        return false;
      }
    }, "Caddy environment variables must be a valid JSON object"),
  caddyPorts: z
    .string()
    .optional()
    .refine((val) => {
      if (!val) return true;
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed);
      } catch {
        return false;
      }
    }, "Additional Caddy ports must be a valid JSON array"),
  accessLogsEnabled: z.boolean().optional(),
  ipAccessEnabled: z.boolean().optional(),
  accessLogCleanupCron: AccessLogCleanupCronSchema.optional(),
});

export type UpdateWebServerSettingsInput = z.infer<
  typeof UpdateWebServerSettingsInputSchema
>;

export class UpdateWebServerSettingsUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly caddyService: CaddyService,
  ) {}

  async execute(
    input: UpdateWebServerSettingsInput,
  ): Promise<WebServerSettings | null> {
    let settings = await this.uow.webServerSettingsRepository.findGlobal();
    if (!settings) {
      settings = await this.uow.webServerSettingsRepository.createGlobal({});
    }

    const patch: Partial<WebServerSettings> = {};
    if (input.serverDomain !== undefined)
      patch.serverDomain = input.serverDomain;
    if (input.httpsEnabled !== undefined)
      patch.httpsEnabled = input.httpsEnabled;
    if (input.certificateProvider !== undefined)
      patch.certificateProvider = input.certificateProvider;
    if (input.certificateId !== undefined)
      patch.certificateId = input.certificateId;
    if (input.letsEncryptEmail !== undefined)
      patch.letsEncryptEmail = input.letsEncryptEmail;
    if (input.cloudflareApiToken !== undefined)
      patch.cloudflareApiToken = input.cloudflareApiToken;
    if (input.httpPort !== undefined) patch.httpPort = input.httpPort;
    if (input.httpsPort !== undefined) patch.httpsPort = input.httpsPort;
    if (input.enableHttp3 !== undefined) patch.enableHttp3 = input.enableHttp3;
    if (input.globalCaddyfile !== undefined)
      patch.globalCaddyfile = input.globalCaddyfile;
    if (input.caddySnippets !== undefined)
      patch.caddySnippets = input.caddySnippets;
    if (input.caddyMiddlewares !== undefined)
      patch.caddyMiddlewares = serializeCaddyMiddlewares(
        input.caddyMiddlewares,
      );
    if (input.serverIp !== undefined) patch.serverIp = input.serverIp;
    if (input.dailyDockerCleanup !== undefined)
      patch.dailyDockerCleanup = input.dailyDockerCleanup;
    if (input.caddyEnvironment !== undefined)
      patch.caddyEnvironment = input.caddyEnvironment;
    if (input.caddyPorts !== undefined) patch.caddyPorts = input.caddyPorts;
    if (input.accessLogsEnabled !== undefined)
      patch.accessLogsEnabled = input.accessLogsEnabled;
    // Direct control-plane access is the documented break-glass path when DNS
    // or Caddy is unavailable. Keep the legacy field for schema compatibility,
    // but never allow an update to remove the published control-plane ports.
    patch.ipAccessEnabled = true;
    if (input.accessLogCleanupCron !== undefined)
      patch.accessLogCleanupCron = input.accessLogCleanupCron;

    const baseSnippets = patch.caddySnippets ?? settings.caddySnippets;
    patch.caddySnippets = syncServerDomainInCaddySnippets(
      baseSnippets,
      {
        ...settings,
        ...patch,
      },
      {
        reservedDomains: [
          env.UPSTAND_DASHBOARD_HOST,
          env.UPSTAND_API_HOST,
          env.UPSTAND_DOCS_HOST,
        ].filter((value): value is string => Boolean(value)),
      },
    );

    const candidate = { ...settings, ...patch, ipAccessEnabled: true };
    const needsRecreate =
      input.httpPort !== undefined ||
      input.httpsPort !== undefined ||
      input.enableHttp3 !== undefined ||
      input.caddyEnvironment !== undefined ||
      input.caddyPorts !== undefined;
    const resources =
      (await this.uow.resourceRepository.findForCaddy?.()) ??
      (await this.uow.resourceRepository.findMany());
    const certificates =
      (await this.uow.certificateRepository.findAll?.()) ?? [];

    try {
      await this.caddyService.setControlPlaneIpAccess(true);
      await this.caddyService.initializeCaddy(candidate, needsRecreate);
      await this.caddyService.syncResourceConfigs(
        resources,
        candidate,
        certificates,
      );
      return await this.uow.transaction((tx) =>
        tx.webServerSettingsRepository.updateGlobal(patch),
      );
    } catch (error) {
      try {
        await this.caddyService.setControlPlaneIpAccess(true);
      } catch {
        // Preserve the original error; the Swarm service state can be
        // reconciled by retrying the setting update.
      }
      try {
        await this.caddyService.initializeCaddy(settings, needsRecreate);
        await this.caddyService.syncResourceConfigs(
          resources,
          settings,
          certificates,
        );
      } catch {
        // The original error is more useful to the caller. Caddy logs retain the
        // recovery failure for operators.
      }
      throw error;
    }
  }
}
