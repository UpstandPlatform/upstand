import type { IUnitOfWork, PreviewDeployment } from "@upstand/domain";
import { z } from "zod";

export const GetResourcePreviewsInputSchema = z.object({
  id: z.string().min(1, "Resource ID is required"),
});

export type GetResourcePreviewsInput = z.infer<
  typeof GetResourcePreviewsInputSchema
>;

export class GetResourcePreviewsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetResourcePreviewsInput): Promise<PreviewDeployment[]> {
    const resource = await this.uow.resourceRepository.findById(input.id);
    if (!resource) throw new Error("Resource not found");
    return this.uow.previewDeploymentRepository.findByResourceId(resource.id);
  }
}
