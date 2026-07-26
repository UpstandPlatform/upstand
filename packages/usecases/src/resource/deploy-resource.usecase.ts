import type { IUnitOfWork, Resource } from "@upstand/domain";
import { z } from "zod";
import { QueueDeploymentUseCase } from "../deployment/queue-deployment.usecase";

export const DeployResourceInputSchema = z.object({
  id: z.string().min(1, "Resource ID is required"),
  sourceRevision: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/i, "Source revision must be a commit SHA")
    .optional(),
  title: z.string().trim().min(1).max(255).optional(),
});

export type DeployResourceInput = z.infer<typeof DeployResourceInputSchema>;

export class DeployResourceUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeployResourceInput): Promise<Resource> {
    const queueUseCase = new QueueDeploymentUseCase(this.uow);
    return await queueUseCase.execute({
      resourceId: input.id,
      title: input.title ?? "Manual deployment",
      sourceRevision: input.sourceRevision,
    });
  }
}
