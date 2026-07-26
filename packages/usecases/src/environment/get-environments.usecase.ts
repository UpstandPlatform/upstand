import type { Environment, IUnitOfWork } from "@upstand/domain";
import { z } from "zod";

export const GetEnvironmentsInputSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
});

export type GetEnvironmentsInput = z.infer<typeof GetEnvironmentsInputSchema>;

export class GetEnvironmentsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetEnvironmentsInput): Promise<Environment[]> {
    return await this.uow.environmentRepository.findByProjectId(
      input.projectId,
    );
  }
}
