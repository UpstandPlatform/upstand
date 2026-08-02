import type {
  Environment,
  EnvironmentSummaryProjection,
  IUnitOfWork,
} from "@upstand/domain";
import { z } from "zod";

export const GetEnvironmentInputSchema = z.object({
  id: z.string().min(1, "Environment ID is required"),
});

export type GetEnvironmentInput = z.infer<typeof GetEnvironmentInputSchema>;

export class GetEnvironmentUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetEnvironmentInput): Promise<Environment | null> {
    return this.uow.transaction(async (tx) => {
      return await tx.environmentRepository.findById(input.id);
    });
  }

  async executeSummary(
    input: GetEnvironmentInput,
  ): Promise<EnvironmentSummaryProjection | null> {
    return this.uow.transaction(async (tx) => {
      if (tx.environmentRepository.findSummaryById) {
        return tx.environmentRepository.findSummaryById(input.id);
      }

      const environment = await tx.environmentRepository.findById(input.id);
      if (!environment) return null;
      const { envVars, ...summary } = environment;
      return {
        ...summary,
        envVarsConfigured: Boolean(envVars),
      };
    });
  }
}
