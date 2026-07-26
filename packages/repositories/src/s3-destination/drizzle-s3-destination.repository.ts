import { s3Destination } from "@upstand/db";
import type {
  CreateS3DestinationDTO,
  IS3DestinationRepository,
  S3Destination,
} from "@upstand/domain";
import {
  decryptSecret,
  type EncryptedPayload,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";
import { eq } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

function getEncryptedPayload(value: string): EncryptedPayload | null {
  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.ciphertext === "string" &&
      typeof parsed.iv === "string" &&
      typeof parsed.authTag === "string" &&
      typeof parsed.keyVersion === "number"
    ) {
      return parsed as EncryptedPayload;
    }
  } catch {
    return null;
  }
  return null;
}

function decodeSecret(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined || value === "") return value;
  const payload = getEncryptedPayload(value);
  return payload ? decryptSecret(payload) : value;
}

function encodeSecret(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined || value === "") return value;
  if (getEncryptedPayload(value)) return value;
  return JSON.stringify(encryptSecret(value));
}

export class DrizzleS3DestinationRepository
  extends BaseRepository<
    typeof s3Destination,
    S3Destination,
    CreateS3DestinationDTO
  >
  implements IS3DestinationRepository
{
  constructor(executor: Executor) {
    super(executor, s3Destination);
  }

  private async publicRow(row: S3Destination): Promise<S3Destination> {
    const decodedSecret = decodeSecret(row.secretAccessKey);
    if (row.secretAccessKey && !getEncryptedPayload(row.secretAccessKey)) {
      const encodedSecret = encodeSecret(row.secretAccessKey);
      if (encodedSecret) {
        await super.updateById(row.id, { secretAccessKey: encodedSecret });
      }
    }
    return {
      ...row,
      secretAccessKey: decodedSecret ?? row.secretAccessKey,
    };
  }

  override async findById(id: string): Promise<S3Destination | null> {
    const row = await super.findById(id);
    return row ? await this.publicRow(row) : null;
  }

  async findByOrganizationId(organizationId: string): Promise<S3Destination[]> {
    const rows = await this.findMany({
      where: eq(s3Destination.organizationId, organizationId),
    });
    return Promise.all(rows.map((row) => this.publicRow(row)));
  }

  override async create(
    values: CreateS3DestinationDTO,
  ): Promise<S3Destination> {
    const row = await super.create({
      ...values,
      secretAccessKey:
        encodeSecret(values.secretAccessKey) ?? values.secretAccessKey,
    });
    return this.publicRow(row);
  }

  override async updateById(
    id: string,
    patch: Partial<CreateS3DestinationDTO>,
  ): Promise<S3Destination | null> {
    const persisted = {
      ...patch,
      ...(patch.secretAccessKey !== undefined
        ? {
            secretAccessKey:
              encodeSecret(patch.secretAccessKey) ?? patch.secretAccessKey,
          }
        : {}),
    };
    const row = await super.updateById(id, persisted);
    return row ? await this.publicRow(row) : null;
  }
}
