import {
  type BackupScheduleView,
  type IUnitOfWork,
  toBackupScheduleView,
} from "@upstand/domain";
import { z } from "zod";

export const GetBackupSchedulesInputSchema = z.object({
  resourceId: z.string().min(1),
});
export type GetBackupSchedulesInput = z.infer<
  typeof GetBackupSchedulesInputSchema
>;

export class GetBackupSchedulesUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetBackupSchedulesInput): Promise<BackupScheduleView[]> {
    const schedules = await this.uow.backupScheduleRepository.findByResourceId(
      input.resourceId,
    );
    return schedules.map(toBackupScheduleView);
  }
}
