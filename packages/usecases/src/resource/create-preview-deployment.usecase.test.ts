import { describe, expect, test } from "bun:test";
import type {
  CreatePreviewDeploymentDTO,
  IUnitOfWork,
  PreviewDeployment,
} from "@upstand/domain";
import {
  CreatePreviewDeploymentUseCase,
  type CreatePreviewDeploymentWithQuotaInput,
} from "./create-preview-deployment.usecase";

function createPreview(
  id: string,
  input: CreatePreviewDeploymentDTO,
): PreviewDeployment {
  const now = new Date();
  return {
    id,
    resourceId: input.resourceId,
    pullRequestId: input.pullRequestId,
    branchName: input.branchName,
    appName: input.appName,
    status: input.status,
    domain: input.domain,
    createdAt: now,
    updatedAt: now,
  };
}

function makeInput(
  overrides: Partial<CreatePreviewDeploymentWithQuotaInput> = {},
): CreatePreviewDeploymentWithQuotaInput {
  return {
    resourceId: "resource-1",
    pullRequestId: 101,
    branchName: "feature/preview",
    appName: "pr-101-resource-1",
    status: "idle" as const,
    domain: "pr-101-resource-1.sslip.io",
    previewLimit: 1,
    ...overrides,
  };
}

function createLockedUnitOfWork() {
  const previews: PreviewDeployment[] = [];
  let nextId = 1;
  let lockTail = Promise.resolve();

  const unitOfWork = {
    transaction: async <T>(work: (tx: IUnitOfWork) => Promise<T>) => {
      let releaseLock: (() => void) | undefined;
      try {
        return await work({
          resourceRepository: {
            lockById: async () => {
              await lockTail;
              lockTail = new Promise<void>((resolve) => {
                releaseLock = resolve;
              });
              return true;
            },
          },
          previewDeploymentRepository: {
            findByResourceId: async () => {
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              return [...previews];
            },
            create: async (input: CreatePreviewDeploymentDTO) => {
              const preview = createPreview(`preview-${nextId++}`, input);
              previews.push(preview);
              return preview;
            },
          },
        } as unknown as IUnitOfWork);
      } finally {
        releaseLock?.();
      }
    },
  } as IUnitOfWork;

  return { unitOfWork, previews };
}

describe("CreatePreviewDeploymentUseCase", () => {
  test("serializes different pull requests before applying the resource quota", async () => {
    const { unitOfWork, previews } = createLockedUnitOfWork();
    const useCase = new CreatePreviewDeploymentUseCase(unitOfWork);

    const [first, second] = await Promise.all([
      useCase.execute(makeInput({ pullRequestId: 101 })),
      useCase.execute(
        makeInput({
          pullRequestId: 102,
          appName: "pr-102-resource-1",
          domain: "pr-102-resource-1.sslip.io",
        }),
      ),
    ]);

    expect([first.preview, second.preview].filter(Boolean)).toHaveLength(1);
    expect(
      [first.limitReached, second.limitReached].filter(Boolean),
    ).toHaveLength(1);
    expect(previews).toHaveLength(1);
  });

  test("fails closed when the resource cannot be locked", async () => {
    const unitOfWork = {
      transaction: async <T>(work: (tx: IUnitOfWork) => Promise<T>) =>
        work({
          resourceRepository: { lockById: async () => false },
        } as unknown as IUnitOfWork),
    } as IUnitOfWork;

    await expect(
      new CreatePreviewDeploymentUseCase(unitOfWork).execute(makeInput()),
    ).rejects.toThrow("Resource not found");
  });

  test("rejects unreasonable quota values", async () => {
    const { unitOfWork } = createLockedUnitOfWork();

    await expect(
      new CreatePreviewDeploymentUseCase(unitOfWork).execute(
        makeInput({ previewLimit: 101 }),
      ),
    ).rejects.toThrow("Invalid preview limit");
  });
});
