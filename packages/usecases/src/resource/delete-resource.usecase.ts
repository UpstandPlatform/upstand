import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { log } from "evlog";
import { z } from "zod";
import type { CaddyService } from "../web-server/caddy.service";
import type { DockerResourceControlService as DockerService } from "./docker-client";
import { resolveServicesForResource } from "./docker-client";

export const DeleteResourceInputSchema = z.object({
  id: z.string().min(1, "Resource ID is required"),
  deleteVolumes: z.boolean().optional(),
});

export type DeleteResourceInput = z.infer<typeof DeleteResourceInputSchema>;

export class DeleteResourceUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly caddyService: CaddyService,
    private readonly dockerService: DockerService,
  ) {}

  async execute(input: DeleteResourceInput): Promise<boolean> {
    const resource = await this.uow.resourceRepository.findById(input.id);
    if (!resource) {
      throw new ValidationError("Resource not found");
    }

    const resources = await this.uow.resourceRepository.findMany();
    const serverResources =
      resource.serverId && !["local", "manager"].includes(resource.serverId)
        ? resources.filter(
            (candidate) => candidate.serverId === resource.serverId,
          )
        : resources.filter(
            (candidate) =>
              !candidate.serverId ||
              candidate.serverId === "local" ||
              candidate.serverId === "manager",
          );
    const remainingResources = serverResources.filter(
      (item) => item.id !== resource.id,
    );
    const settings = await this.uow.webServerSettingsRepository.findGlobal();

    const { dockerService, caddyService, cleanup } =
      await resolveServicesForResource(
        resource,
        this.uow,
        this.dockerService,
        this.caddyService,
      );
    const certificates =
      (await this.uow.certificateRepository.findAll?.()) ?? [];

    try {
      await caddyService.syncResourceConfigs(
        remainingResources,
        settings || {},
        certificates,
      );
      try {
        await dockerService.removeResource(resource, !!input.deleteVolumes);
        return await this.uow.transaction(async (tx) => {
          await tx.environmentRepository.incrementResourceCount(
            resource.environmentId,
            -1,
          );
          return tx.resourceRepository.deleteById(input.id);
        });
      } catch (error) {
        try {
          await caddyService.syncResourceConfigs(
            serverResources,
            settings || {},
            certificates,
          );
        } catch (rollbackError) {
          log.error({
            message: "Failed to restore Caddy after resource deletion rollback",
            err:
              rollbackError instanceof Error
                ? rollbackError.message
                : rollbackError,
          });
        }
        throw error;
      }
    } finally {
      cleanup();
    }
  }
}
