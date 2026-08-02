import type {
  Environment,
  EnvironmentSummaryProjection,
  IUnitOfWork,
} from "@upstand/domain";
import { z } from "zod";

export const GetEnvironmentsInputSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
});

export type GetEnvironmentsInput = z.infer<typeof GetEnvironmentsInputSchema>;

export class GetEnvironmentsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: GetEnvironmentsInput,
  ): Promise<EnvironmentSummaryProjection[] | Environment[]> {
    if (this.uow.environmentRepository.findSummariesByProjectId) {
      return this.uow.environmentRepository.findSummariesByProjectId(
        input.projectId,
      );
    }
    return await this.uow.environmentRepository.findByProjectId(
      input.projectId,
    );
  }
}
