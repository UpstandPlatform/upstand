import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";
import {
  BackupRuntimeService,
  withBackupRuntime,
} from "./backup-runtime.service";

export const ListBackupVolumesInputSchema = z.object({
  resourceId: z.string().min(1),
});
export type ListBackupVolumesInput = z.infer<
  typeof ListBackupVolumesInputSchema
>;

export class ListBackupVolumesUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly runtime = new BackupRuntimeService(),
  ) {}

  async execute(input: ListBackupVolumesInput): Promise<string[]> {
    const resource = await this.uow.resourceRepository.findById(
      input.resourceId,
    );
    if (!resource) throw new ValidationError("Resource not found");
    return withBackupRuntime(this.uow, resource, this.runtime, (runtime) =>
      runtime.listVolumes(resource),
    );
  }
}
