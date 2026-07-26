import type { BackupRun, IUnitOfWork } from "@upstand/domain";
import { z } from "zod";

export const GetBackupRunsInputSchema = z.object({
  resourceId: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(50),
});
export type GetBackupRunsInput = z.infer<typeof GetBackupRunsInputSchema>;

export class GetBackupRunsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetBackupRunsInput): Promise<BackupRun[]> {
    return this.uow.backupRunRepository.findByResourceId(
      input.resourceId,
      input.limit,
    );
  }
}
