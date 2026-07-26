import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import { generateWebhookToken } from "./webhook-token";

export const RotateResourceWebhookTokenInputSchema = z.object({
  id: z.string().min(1),
});

export type RotateResourceWebhookTokenInput = z.infer<
  typeof RotateResourceWebhookTokenInputSchema
>;

export class RotateResourceWebhookTokenUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: RotateResourceWebhookTokenInput) {
    const resource = await this.uow.resourceRepository.findById(input.id);
    if (!resource) throw new Error("Resource not found");
    const generated = generateWebhookToken();
    await this.uow.resourceRepository.updateById(input.id, {
      webhookTokenHash: generated.hash,
      webhookTokenPrefix: generated.prefix,
    });
    return {
      resourceId: input.id,
      token: generated.token,
      prefix: generated.prefix,
    };
  }
}
