import type {
  CreatePreviewDeploymentDTO,
  IUnitOfWork,
  PreviewDeployment,
} from "@upstand/domain";

const MAX_PREVIEW_LIMIT = 100;

export type CreatePreviewDeploymentWithQuotaInput =
  CreatePreviewDeploymentDTO & {
    previewLimit: number;
  };

export type CreatePreviewDeploymentWithQuotaResult = {
  preview: PreviewDeployment | null;
  limitReached: boolean;
};

/**
 * Create a preview only after serializing the quota decision for its resource.
 * The repository lock is mandatory so alternate adapters cannot silently
 * reintroduce the check/create race.
 */
export class CreatePreviewDeploymentUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: CreatePreviewDeploymentWithQuotaInput,
  ): Promise<CreatePreviewDeploymentWithQuotaResult> {
    if (
      !Number.isInteger(input.previewLimit) ||
      input.previewLimit < 0 ||
      input.previewLimit > MAX_PREVIEW_LIMIT
    ) {
      throw new Error("Invalid preview limit");
    }

    let limitReached = false;
    const preview = await this.uow.transaction(async (tx) => {
      const resourceExists = await tx.resourceRepository.lockById(
        input.resourceId,
      );
      if (!resourceExists) {
        throw new Error("Resource not found");
      }

      const existingPreviews =
        await tx.previewDeploymentRepository.findByResourceId(input.resourceId);
      if (
        existingPreviews.filter((candidate) => candidate.status !== "failed")
          .length >= input.previewLimit
      ) {
        limitReached = true;
        return null;
      }

      return tx.previewDeploymentRepository.create({
        resourceId: input.resourceId,
        pullRequestId: input.pullRequestId,
        branchName: input.branchName,
        appName: input.appName,
        status: input.status,
        domain: input.domain,
      });
    });

    return { preview, limitReached };
  }
}
