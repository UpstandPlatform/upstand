import { Cron } from "croner";
import { log } from "evlog";

interface ScheduledCleanup {
  cron: Cron;
  signature: string;
}

export interface AccessLogCleanupSchedule {
  enabled: boolean;
  cronExpression: string;
}

export class AccessLogCleanupScheduler {
  private job: ScheduledCleanup | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshInFlight: Promise<void> | null = null;

  constructor(
    private readonly getSchedule: () => Promise<AccessLogCleanupSchedule>,
    private readonly cleanupAccessLogs: () => Promise<void>,
  ) {}

  async start(): Promise<void> {
    if (this.refreshTimer) return;
    await this.refresh();
    this.refreshTimer = setInterval(
      () =>
        void this.refresh().catch((error) => {
          log.error({
            message: "Failed to refresh Caddy access-log cleanup schedule",
            err: error,
          });
        }),
      60_000,
    );
    this.refreshTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.job?.cron.stop();
    this.job = null;
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
    const { enabled, cronExpression } = await this.getSchedule();

    const signature = enabled ? cronExpression : "disabled";
    if (this.job?.signature === signature) return;
    this.job?.cron.stop();
    this.job = null;
    if (!enabled) return;

    try {
      const cron = new Cron(
        cronExpression,
        { protect: true },
        () => void this.runCleanup(),
      );
      this.job = { cron, signature };
    } catch (error) {
      log.error({
        message: "Ignoring invalid Caddy access-log cleanup schedule",
        cronExpression,
        err: error,
      });
    }
  }

  private async runCleanup(): Promise<void> {
    try {
      const { enabled } = await this.getSchedule();
      if (!enabled) return;
      await this.cleanupAccessLogs();
      log.info({ message: "Caddy access-log cleanup completed" });
    } catch (error) {
      log.error({
        message: "Caddy access-log cleanup failed",
        err: error,
      });
    }
  }
}
