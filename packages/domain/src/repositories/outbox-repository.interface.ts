import type {
  CreateOutboxMessageDTO,
  OutboxMessage,
  OutboxOperationalSummary,
} from "../entities/outbox";

export interface IOutboxRepository {
  create(data: CreateOutboxMessageDTO): Promise<OutboxMessage>;
  createMany(data: CreateOutboxMessageDTO[]): Promise<OutboxMessage[]>;
  findById(id: string): Promise<OutboxMessage | null>;
  findByStatus(
    status: OutboxMessage["status"],
    limit?: number,
    organizationId?: string,
  ): Promise<OutboxMessage[]>;
  claimBatch(
    now: Date,
    leaseMs: number,
    limit?: number,
  ): Promise<OutboxMessage[]>;
  markPublished(
    id: string,
    publishedAt: Date,
    claimedAt?: Date | null,
  ): Promise<boolean>;
  markFailed(
    id: string,
    failedAt: Date,
    error: string,
    retryDelayMs: number,
    claimedAt?: Date | null,
  ): Promise<OutboxMessage | null>;
  retryDeadLetter(
    id: string,
    availableAt: Date,
    organizationId?: string,
  ): Promise<OutboxMessage | null>;
  prunePublished(before: Date, limit?: number): Promise<number>;
  getOperationalSummary(
    organizationId?: string,
  ): Promise<OutboxOperationalSummary>;
}
