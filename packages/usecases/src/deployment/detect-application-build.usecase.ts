import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";
import {
  type BuildDetectionResult,
  detectBuildConfig,
} from "./detect-build-config";

export const DetectApplicationBuildInputSchema = z.object({
  resourceId: z.string().min(1),
  localPath: z.string().trim().min(1),
  buildPath: z.string().trim().min(1).optional(),
});

export type DetectApplicationBuildInput = z.infer<
  typeof DetectApplicationBuildInputSchema
>;

/** Runs the same detector used by deployment against a user-selected local source. */
export class DetectApplicationBuildUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: DetectApplicationBuildInput,
  ): Promise<BuildDetectionResult> {
    const resource = await this.uow.resourceRepository.findById(
      input.resourceId,
    );
    if (resource?.type !== "application") {
      throw new ValidationError("Application not found");
    }
    return detectBuildConfig(input.localPath, input.buildPath ?? ".");
  }
}
