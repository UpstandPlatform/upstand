import type {
  CreateS3DestinationDTO,
  S3Destination,
} from "../entities/s3-destination";

export interface IS3DestinationRepository {
  findById(id: string): Promise<S3Destination | null>;
  findByOrganizationId(organizationId: string): Promise<S3Destination[]>;
  create(data: CreateS3DestinationDTO): Promise<S3Destination>;
  deleteById(id: string): Promise<boolean>;
  updateById(
    id: string,
    patch: Partial<CreateS3DestinationDTO>,
  ): Promise<S3Destination | null>;
}
