import type { DockerRegistry, IUnitOfWork } from "@upstand/domain";
import { z } from "zod";

export const GetDockerRegistriesInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
});

export type GetDockerRegistriesInput = z.infer<
  typeof GetDockerRegistriesInputSchema
>;

export class GetDockerRegistriesUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetDockerRegistriesInput): Promise<DockerRegistry[]> {
    return this.uow.dockerRegistryRepository.findByOrganizationId(
      input.organizationId,
    );
  }
}
