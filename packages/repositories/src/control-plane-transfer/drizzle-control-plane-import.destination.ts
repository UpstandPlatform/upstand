import { randomUUID } from "node:crypto";
import {
  controlPlaneTransferRecord,
  controlPlaneTransferSession,
  type Database,
} from "@upstand/db";
import type {
  ControlPlaneTransferManifest,
  PortableControlPlaneRecord,
} from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { and, asc, eq, gt } from "drizzle-orm";

type ImportMode = "replace" | "merge";
type ControlPlaneTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
type EncryptedSecrets = Record<
  string,
  { ciphertext: string; iv: string; authTag: string; keyVersion: number }
>;

export interface PortableControlPlaneRecordApplier {
  prepareReplace(
    tx: ControlPlaneTransaction,
    manifest: ControlPlaneTransferManifest,
  ): Promise<void>;
  applyRecord(
    tx: ControlPlaneTransaction,
    record: PortableControlPlaneRecord,
    mode: ImportMode,
  ): Promise<{ imported: boolean; conflict?: string }>;
  applySecrets(
    tx: ControlPlaneTransaction,
    secrets: EncryptedSecrets,
    mode: ImportMode,
  ): Promise<readonly string[]>;
}

export class DrizzleControlPlaneImportDestination {
  constructor(
    private readonly database: Database,
    private readonly actorId: string,
    private readonly applier: PortableControlPlaneRecordApplier,
    private readonly resumeSessionId?: string,
  ) {}

  async begin(manifest: ControlPlaneTransferManifest, mode: ImportMode) {
    const sessionId = this.resumeSessionId ?? randomUUID();
    const existing = await this.findSession(sessionId);
    if (existing) {
      if (
        existing.actorId !== this.actorId ||
        existing.mode !== mode ||
        JSON.stringify(existing.manifest) !== JSON.stringify(manifest) ||
        existing.status !== "staging" ||
        existing.expiresAt <= new Date()
      ) {
        throw new Error("Control-plane import session cannot be resumed");
      }
    } else {
      if (this.resumeSessionId) {
        throw new Error("Control-plane import session was not found");
      }
      await this.database.insert(controlPlaneTransferSession).values({
        id: sessionId,
        actorId: this.actorId,
        mode,
        status: "staging",
        manifest,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      });
    }

    return {
      stageRecord: (record: PortableControlPlaneRecord) =>
        this.stageRecord(sessionId, record),
      stageSecrets: (secrets: Readonly<Record<string, string>>) =>
        this.stageSecrets(sessionId, secrets),
      commit: () => this.commit(sessionId),
      rollback: () => this.rollback(sessionId),
    };
  }

  private async stageRecord(
    sessionId: string,
    record: PortableControlPlaneRecord,
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      const session = await this.requireStagingSession(tx, sessionId);
      const [alreadyStaged] = await tx
        .select()
        .from(controlPlaneTransferRecord)
        .where(
          and(
            eq(controlPlaneTransferRecord.sessionId, sessionId),
            eq(controlPlaneTransferRecord.tableName, record.table),
            eq(controlPlaneTransferRecord.recordId, record.id),
          ),
        )
        .limit(1);
      if (alreadyStaged) {
        if (alreadyStaged.checksum !== record.checksum) {
          throw new Error("Resumed import record checksum changed");
        }
        return;
      }
      const sequence = session.cursor + 1;
      await tx.insert(controlPlaneTransferRecord).values({
        sessionId,
        sequence,
        tableName: record.table,
        recordId: record.id,
        checksum: record.checksum,
        data: record.data,
      });
      await tx
        .update(controlPlaneTransferSession)
        .set({ cursor: sequence, updatedAt: new Date() })
        .where(eq(controlPlaneTransferSession.id, sessionId));
    });
  }

  private async stageSecrets(
    sessionId: string,
    secrets: Readonly<Record<string, string>>,
  ): Promise<void> {
    const encrypted: EncryptedSecrets = {};
    for (const [key, value] of Object.entries(secrets)) {
      encrypted[key] = encryptSecret(value);
    }
    const session = await this.findSession(sessionId);
    if (session?.status !== "staging" || session.actorId !== this.actorId) {
      throw new Error("Control-plane import session is not writable");
    }
    await this.database
      .update(controlPlaneTransferSession)
      .set({ stagedSecrets: encrypted, updatedAt: new Date() })
      .where(eq(controlPlaneTransferSession.id, sessionId));
  }

  private async commit(
    sessionId: string,
  ): Promise<{ imported: number; conflicts: readonly string[] }> {
    try {
      return await this.database.transaction(async (tx) => {
        const session = await this.requireStagingSession(tx, sessionId);
        await tx
          .update(controlPlaneTransferSession)
          .set({ status: "committing", updatedAt: new Date() })
          .where(eq(controlPlaneTransferSession.id, sessionId));
        const records = await tx
          .select()
          .from(controlPlaneTransferRecord)
          .where(eq(controlPlaneTransferRecord.sessionId, sessionId))
          .orderBy(asc(controlPlaneTransferRecord.sequence));
        if (session.mode === "replace") {
          await this.applier.prepareReplace(tx, session.manifest);
        }
        let imported = 0;
        const conflicts: string[] = [];
        for (const staged of records) {
          const result = await this.applier.applyRecord(
            tx,
            {
              table: staged.tableName as PortableControlPlaneRecord["table"],
              id: staged.recordId,
              checksum: staged.checksum,
              data: staged.data,
            },
            session.mode as ImportMode,
          );
          if (result.imported) imported += 1;
          if (result.conflict) conflicts.push(result.conflict);
        }
        if (session.stagedSecrets) {
          conflicts.push(
            ...(await this.applier.applySecrets(
              tx,
              session.stagedSecrets as EncryptedSecrets,
              session.mode as ImportMode,
            )),
          );
        }
        await tx
          .update(controlPlaneTransferSession)
          .set({
            status: "completed",
            importedCount: imported,
            conflicts,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(controlPlaneTransferSession.id, sessionId));
        return { imported, conflicts };
      });
    } catch (error) {
      await this.database
        .update(controlPlaneTransferSession)
        .set({
          status: "failed",
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        })
        .where(eq(controlPlaneTransferSession.id, sessionId))
        .catch(() => undefined);
      throw error;
    }
  }

  private async rollback(sessionId: string): Promise<void> {
    await this.database
      .delete(controlPlaneTransferSession)
      .where(
        and(
          eq(controlPlaneTransferSession.id, sessionId),
          eq(controlPlaneTransferSession.actorId, this.actorId),
          eq(controlPlaneTransferSession.status, "staging"),
        ),
      );
  }

  private async findSession(sessionId: string) {
    const [session] = await this.database
      .select()
      .from(controlPlaneTransferSession)
      .where(eq(controlPlaneTransferSession.id, sessionId))
      .limit(1);
    return session ?? null;
  }

  private async requireStagingSession(
    tx: ControlPlaneTransaction,
    sessionId: string,
  ) {
    const [session] = await tx
      .select()
      .from(controlPlaneTransferSession)
      .where(
        and(
          eq(controlPlaneTransferSession.id, sessionId),
          eq(controlPlaneTransferSession.actorId, this.actorId),
          eq(controlPlaneTransferSession.status, "staging"),
          gt(controlPlaneTransferSession.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!session)
      throw new Error("Control-plane import session is not writable");
    return session;
  }
}
