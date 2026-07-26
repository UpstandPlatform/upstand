import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";

export const GetServerCountInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
});

export type GetServerCountInput = z.infer<typeof GetServerCountInputSchema>;

export class GetServerCountUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetServerCountInput): Promise<number> {
    const servers = await this.uow.serverRepository.findByOrganizationId(
      input.organizationId,
    );
    return servers.length;
  }
}
