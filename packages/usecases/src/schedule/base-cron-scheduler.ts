import { redis, withRedisLock } from "@upstand/redis";
import { Cron } from "croner";
import { log } from "evlog";

const SCHEDULE_TRIGGER_LOCK_TTL_MS = 30 * 60_000;

export interface ScheduledJobItem {
  id: string;
  cronExpression: string;
  timezone?: string | null;
}

interface ScheduledJobEntry {
  cron: Cron;
  signature: string;
}

export abstract class BaseCronScheduler<TSchedule extends ScheduledJobItem> {
  protected readonly jobs = new Map<string, ScheduledJobEntry>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private ready = false;
  private refreshInFlight: Promise<void> | null = null;

  constructor(
    protected readonly refreshErrorMessage: string,
    private readonly lockNamespace: string,
  ) {}

  abstract loadSchedules(): Promise<TSchedule[]>;
  abstract buildSignature(schedule: TSchedule): string;
  abstract onTrigger(scheduleId: string): Promise<void>;

  protected getCronMode(): "5-part" | undefined {
    return undefined;
  }

  async start(): Promise<void> {
    if (this.refreshTimer) return;
    await this.refresh();
    this.refreshTimer = setInterval(
      () =>
        void this.refresh().catch((error) => {
          log.error({
            message: this.refreshErrorMessage,
            err: error,
          });
        }),
      60_000,
    );
    this.refreshTimer.unref?.();
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async stop(): Promise<void> {
    this.ready = false;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const job of this.jobs.values()) job.cron.stop();
    this.jobs.clear();
    if (this.refreshInFlight) await this.refreshInFlight;
  }

  async refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.performRefresh();
    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async performRefresh(): Promise<void> {
    const schedules = await this.loadSchedules();
    const activeIds = new Set(schedules.map((schedule) => schedule.id));
    for (const [id, job] of this.jobs) {
      if (!activeIds.has(id)) {
        job.cron.stop();
        this.jobs.delete(id);
      }
    }

    for (const schedule of schedules) {
      const signature = this.buildSignature(schedule);
      const existing = this.jobs.get(schedule.id);
      if (existing?.signature === signature) continue;
      existing?.cron.stop();

      try {
        const mode = this.getCronMode();
        const timezone = schedule.timezone || "UTC";
        const cron = new Cron(
          schedule.cronExpression,
          {
            timezone,
            protect: true,
            ...(mode ? { mode } : {}),
          },
          () => void this.triggerWithLock(schedule.id),
        );
        this.jobs.set(schedule.id, { cron, signature });
      } catch (error) {
        log.error({
          message: "Ignoring invalid persisted schedule",
          scheduleId: schedule.id,
          err: error,
        });
      }
    }
  }

  private async triggerWithLock(scheduleId: string): Promise<void> {
    try {
      await withRedisLock({
        redis,
        key: `upstand:scheduler:${this.lockNamespace}:${scheduleId}`,
        ttlMs: SCHEDULE_TRIGGER_LOCK_TTL_MS,
        work: () => this.onTrigger(scheduleId),
      });
    } catch (error: unknown) {
      log.error({
        message:
          "Failed to acquire or execute distributed schedule trigger lock",
        scheduleId,
        lockNamespace: this.lockNamespace,
        err: error,
      });
    }
  }
}
