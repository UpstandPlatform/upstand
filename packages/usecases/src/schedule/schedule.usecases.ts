import { randomUUID } from "node:crypto";
import type {
  CreateScheduleInput,
  DeleteScheduleInput,
  GetSchedulesInput,
  IUnitOfWork,
  Schedule,
  UpdateScheduleInput,
} from "@upstand/domain";
import {
  CreateScheduleInputSchema,
  DeleteScheduleInputSchema,
  GetSchedulesInputSchema,
  ScheduleCommandSchema,
  UpdateScheduleInputSchema,
} from "@upstand/domain";
import { Cron } from "croner";
import { z } from "zod";

function validateCron(expression: string): void {
  try {
    const cron = new Cron(expression);
    cron.stop();
  } catch {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["cronExpression"],
        message: "Enter a valid cron expression",
      },
    ]);
  }
}

export class GetSchedulesUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetSchedulesInput): Promise<Schedule[]> {
    return this.uow.scheduleRepository.findByResourceId(
      GetSchedulesInputSchema.parse(input).resourceId,
    );
  }
}

export class CreateScheduleUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: CreateScheduleInput): Promise<Schedule> {
    const parsed = CreateScheduleInputSchema.parse(input);
    validateCron(parsed.cronExpression);
    const resource = await this.uow.resourceRepository.findById(
      parsed.resourceId,
    );
    if (!resource) throw new Error("Resource not found");
    if (parsed.jobType === "backup") {
      const backupSchedule = parsed.backupScheduleId
        ? await this.uow.backupScheduleRepository.findById(
            parsed.backupScheduleId,
          )
        : null;
      if (!backupSchedule || backupSchedule.resourceId !== resource.id) {
        throw new Error("Backup schedule not found for this resource");
      }
    }
    return this.uow.scheduleRepository.create({
      id: randomUUID(),
      resourceId: parsed.resourceId,
      name: parsed.name,
      description: parsed.description ?? null,
      cronExpression: parsed.cronExpression,
      httpMethod: parsed.httpMethod ?? null,
      secretEnvVar: parsed.secretEnvVar ?? null,
      timezone: parsed.timezone ?? "UTC",
      jobType: parsed.jobType,
      serviceName: parsed.serviceName ?? null,
      shellType: parsed.shellType ?? "bash",
      source: parsed.source ?? "manual",
      command: parsed.command ?? "",
      enabled: parsed.enabled ?? true,
      backupScheduleId:
        parsed.jobType === "backup" ? (parsed.backupScheduleId ?? null) : null,
    });
  }
}

export class UpdateScheduleUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: UpdateScheduleInput): Promise<Schedule> {
    const parsed = UpdateScheduleInputSchema.parse(input);
    const existing = await this.uow.scheduleRepository.findById(parsed.id);
    if (!existing) throw new Error("Schedule not found");
    if (parsed.cronExpression) validateCron(parsed.cronExpression);
    const { id, ...patch } = parsed;
    const jobType = parsed.jobType ?? existing.jobType ?? "command";
    const resourceId = existing.resourceId;
    const command = parsed.command ?? existing.command;
    if (
      (jobType === "command" || jobType === "cron") &&
      !ScheduleCommandSchema.safeParse(command).success
    ) {
      throw new Error(
        jobType === "cron"
          ? "A path is required for HTTP cron schedules"
          : "A command is required for command schedules",
      );
    }
    if (jobType === "backup") {
      const backupScheduleId =
        parsed.backupScheduleId ?? existing.backupScheduleId;
      const backupSchedule = backupScheduleId
        ? await this.uow.backupScheduleRepository.findById(backupScheduleId)
        : null;
      if (!backupSchedule || backupSchedule.resourceId !== resourceId) {
        throw new Error("Backup schedule not found for this resource");
      }
    }
    const updated = await this.uow.scheduleRepository.updateById(id, patch);
    if (!updated) throw new Error("Schedule not found");
    return updated;
  }
}

export class DeleteScheduleUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeleteScheduleInput): Promise<boolean> {
    return this.uow.scheduleRepository.deleteById(
      DeleteScheduleInputSchema.parse(input).id,
    );
  }
}
