import { randomUUID } from "node:crypto";
import type { IUnitOfWork } from "@upstand/domain";
import {
  ApplicationBuildConfigSchema,
  parseApplicationBuildConfig,
  parseResourceAdvancedConfig,
  parseUpstandConfig,
  serializeApplicationBuildConfig,
  serializeResourceAdvancedConfig,
  type UpstandCronConfig,
} from "@upstand/domain";

export interface SyncUpstandConfigInput {
  resourceId: string;
  configContentOrObject: string | unknown;
  onLog?: (msg: string) => void;
}

export interface SyncUpstandConfigResult {
  synced: number;
  added: number;
  updated: number;
  removed: number;
  error?: string;
}

export class SyncUpstandConfigUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: SyncUpstandConfigInput,
  ): Promise<SyncUpstandConfigResult> {
    const { resourceId, configContentOrObject, onLog } = input;

    const parseResult = parseUpstandConfig(configContentOrObject);
    if (!parseResult.success) {
      const msg = `[upstand.json] Failed to parse configuration: ${parseResult.error}\n`;
      if (onLog) onLog(msg);
      return {
        synced: 0,
        added: 0,
        updated: 0,
        removed: 0,
        error: parseResult.error,
      };
    }

    const crons: UpstandCronConfig[] = parseResult.data.crons ?? [];
    if (onLog) {
      onLog(
        `[upstand.json] Processing configuration from upstand.json (${crons.length} cron item(s))...\n`,
      );
    }

    return this.uow.transaction(async (tx) => {
      const resource = await tx.resourceRepository.findById(resourceId);
      if (resource) {
        let resourceUpdated = false;
        const resourcePatch: Partial<typeof resource> = {};

        if (parseResult.data.build) {
          const b = parseResult.data.build;
          const currentBuildConfig = parseApplicationBuildConfig(
            resource.buildConfig,
          );

          const updatedBuildConfig = ApplicationBuildConfigSchema.parse({
            ...currentBuildConfig,
            ...b,
          });

          resourcePatch.buildConfig =
            serializeApplicationBuildConfig(updatedBuildConfig);

          if (b.watchPaths) {
            const pathsArray = Array.isArray(b.watchPaths)
              ? b.watchPaths
              : [b.watchPaths];
            resourcePatch.watchPaths = JSON.stringify(pathsArray);
          }
          resourceUpdated = true;
          if (onLog) {
            onLog("[upstand.json] Synced build configuration\n");
          }
        }

        const runtime = parseResult.data.runtime || parseResult.data.resources;
        if (runtime) {
          const currentAdvancedConfig = parseResourceAdvancedConfig(
            resource.advancedConfig,
          );

          const updatedAdvancedConfig = { ...currentAdvancedConfig };

          if (runtime.command) {
            updatedAdvancedConfig.command = Array.isArray(runtime.command)
              ? runtime.command
              : [runtime.command];
          }
          if (runtime.args) updatedAdvancedConfig.args = runtime.args;
          if (runtime.workingDir)
            updatedAdvancedConfig.workingDir = runtime.workingDir;
          if (runtime.replicas !== undefined)
            updatedAdvancedConfig.replicas = runtime.replicas;

          if (
            runtime.cpuLimit !== undefined ||
            runtime.cpuReservation !== undefined ||
            runtime.memoryLimitMb !== undefined ||
            runtime.memoryReservationMb !== undefined
          ) {
            updatedAdvancedConfig.resources = {
              ...updatedAdvancedConfig.resources,
              ...(runtime.cpuLimit !== undefined
                ? { cpuLimit: runtime.cpuLimit }
                : {}),
              ...(runtime.cpuReservation !== undefined
                ? { cpuReservation: runtime.cpuReservation }
                : {}),
              ...(runtime.memoryLimitMb !== undefined
                ? { memoryLimitMb: runtime.memoryLimitMb }
                : {}),
              ...(runtime.memoryReservationMb !== undefined
                ? { memoryReservationMb: runtime.memoryReservationMb }
                : {}),
            };
          }

          if (runtime.restartPolicy) {
            updatedAdvancedConfig.restartPolicy = {
              ...updatedAdvancedConfig.restartPolicy,
              ...runtime.restartPolicy,
            };
          }

          if (runtime.updateConfig) {
            updatedAdvancedConfig.updateConfig = {
              ...updatedAdvancedConfig.updateConfig,
              ...runtime.updateConfig,
            };
          }

          resourcePatch.advancedConfig = serializeResourceAdvancedConfig(
            updatedAdvancedConfig,
          );
          resourceUpdated = true;
          if (onLog) {
            onLog("[upstand.json] Synced runtime/resource configuration\n");
          }
        }

        if (resourceUpdated) {
          await tx.resourceRepository.updateById(resourceId, resourcePatch);
        }
      }
      const existingSchedules =
        await tx.scheduleRepository.findByResourceId(resourceId);

      // Only manage schedules that were generated from upstand.json
      const upstandSchedules = existingSchedules.filter(
        (s) => s.source === "upstand.json",
      );

      const matchedScheduleIds = new Set<string>();
      let added = 0;
      let updated = 0;

      for (const item of crons) {
        const isHttpCron = Boolean(item.path);
        const jobType = isHttpCron ? "cron" : "command";
        const command = isHttpCron ? (item.path ?? "") : (item.command ?? "");
        const defaultName = isHttpCron
          ? `Cron: ${item.path}`
          : `Schedule: ${command.length > 30 ? `${command.slice(0, 30)}...` : command}`;
        const name = item.name || defaultName;
        const timezone = item.timezone || "UTC";
        const shellType = item.shellType || "bash";
        const serviceName = item.serviceName || null;
        const description = item.description || null;
        const httpMethod = isHttpCron ? item.method || "GET" : null;
        const secretEnvVar = isHttpCron ? item.secretEnvVar || null : null;

        // Attempt to find an existing upstand.json schedule matching this item
        const match = upstandSchedules.find((s) => {
          if (matchedScheduleIds.has(s.id)) return false;
          if (item.name && s.name === item.name) return true;
          if (isHttpCron) {
            return s.jobType === "cron" && s.command === item.path;
          }
          return (
            s.jobType === "command" &&
            s.command === command &&
            (s.serviceName ?? null) === serviceName
          );
        });

        if (match) {
          matchedScheduleIds.add(match.id);
          const hasChanges =
            match.cronExpression !== item.schedule ||
            match.httpMethod !== httpMethod ||
            match.secretEnvVar !== secretEnvVar ||
            match.name !== name ||
            match.description !== description ||
            match.timezone !== timezone ||
            match.shellType !== shellType ||
            (match.serviceName ?? null) !== serviceName ||
            match.command !== command;

          if (hasChanges) {
            await tx.scheduleRepository.updateById(match.id, {
              name,
              description,
              cronExpression: item.schedule,
              httpMethod,
              secretEnvVar,
              timezone,
              jobType,
              serviceName,
              shellType,
              command,
            });
            updated++;
            if (onLog) {
              onLog(
                `[upstand.json] Updated schedule '${name}' (${item.schedule})\n`,
              );
            }
          }
        } else {
          await tx.scheduleRepository.create({
            id: randomUUID(),
            resourceId,
            name,
            description,
            cronExpression: item.schedule,
            httpMethod,
            secretEnvVar,
            timezone,
            jobType,
            serviceName,
            shellType,
            source: "upstand.json",
            command,
            enabled: true,
          });
          added++;
          if (onLog) {
            onLog(
              `[upstand.json] Created new schedule '${name}' (${item.schedule})\n`,
            );
          }
        }
      }

      // Remove obsolete upstand.json schedules that were not in the new file
      let removed = 0;
      for (const existing of upstandSchedules) {
        if (!matchedScheduleIds.has(existing.id)) {
          await tx.scheduleRepository.deleteById(existing.id);
          removed++;
          if (onLog) {
            onLog(
              `[upstand.json] Removed obsolete schedule '${existing.name}'\n`,
            );
          }
        }
      }

      if (onLog) {
        onLog(
          `[upstand.json] Sync completed: ${added} added, ${updated} updated, ${removed} removed.\n`,
        );
      }

      return {
        synced: crons.length,
        added,
        updated,
        removed,
      };
    });
  }
}
