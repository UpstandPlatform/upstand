import { dockerRegistry } from "@upstand/db";
import type {
  CreateDockerRegistryDTO,
  DockerRegistry,
  IDockerRegistryRepository,
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

export class DrizzleDockerRegistryRepository
  extends BaseRepository<
    typeof dockerRegistry,
    DockerRegistry,
    CreateDockerRegistryDTO
  >
  implements IDockerRegistryRepository
{
  constructor(executor: Executor) {
    super(executor, dockerRegistry);
  }

  private async publicRow(row: DockerRegistry): Promise<DockerRegistry> {
    const decodedPassword = decodeSecret(row.password);
    if (row.password && !getEncryptedPayload(row.password)) {
      await super.updateById(row.id, {
        password: encodeSecret(row.password),
      });
    }
    return {
      ...row,
      password: decodedPassword ?? row.password,
    };
  }

  override async findById(id: string): Promise<DockerRegistry | null> {
    const row = await super.findById(id);
    return row ? await this.publicRow(row) : null;
  }

  async findByOrganizationId(
    organizationId: string,
  ): Promise<DockerRegistry[]> {
    const rows = await this.findMany({
      where: eq(dockerRegistry.organizationId, organizationId),
    });
    return Promise.all(rows.map((row) => this.publicRow(row)));
  }

  override async create(
    values: CreateDockerRegistryDTO,
  ): Promise<DockerRegistry> {
    const row = await super.create({
      ...values,
      password: encodeSecret(values.password) ?? values.password,
    });
    return this.publicRow(row);
  }

  override async updateById(
    id: string,
    patch: Partial<CreateDockerRegistryDTO>,
  ): Promise<DockerRegistry | null> {
    const persisted = {
      ...patch,
      ...(patch.password !== undefined
        ? { password: encodeSecret(patch.password) ?? patch.password }
        : {}),
    };
    const row = await super.updateById(id, persisted);
    return row ? await this.publicRow(row) : null;
  }
}
