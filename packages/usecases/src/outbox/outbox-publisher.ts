import type {
  IUnitOfWork,
  OutboxMessage,
  OutboxOperationalSummary,
} from "@upstand/domain";

export interface OutboxJobPublisher {
  publish(message: OutboxMessage): Promise<void>;
  close?(): Promise<void>;
}

export interface OutboxPublisherOptions {
  batchSize?: number;
  leaseMs?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
  now?: () => Date;
}

export interface OutboxPublishBatchResult {
  claimed: number;
  published: number;
  retried: number;
  deadLettered: number;
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 5 * 60_000;

export class OutboxPublisher {
  private readonly options: Required<OutboxPublisherOptions>;

  constructor(
    private readonly uow: IUnitOfWork,
    private readonly jobPublisher: OutboxJobPublisher,
    options: OutboxPublisherOptions = {},
  ) {
    this.options = {
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS,
      retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      maxRetryDelayMs: options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
      now: options.now ?? (() => new Date()),
    };
  }

  async publishBatch(): Promise<OutboxPublishBatchResult> {
    const claimedAt = this.options.now();
    const messages = await this.uow.outboxRepository.claimBatch(
      claimedAt,
      this.options.leaseMs,
      this.options.batchSize,
    );
    const result: OutboxPublishBatchResult = {
      claimed: messages.length,
      published: 0,
      retried: 0,
      deadLettered: 0,
    };

    for (const message of messages) {
      try {
        await this.jobPublisher.publish(message);
        const marked = await this.uow.outboxRepository.markPublished(
          message.id,
          this.options.now(),
          message.claimedAt,
        );
        if (marked) result.published += 1;
      } catch (error) {
        const retryDelayMs = Math.min(
          this.options.maxRetryDelayMs,
          this.options.retryBaseDelayMs *
            2 ** Math.max(message.attempts - 1, 0),
        );
        const failed = await this.uow.outboxRepository.markFailed(
          message.id,
          this.options.now(),
          error instanceof Error ? error.message : String(error),
          retryDelayMs,
          message.claimedAt,
        );
        if (failed?.status === "dead_letter") result.deadLettered += 1;
        else if (failed) result.retried += 1;
      }
    }

    return result;
  }

  getOperationalSummary(): Promise<OutboxOperationalSummary> {
    return this.uow.outboxRepository.getOperationalSummary();
  }
}
