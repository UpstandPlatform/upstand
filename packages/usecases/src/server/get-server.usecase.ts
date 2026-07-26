import type { IUnitOfWork, Server } from "@upstand/domain";
import { z } from "zod";

export const GetServerInputSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
});

export type GetServerInput = z.infer<typeof GetServerInputSchema>;

export class GetServerUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetServerInput): Promise<Server> {
    const server = await this.uow.serverRepository.findById(input.id);
    if (!server || server.organizationId !== input.organizationId) {
      throw new Error("Server not found");
    }
    return server;
  }
}
