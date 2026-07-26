import type { IUnitOfWork } from "@upstand/domain";
import { ValidationError } from "@upstand/domain";
import { z } from "zod";
import type { DockerCommandPort } from "../ports/docker";

export const RunDatabaseMigrationInputSchema = z.object({
  resourceId: z.string().min(1),
  command: z.string().trim().min(1).max(4096),
  requireRecentBackup: z.boolean().default(true),
});

export class RunDatabaseMigrationUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly docker: DockerCommandPort,
  ) {}

  async execute(
    input: z.infer<typeof RunDatabaseMigrationInputSchema>,
  ): Promise<{ output: string }> {
    const resource = await this.uow.resourceRepository.findById(
      input.resourceId,
    );
    if (resource?.type !== "database")
      throw new ValidationError("Database resource not found");
    if (input.requireRecentBackup) {
      const recent = (
        await this.uow.backupRunRepository.findByResourceId(resource.id, 20)
      ).find(
        (run) =>
          run.status === "succeeded" &&
          run.verificationStatus === "verified" &&
          run.completedAt &&
          Date.now() - run.completedAt.getTime() < 24 * 60 * 60 * 1000,
      );
      if (!recent)
        throw new ValidationError(
          "A verified backup from the last 24 hours is required before running a migration",
        );
    }
    const output = await this.docker.runCommandInResourceContainer(
      resource,
      `sh -ec ${JSON.stringify(input.command)}`,
    );
    return { output: output.slice(0, 50_000) };
  }
}
