import type { IUnitOfWork, Resource } from "@upstand/domain";
import { z } from "zod";

export const GetResourceInputSchema = z.object({
  id: z.string().min(1, "Resource ID is required"),
});

export type GetResourceInput = z.infer<typeof GetResourceInputSchema>;

export class GetResourceUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetResourceInput): Promise<Resource | null> {
    return this.uow.transaction(async (tx) => {
      return await tx.resourceRepository.findById(input.id);
    });
  }
}
