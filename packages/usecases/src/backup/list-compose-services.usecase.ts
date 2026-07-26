import type { IUnitOfWork } from "@upstand/domain";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import { z } from "zod";
import { InspectComposeUseCase } from "../resource/inspect-compose.usecase";

export const ListComposeServicesInputSchema = z.object({
  resourceId: z.string().min(1),
});

export type ListComposeServicesInput = z.infer<
  typeof ListComposeServicesInputSchema
>;

export class ListComposeServicesUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly inspector = new InspectComposeUseCase(),
  ) {}

  async execute(input: ListComposeServicesInput): Promise<string[]> {
    const resource = await this.uow.resourceRepository.findById(
      input.resourceId,
    );
    if (!resource) throw new Error("Resource not found");
    if (resource.type !== "compose") return [];

    const credentials = parseComposeCredentials(resource.credentials);
    if (!credentials.composeFile?.trim()) return [];

    const inspection = await this.inspector.execute({
      composeFile: credentials.composeFile,
    });
    return inspection.services.map((service) => service.name);
  }
}

function parseComposeCredentials(value: string | null | undefined): {
  composeFile?: string;
} {
  try {
    const parsed = JSON.parse(value || "{}");
    const unwrapped =
      parsed && typeof parsed === "object" && "ciphertext" in parsed
        ? JSON.parse(decryptSecret(parsed as never))
        : parsed;
    return unwrapped && typeof unwrapped === "object"
      ? (unwrapped as { composeFile?: string })
      : {};
  } catch {
    return {};
  }
}
