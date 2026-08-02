import { describe, expect, test } from "bun:test";
import type { IUnitOfWork, S3Destination } from "@upstand/domain";
import { DeleteS3DestinationUseCase } from "./delete-s3-destination.usecase";
import { UpdateS3DestinationUseCase } from "./update-s3-destination.usecase";

const existing: S3Destination = {
  id: "destination-1",
  organizationId: "organization-a",
  name: "Production backups",
  provider: "AWS",
  accessKeyId: "encrypted-access-key",
  secretAccessKey: "encrypted-secret-key",
  bucket: "backups",
  region: "us-east-1",
  endpoint: "https://s3.amazonaws.com",
  certificateId: null,
  additionalFlags: "[]",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("UpdateS3DestinationUseCase", () => {
  test("fails closed before validating or changing a destination from another organization", async () => {
    let updates = 0;
    const uow = {
      transaction: async (callback: (tx: IUnitOfWork) => Promise<unknown>) =>
        callback({
          s3DestinationRepository: {
            findById: async () => existing,
            updateById: async () => {
              updates += 1;
              return existing;
            },
          },
        } as unknown as IUnitOfWork),
    } as unknown as IUnitOfWork;

    const result = await new UpdateS3DestinationUseCase(uow).execute({
      id: existing.id,
      organizationId: "organization-b",
      name: existing.name,
      provider: existing.provider,
      bucket: existing.bucket,
      region: existing.region,
      endpoint: "http://127.0.0.1:2375",
    });

    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  test("fails closed before deleting a destination from another organization", async () => {
    let deletes = 0;
    const uow = {
      transaction: async (callback: (tx: IUnitOfWork) => Promise<unknown>) =>
        callback({
          s3DestinationRepository: {
            findById: async () => existing,
            deleteById: async () => {
              deletes += 1;
              return true;
            },
          },
        } as unknown as IUnitOfWork),
    } as unknown as IUnitOfWork;

    const result = await new DeleteS3DestinationUseCase(uow).execute({
      id: existing.id,
      organizationId: "organization-b",
    });

    expect(result).toBe(false);
    expect(deletes).toBe(0);
  });
});
