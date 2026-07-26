import type { Environment, IUnitOfWork } from "@upstand/domain";
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
}
