import type { IUnitOfWork, S3Destination } from "@upstand/domain";
import { env } from "@upstand/env/server";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { assertConfiguredHttpUrl } from "@upstand/platform/network/outbound";
import { z } from "zod";
import { resolveCertificateForOrganization } from "../certificate/certificate-reference";
import { publicS3Destination } from "./public-s3-destination";

export const UpdateS3DestinationInputSchema = z.object({
  id: z.string().min(1, "ID is required"),
  organizationId: z.string().min(1, "Organization ID is required"),
  name: z.string().min(1, "Name is required"),
  provider: z.string().min(1, "Provider is required"),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  bucket: z.string().min(1, "Bucket is required"),
  region: z.string(),
  endpoint: z.string().min(1, "Endpoint is required"),
  certificateId: z.string().nullable().optional(),
  additionalFlags: z.array(z.string()).optional(),
});

export type UpdateS3DestinationInput = z.infer<
  typeof UpdateS3DestinationInputSchema
>;

export class UpdateS3DestinationUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: UpdateS3DestinationInput,
  ): Promise<S3Destination | null> {
    return this.uow.transaction(async (tx) => {
      const existing = await tx.s3DestinationRepository.findById(input.id);
      if (!existing || existing.organizationId !== input.organizationId) {
        return null;
      }
      const certificateId =
        input.certificateId !== undefined
          ? input.certificateId || null
          : existing.certificateId;
      await resolveCertificateForOrganization(
        tx,
        certificateId,
        input.organizationId,
      );
      await assertConfiguredHttpUrl(
        input.endpoint,
        (env.UPSTAND_OUTBOUND_ALLOWED_HOSTS ?? "")
          .split(",")
          .map((host) => host.trim())
          .filter(Boolean),
      );
      const accessKeyId = input.accessKeyId?.trim();
      const secretAccessKey = input.secretAccessKey?.trim();

      const updated = await tx.s3DestinationRepository.updateById(input.id, {
        organizationId: input.organizationId,
        name: input.name,
        provider: input.provider,
        accessKeyId:
          accessKeyId && accessKeyId !== "********"
            ? JSON.stringify(encryptSecret(accessKeyId))
            : existing.accessKeyId,
        secretAccessKey:
          secretAccessKey && secretAccessKey !== "********"
            ? JSON.stringify(encryptSecret(secretAccessKey))
            : existing.secretAccessKey,
        bucket: input.bucket,
        region: input.region,
        endpoint: input.endpoint,
        certificateId: certificateId,
        additionalFlags: JSON.stringify(input.additionalFlags || []),
      });

      if (!updated) return null;

      return publicS3Destination(updated);
    });
  }
}
