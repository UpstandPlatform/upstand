import type { IUnitOfWork, PreviewDeployment, Resource } from "@upstand/domain";
import type { CaddyServicePort } from "../ports/caddy";
import type { DockerPreviewCleanupPort } from "../ports/docker";
import { resolveServicesForResource } from "./docker-client";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

export interface ReconcilePreviewCleanupsInput {
  limit?: number;
}

export interface ReconcilePreviewCleanupsResult {
  inspected: number;
  cleaned: number;
  failed: number;
  skipped: number;
  previewIds: string[];
}

/**
 * Retries preview service cleanup from durable cleanup_pending records.
 * Target resolution is performed from the parent resource, and the cleanup
 * capability remains resource-scoped by the infrastructure adapter.
 */
export class ReconcilePreviewCleanupsUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly cleanupPort: DockerPreviewCleanupPort,
    private readonly caddyService: CaddyServicePort,
  ) {}

  async execute(
    input: ReconcilePreviewCleanupsInput = {},
  ): Promise<ReconcilePreviewCleanupsResult> {
    const requestedLimit = input.limit ?? DEFAULT_BATCH_SIZE;
    const normalizedLimit = Number.isFinite(requestedLimit)
      ? Math.trunc(requestedLimit)
      : DEFAULT_BATCH_SIZE;
    const limit = Math.min(Math.max(normalizedLimit, 1), MAX_BATCH_SIZE);
    const repository = this.uow.previewDeploymentRepository;
    const candidates = await repository.findByStatus("cleanup_pending", limit);
    const result: ReconcilePreviewCleanupsResult = {
      inspected: candidates.length,
      cleaned: 0,
      failed: 0,
      skipped: 0,
      previewIds: [],
    };

    for (const preview of candidates) {
      let resource: Resource | null;
      try {
        resource = await this.uow.resourceRepository.findById(
          preview.resourceId,
        );
      } catch {
        result.failed += 1;
        continue;
      }
      if (!resource) {
        result.skipped += 1;
        continue;
      }

      let cleanup: (() => void) | undefined;
      try {
        const services = await resolveServicesForResource(
          resource,
          this.uow,
          this.cleanupPort,
          this.caddyService,
        );
        cleanup = services.cleanup;
        await services.dockerService.removeServiceByName(
          preview.appName,
          preview.resourceId,
        );
        await repository.deleteById(preview.id);
        result.cleaned += 1;
        result.previewIds.push(preview.id);
      } catch {
        result.failed += 1;
      } finally {
        cleanup?.();
      }
    }

    return result;
  }
}

export function isPreviewCleanupPending(
  preview: Pick<PreviewDeployment, "status">,
): boolean {
  return preview.status === "cleanup_pending";
}
