import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import type { DockerPruneOptions, DockerPrunePort } from "../ports/docker";
import { resolveDockerInspectionTarget } from "./docker-inspection-target.helper";

export const PruneDockerResourcesInputSchema = z.object({
  organizationId: z.string().min(1),
  serverId: z.string().min(1).optional(),
  type: z.enum([
    "images",
    "volumes",
    "containers",
    "builder",
    "networks",
    "system",
    "all",
  ]),
  preserveRollbackImages: z.boolean().default(true),
  pruneNetworks: z.boolean().default(false),
});

export class PruneDockerResourcesUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly docker: DockerPrunePort,
  ) {}

  async execute(
    input: z.input<typeof PruneDockerResourcesInputSchema>,
    options: { allowLocalInCloud?: boolean } = {},
  ) {
    const parsedInput = PruneDockerResourcesInputSchema.parse(input);
    const target = await resolveDockerInspectionTarget(
      this.uow,
      parsedInput,
      options,
    );
    const pruneOptions: DockerPruneOptions = {
      preserveRollbackImages: parsedInput.preserveRollbackImages,
      pruneNetworks: parsedInput.pruneNetworks,
    };
    return this.docker.prune(target, parsedInput.type, pruneOptions);
  }
}
