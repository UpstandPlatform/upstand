import { randomUUID } from "node:crypto";
import type { IUnitOfWork, S3Destination } from "@upstand/domain";
import { env } from "@upstand/env/server";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { assertConfiguredHttpUrl } from "@upstand/platform/network/outbound";
import { z } from "zod";
import { resolveCertificateForOrganization } from "../certificate/certificate-reference";
import { publicS3Destination } from "./public-s3-destination";

export const CreateS3DestinationInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  name: z.string().min(1, "Name is required"),
  provider: z.string().min(1, "Provider is required"),
  accessKeyId: z.string().min(1, "Access Key Id is required"),
  secretAccessKey: z.string().min(1, "Secret Access Key is required"),
  bucket: z.string().min(1, "Bucket is required"),
  region: z.string(),
  endpoint: z.string().min(1, "Endpoint is required"),
  certificateId: z.string().nullable().optional(),
  additionalFlags: z.array(z.string()).optional(),
});

export type CreateS3DestinationInput = z.infer<
  typeof CreateS3DestinationInputSchema
>;

export class CreateS3DestinationUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: CreateS3DestinationInput): Promise<S3Destination> {
    await assertConfiguredHttpUrl(
      input.endpoint,
      (env.UPSTAND_OUTBOUND_ALLOWED_HOSTS ?? "")
        .split(",")
        .map((host) => host.trim())
        .filter(Boolean),
    );
    await resolveCertificateForOrganization(
      this.uow,
      input.certificateId,
      input.organizationId,
    );
    return this.uow.transaction(async (tx) => {
      const encryptedAccessKeyId = JSON.stringify(
        encryptSecret(input.accessKeyId),
      );
      const encryptedSecretAccessKey = JSON.stringify(
        encryptSecret(input.secretAccessKey),
      );

      const created = await tx.s3DestinationRepository.create({
        id: randomUUID(),
        organizationId: input.organizationId,
        name: input.name,
        provider: input.provider,
        accessKeyId: encryptedAccessKeyId,
        secretAccessKey: encryptedSecretAccessKey,
        bucket: input.bucket,
        region: input.region,
        endpoint: input.endpoint,
        certificateId: input.certificateId || null,
        additionalFlags: JSON.stringify(input.additionalFlags || []),
      });

      return publicS3Destination(created);
    });
  }
}
