import type { IUnitOfWork, S3Destination } from "@upstand/domain";
import { z } from "zod";
import { publicS3Destination } from "./public-s3-destination";

export const GetS3DestinationsInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
});

export type GetS3DestinationsInput = z.infer<
  typeof GetS3DestinationsInputSchema
>;

export class GetS3DestinationsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetS3DestinationsInput): Promise<S3Destination[]> {
    const list = await this.uow.s3DestinationRepository.findByOrganizationId(
      input.organizationId,
    );

    return list.map(publicS3Destination);
  }
}
