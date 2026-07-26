import type { IUnitOfWork, Resource } from "@upstand/domain";
import { z } from "zod";
import { randomizeComposeFile } from "./compose-randomization";
import {
  parseResourceCredentials,
  serializeResourceCredentials,
} from "./resource-credentials";

export const RandomizeComposeInputSchema = z.object({
  id: z.string().min(1, "Resource ID is required"),
  suffix: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
    .optional(),
});

export type RandomizeComposeInput = z.infer<typeof RandomizeComposeInputSchema>;

export class RandomizeComposeUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: RandomizeComposeInput): Promise<Resource> {
    const resource = await this.uow.resourceRepository.findById(input.id);
    if (!resource) throw new Error("Resource not found");
    if (resource.type !== "compose") {
      throw new Error(
        "Compose randomization is only available for Compose resources",
      );
    }

    const credentials = parseResourceCredentials(resource.credentials);
    if (
      typeof credentials.composeFile !== "string" ||
      !credentials.composeFile.trim()
    ) {
      throw new Error(
        "This Compose resource does not have an editable Compose file",
      );
    }
    const composeFile = randomizeComposeFile(
      credentials.composeFile,
      input.suffix,
    );
    const updated = await this.uow.transaction((tx) =>
      tx.resourceRepository.updateById(resource.id, {
        provider: "raw",
        credentials: serializeResourceCredentials({
          ...credentials,
          composeFile,
        }),
      }),
    );
    if (!updated) throw new Error("Resource could not be updated");
    return updated;
  }
}
