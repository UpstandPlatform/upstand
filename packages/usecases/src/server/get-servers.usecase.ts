import type { IUnitOfWork, Server } from "@upstand/domain";
import { z } from "zod";

export const GetServersInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
});

export type GetServersInput = z.infer<typeof GetServersInputSchema>;

export class GetServersUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetServersInput): Promise<Server[]> {
    return this.uow.serverRepository.findByOrganizationId(input.organizationId);
  }
}
