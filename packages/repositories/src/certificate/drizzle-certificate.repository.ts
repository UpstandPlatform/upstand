import { certificate } from "@upstand/db";
import type {
  Certificate,
  CreateCertificateDTO,
  ICertificateRepository,
} from "@upstand/domain";
import {
  decryptSecret,
  type EncryptedPayload,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";
import { eq } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

function encode(value: string): string {
  return JSON.stringify(encryptSecret(value));
}

function getPayload(value: string): EncryptedPayload | null {
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

function decode(value: string): { value: string; encrypted: boolean } {
  const encryptedPayload = getPayload(value);
  return encryptedPayload
    ? { value: decryptSecret(encryptedPayload), encrypted: true }
    : { value, encrypted: false };
}

export class DrizzleCertificateRepository
  extends BaseRepository<typeof certificate, Certificate, CreateCertificateDTO>
  implements ICertificateRepository
{
  constructor(executor: Executor) {
    super(executor, certificate);
  }

  private async publicRow(row: Certificate): Promise<Certificate> {
    const certificatePem = decode(row.certificatePem);
    const privateKeyPem = decode(row.privateKeyPem);
    if (!certificatePem.encrypted || !privateKeyPem.encrypted) {
      await super.updateById(row.id, {
        ...(certificatePem.encrypted
          ? {}
          : { certificatePem: encode(certificatePem.value) }),
        ...(privateKeyPem.encrypted
          ? {}
          : { privateKeyPem: encode(privateKeyPem.value) }),
      });
    }
    return {
      ...row,
      certificatePem: certificatePem.value,
      privateKeyPem: privateKeyPem.value,
    };
  }

  async findById(id: string): Promise<Certificate | null> {
    const row = await super.findById(id);
    return row ? await this.publicRow(row) : null;
  }

  async findByOrganizationId(organizationId: string): Promise<Certificate[]> {
    const rows = await super.findMany({
      where: eq(certificate.organizationId, organizationId),
    });
    return Promise.all(rows.map((row) => this.publicRow(row)));
  }

  async findAll(): Promise<Certificate[]> {
    const rows = await super.findMany();
    return Promise.all(rows.map((row) => this.publicRow(row)));
  }

  async create(values: CreateCertificateDTO): Promise<Certificate> {
    const row = await super.create({
      ...values,
      certificatePem: encode(values.certificatePem),
      privateKeyPem: encode(values.privateKeyPem),
    });
    return this.publicRow(row);
  }

  async updateById(
    id: string,
    patch: Partial<CreateCertificateDTO>,
  ): Promise<Certificate | null> {
    const persisted = {
      ...patch,
      ...(patch.certificatePem !== undefined
        ? { certificatePem: encode(patch.certificatePem) }
        : {}),
      ...(patch.privateKeyPem !== undefined
        ? { privateKeyPem: encode(patch.privateKeyPem) }
        : {}),
    };
    const row = await super.updateById(id, persisted);
    return row ? await this.publicRow(row) : null;
  }
}
