import {
  type BackupScheduleView,
  type IUnitOfWork,
  toBackupScheduleView,
  ValidationError,
} from "@upstand/domain";
import { z } from "zod";
import { validateBackupTiming } from "./backup-schedule.service";

export const UpdateWebServerBackupScheduleInputSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  destinationId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  cronExpression: z.string().trim().min(1).max(120).optional(),
  timezone: z.string().trim().min(1).max(120).optional(),
  prefix: z
    .string()
    .trim()
    .max(512)
    .refine(
      (value) => !value.split("/").includes(".."),
      "Prefix cannot contain '..'",
    )
    .optional(),
  retentionCount: z.number().int().positive().max(3650).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateWebServerBackupScheduleInput = z.infer<
  typeof UpdateWebServerBackupScheduleInputSchema
>;

export class UpdateWebServerBackupScheduleUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: UpdateWebServerBackupScheduleInput,
  ): Promise<BackupScheduleView> {
    const parsed = UpdateWebServerBackupScheduleInputSchema.parse(input);
    const existing = await this.uow.backupScheduleRepository.findById(
      parsed.id,
    );
    if (existing?.kind !== "web-server") {
      throw new ValidationError("Web-server backup schedule not found");
    }
    if (existing.organizationId !== parsed.organizationId) {
      throw new ValidationError(
        "Backup schedule belongs to another organization",
      );
    }

    const cronExpression = parsed.cronExpression ?? existing.cronExpression;
    const timezone = parsed.timezone ?? existing.timezone;
    validateBackupTiming(cronExpression, timezone);

    const destinationId = parsed.destinationId ?? existing.destinationId;
    const destination =
      await this.uow.s3DestinationRepository.findById(destinationId);
    if (!destination) throw new ValidationError("Backup destination not found");
    if (destination.organizationId !== parsed.organizationId) {
      throw new ValidationError(
        "Backup destination belongs to another organization",
      );
    }

    const updated = await this.uow.backupScheduleRepository.updateById(
      parsed.id,
      {
        destinationId,
        name: parsed.name ?? existing.name,
        cronExpression,
        timezone,
        prefix: (parsed.prefix ?? existing.prefix).replace(/^\/+|\/+$/g, ""),
        retentionCount:
          parsed.retentionCount === undefined
            ? existing.retentionCount
            : parsed.retentionCount,
        enabled: parsed.enabled ?? existing.enabled,
      },
    );
    if (!updated)
      throw new ValidationError("Web-server backup schedule not found");
    return toBackupScheduleView(updated);
  }
}
