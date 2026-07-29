import { randomUUID } from "node:crypto";
import type { IUnitOfWork } from "@upstand/domain";
import { readResponseTextLimited } from "@upstand/platform/network/response-body";
import { TriggerBackupRunUseCase } from "@upstand/usecases/backup/trigger-backup-run.usecase";
import { QueueDeploymentUseCase } from "@upstand/usecases/deployment/queue-deployment.usecase";
import { resolveDockerServiceForServer } from "@upstand/usecases/resource/docker-client";
import { parseResourceEnvironmentVariables } from "@upstand/usecases/resource/resource-environment";
import { UnitOfWorkToken } from "@upstand/usecases/tokens";
import * as dependencies from "./dependencies";

type ServiceCollection = InstanceType<typeof dependencies.ServiceCollection>;
type ServiceProviderFactory = () => ReturnType<ServiceCollection["build"]>;

type ResourceSecretRepository = {
  findByResourceId?: (
    resourceId: string,
  ) => Promise<{ envVars?: string | null } | null>;
};

type TransactionWithResourceSecrets = IUnitOfWork & {
  resourceSecretRepository?: ResourceSecretRepository;
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function registerBackups(
  services: ServiceCollection,
  getServiceProvider: ServiceProviderFactory,
) {
  const withScope = async <T>(operation: (uow: IUnitOfWork) => Promise<T>) => {
    const scope = getServiceProvider().createScope();
    try {
      return await operation(scope.resolve(UnitOfWorkToken));
    } finally {
      await scope.dispose();
    }
  };

  // Backups
  services.addSingleton(
    dependencies.BackupSchedulerToken,
    () =>
      new dependencies.BackupScheduler({
        loadSchedules: () =>
          withScope((uow) => uow.backupScheduleRepository.findEnabled()),
        trigger: (scheduleId) =>
          withScope((uow) =>
            new TriggerBackupRunUseCase(uow).execute({ scheduleId }),
          ),
      }),
  );
  services.addSingleton(
    dependencies.GeneralSchedulerToken,
    (c) =>
      new dependencies.GeneralScheduler({
        loadSchedules: () =>
          withScope((uow) => uow.scheduleRepository.findEnabled()),
        execute: (scheduleId, manual) =>
          withScope(async (uow) => {
            const startTime = Date.now();
            const schedule = await uow.scheduleRepository.findById(scheduleId);
            if ((!schedule?.enabled && !manual) || !schedule?.resourceId)
              return;

            const resource = await uow.resourceRepository.findById(
              schedule.resourceId,
            );
            if (!resource) return;

            // Check if cron jobs feature is enabled for this resource (for non-manual runs)
            if (resource.cronJobsEnabled === false && !manual) {
              return;
            }

            const jobType = schedule.jobType ?? "command";

            if (jobType === "deployment") {
              try {
                await new QueueDeploymentUseCase(uow).execute({
                  resourceId: resource.id,
                  title: `Scheduled deployment: ${schedule.name}`,
                });
                const durationMs = Date.now() - startTime;
                await uow.scheduleLogRepository.create({
                  id: randomUUID(),
                  scheduleId: schedule.id,
                  resourceId: resource.id,
                  status: "success",
                  statusCode: 200,
                  durationMs,
                  responseBody: "Deployment queued successfully",
                  errorMessage: null,
                });
                await uow.scheduleRepository.updateById(schedule.id, {
                  lastRunAt: new Date(),
                  lastRunStatus: "success",
                });
              } catch (err: unknown) {
                const durationMs = Date.now() - startTime;
                await uow.scheduleLogRepository.create({
                  id: randomUUID(),
                  scheduleId: schedule.id,
                  resourceId: resource.id,
                  status: "failed",
                  statusCode: 500,
                  durationMs,
                  responseBody: null,
                  errorMessage: getErrorMessage(
                    err,
                    "Failed to queue deployment",
                  ),
                });
                await uow.scheduleRepository.updateById(schedule.id, {
                  lastRunAt: new Date(),
                  lastRunStatus: "failed",
                });
              }
              return;
            }

            if (jobType === "backup") {
              if (!schedule.backupScheduleId) return;
              try {
                await new TriggerBackupRunUseCase(uow).execute({
                  scheduleId: schedule.backupScheduleId,
                });
                const durationMs = Date.now() - startTime;
                await uow.scheduleLogRepository.create({
                  id: randomUUID(),
                  scheduleId: schedule.id,
                  resourceId: resource.id,
                  status: "success",
                  statusCode: 200,
                  durationMs,
                  responseBody: "Backup run triggered successfully",
                  errorMessage: null,
                });
                await uow.scheduleRepository.updateById(schedule.id, {
                  lastRunAt: new Date(),
                  lastRunStatus: "success",
                });
              } catch (err: unknown) {
                const durationMs = Date.now() - startTime;
                await uow.scheduleLogRepository.create({
                  id: randomUUID(),
                  scheduleId: schedule.id,
                  resourceId: resource.id,
                  status: "failed",
                  statusCode: 500,
                  durationMs,
                  responseBody: null,
                  errorMessage: getErrorMessage(
                    err,
                    "Failed to trigger backup run",
                  ),
                });
                await uow.scheduleRepository.updateById(schedule.id, {
                  lastRunAt: new Date(),
                  lastRunStatus: "failed",
                });
              }
              return;
            }

            if (jobType === "cron") {
              // HTTP Cron execution
              let status: "success" | "failed" = "success";
              let statusCode: number | null = null;
              let responseBody: string | null = null;
              let errorMessage: string | null = null;

              try {
                // Determine target URL for resource
                const baseUrl = `http://${resource.appName || resource.id}`;

                let cronSecret = "";
                const resourceSecret = await uow.transaction(async (tx) => {
                  const resourceSecrets = (tx as TransactionWithResourceSecrets)
                    .resourceSecretRepository;
                  return resourceSecrets?.findByResourceId?.(resource.id);
                });
                if (resourceSecret?.envVars) {
                  const envs = parseResourceEnvironmentVariables(
                    resourceSecret.envVars,
                  );
                  cronSecret = schedule.secretEnvVar
                    ? envs[schedule.secretEnvVar] || ""
                    : envs.CRON_SECRET || "";
                }
                if (schedule.secretEnvVar && !cronSecret) {
                  throw new Error(
                    `Configured cron secret environment variable '${schedule.secretEnvVar}' is missing or empty`,
                  );
                }

                const path = schedule.command.startsWith("/")
                  ? schedule.command
                  : `/${schedule.command}`;
                const targetUrl = `${baseUrl}${path}`;

                const headers: Record<string, string> = {
                  "User-Agent": "Upstand-Cron/1.0",
                };
                if (cronSecret) {
                  headers.Authorization = `Bearer ${cronSecret}`;
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30_000);

                const response = await fetch(targetUrl, {
                  method: schedule.httpMethod || "GET",
                  headers,
                  signal: controller.signal,
                });
                clearTimeout(timeoutId);

                statusCode = response.status;
                const text = await readResponseTextLimited(response, 4096);
                responseBody = text.slice(0, 1000);

                if (response.ok) {
                  status = "success";
                } else {
                  status = "failed";
                  errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                }
              } catch (err: unknown) {
                status = "failed";
                errorMessage = getErrorMessage(
                  err,
                  "Failed to send HTTP cron request",
                );
              }

              const durationMs = Date.now() - startTime;
              await uow.scheduleLogRepository.create({
                id: randomUUID(),
                scheduleId: schedule.id,
                resourceId: resource.id,
                status,
                statusCode,
                durationMs,
                responseBody,
                errorMessage,
              });
              await uow.scheduleRepository.updateById(schedule.id, {
                lastRunAt: new Date(),
                lastRunStatus: status,
              });
              return;
            }

            // Command / Script schedule execution
            let status: "success" | "failed" = "success";
            let responseBody: string | null = null;
            let errorMessage: string | null = null;

            const { dockerService, cleanup } =
              await resolveDockerServiceForServer(
                resource.serverId,
                uow,
                c.resolve(dependencies.DockerServiceToken),
              );

            try {
              const escapedCommand = schedule.command.replace(/'/g, "'\\''");
              const execCmd =
                schedule.shellType === "sh"
                  ? `sh -c '${escapedCommand}'`
                  : `bash -c '${escapedCommand}'`;

              const output = await dockerService.runCommandInResourceContainer(
                resource,
                execCmd,
              );
              responseBody = (output || "Command executed successfully").slice(
                0,
                1000,
              );
              status = "success";
            } catch (err: unknown) {
              status = "failed";
              errorMessage = getErrorMessage(err, "Command execution failed");
            } finally {
              cleanup();
            }

            const durationMs = Date.now() - startTime;
            await uow.scheduleLogRepository.create({
              id: randomUUID(),
              scheduleId: schedule.id,
              resourceId: resource.id,
              status,
              statusCode: status === "success" ? 0 : 1,
              durationMs,
              responseBody,
              errorMessage,
            });
            await uow.scheduleRepository.updateById(schedule.id, {
              lastRunAt: new Date(),
              lastRunStatus: status,
            });
          }),
      }),
  );
  services.addTransient(
    dependencies.GetSchedulesUseCaseToken,
    (c) =>
      new dependencies.GetSchedulesUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetScheduleLogsUseCaseToken,
    (c) =>
      new dependencies.GetScheduleLogsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.SyncUpstandConfigUseCaseToken,
    (c) =>
      new dependencies.SyncUpstandConfigUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.CreateScheduleUseCaseToken,
    (c) =>
      new dependencies.CreateScheduleUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateScheduleUseCaseToken,
    (c) =>
      new dependencies.UpdateScheduleUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteScheduleUseCaseToken,
    (c) =>
      new dependencies.DeleteScheduleUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.CreateBackupScheduleUseCaseToken,
    (c) =>
      new dependencies.CreateBackupScheduleUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.CreateWebServerBackupScheduleUseCaseToken,
    (c) =>
      new dependencies.CreateWebServerBackupScheduleUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetBackupSchedulesUseCaseToken,
    (c) =>
      new dependencies.GetBackupSchedulesUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateBackupScheduleUseCaseToken,
    (c) =>
      new dependencies.UpdateBackupScheduleUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.UpdateWebServerBackupScheduleUseCaseToken,
    (c) =>
      new dependencies.UpdateWebServerBackupScheduleUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.DeleteBackupScheduleUseCaseToken,
    (c) =>
      new dependencies.DeleteBackupScheduleUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.GetBackupRunsUseCaseToken,
    (c) =>
      new dependencies.GetBackupRunsUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.TriggerBackupRunUseCaseToken,
    (c) =>
      new dependencies.TriggerBackupRunUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.RestoreBackupRunUseCaseToken,
    (c) =>
      new dependencies.RestoreBackupRunUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.VerifyBackupRunUseCaseToken,
    (c) =>
      new dependencies.VerifyBackupRunUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
  services.addTransient(
    dependencies.ExecuteBackupRunUseCaseToken,
    (c) =>
      new dependencies.ExecuteBackupRunUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
        c.resolve(dependencies.PublishNotificationUseCaseToken),
      ),
  );
  services.addTransient(
    dependencies.ListBackupVolumesUseCaseToken,
    (c) =>
      new dependencies.ListBackupVolumesUseCase(
        c.resolve(dependencies.UnitOfWorkToken),
      ),
  );
}
