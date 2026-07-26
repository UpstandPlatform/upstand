import { randomUUID } from "node:crypto";
import {
  type BackupScheduleView,
  type CreateWebServerBackupScheduleInput,
  CreateWebServerBackupScheduleInputSchema,
  type IUnitOfWork,
  toBackupScheduleView,
  ValidationError,
} from "@upstand/domain";
import { validateBackupTiming } from "./backup-schedule.service";

export type { CreateWebServerBackupScheduleInput } from "@upstand/domain";
export { CreateWebServerBackupScheduleInputSchema } from "@upstand/domain";

export class CreateWebServerBackupScheduleUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: CreateWebServerBackupScheduleInput,
  ): Promise<BackupScheduleView> {
    const parsed = CreateWebServerBackupScheduleInputSchema.parse(input);
    validateBackupTiming(parsed.cronExpression, parsed.timezone);

    const destination = await this.uow.s3DestinationRepository.findById(
      parsed.destinationId,
    );
    if (!destination) {
      throw new ValidationError("Backup destination not found");
    }
    if (destination.organizationId !== parsed.organizationId) {
      throw new ValidationError(
        "Backup destination belongs to another organization",
      );
    }

    const schedule = await this.uow.transaction((tx) =>
      tx.backupScheduleRepository.create({
        id: randomUUID(),
        organizationId: parsed.organizationId,
        resourceId: null,
        destinationId: parsed.destinationId,
        name: parsed.name,
        kind: "web-server",
        cronExpression: parsed.cronExpression,
        timezone: parsed.timezone,
        prefix: parsed.prefix.replace(/^\/+|\/+$/g, ""),
        retentionCount: parsed.retentionCount ?? null,
        enabled: parsed.enabled,
        databaseName: null,
        databaseEngine: null,
        serviceName: null,
        volumeName: null,
        stopService: false,
        encryptedConfiguration: null,
      }),
    );
    return toBackupScheduleView(schedule);
  }
}
