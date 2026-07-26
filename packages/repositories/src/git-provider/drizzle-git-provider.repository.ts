import { gitProvider } from "@upstand/db";
import type {
  CreateGitProviderDTO,
  GitProvider,
  IGitProviderRepository,
} from "@upstand/domain";
import {
  decryptSecret,
  type EncryptedPayload,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";
import { eq } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

export class DrizzleGitProviderRepository
  extends BaseRepository<typeof gitProvider, GitProvider, CreateGitProviderDTO>
  implements IGitProviderRepository
{
  constructor(executor: Executor) {
    super(executor, gitProvider);
  }

  private encryptedPayload(value: string): EncryptedPayload | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const payload = parsed as Partial<EncryptedPayload>;
    return typeof payload.ciphertext === "string" &&
      typeof payload.iv === "string" &&
      typeof payload.authTag === "string" &&
      typeof payload.keyVersion === "number"
      ? (payload as EncryptedPayload)
      : null;
  }

  private async decode(row: GitProvider): Promise<GitProvider> {
    const payload = this.encryptedPayload(row.config);
    if (payload) return { ...row, config: decryptSecret(payload) };

    // Existing installations may contain legacy plaintext JSON. Migrate the
    // row on first read so compatibility does not leave credentials plaintext
    // indefinitely while still allowing a zero-downtime rollout.
    const encrypted = this.encode(row.config);
    await super.updateById(row.id, { config: encrypted });
    return row;
  }

  private encode(config: string): string {
    if (this.encryptedPayload(config)) return config;
    return JSON.stringify(encryptSecret(config));
  }

  async findById(id: string): Promise<GitProvider | null> {
    const row = await super.findById(id);
    return row ? await this.decode(row) : null;
  }

  async findByOrganizationId(organizationId: string): Promise<GitProvider[]> {
    const rows = await super.findMany({
      where: eq(gitProvider.organizationId, organizationId),
    });
    return Promise.all(rows.map((row) => this.decode(row)));
  }

  async create(values: CreateGitProviderDTO): Promise<GitProvider> {
    const row = await super.create({
      ...values,
      config: this.encode(values.config),
    });
    return this.decode(row);
  }

  async createMany(values: CreateGitProviderDTO[]): Promise<GitProvider[]> {
    const rows = await super.createMany(
      values.map((value) => ({ ...value, config: this.encode(value.config) })),
    );
    return Promise.all(rows.map((row) => this.decode(row)));
  }

  async updateById(
    id: string,
    patch: Partial<CreateGitProviderDTO>,
  ): Promise<GitProvider | null> {
    const persistedPatch = { ...patch };
    if (typeof persistedPatch.config === "string") {
      persistedPatch.config = this.encode(persistedPatch.config);
    }
    const row = await super.updateById(id, persistedPatch);
    return row ? await this.decode(row) : null;
  }
}
