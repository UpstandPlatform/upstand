import { log } from "evlog";
import {
  BaseCronScheduler,
  type ScheduledJobItem,
} from "../schedule/base-cron-scheduler";

export interface BackupScheduleItem extends ScheduledJobItem {
  id: string;
  cronExpression: string;
  timezone: string;
}

export interface BackupSchedulerDependencies {
  loadSchedules: () => Promise<BackupScheduleItem[]>;
  trigger: (scheduleId: string) => Promise<{ id: string } | null>;
}

export class BackupScheduler extends BaseCronScheduler<BackupScheduleItem> {
  constructor(private readonly dependencies: BackupSchedulerDependencies) {
    super("Failed to refresh backup schedules");
  }

  loadSchedules(): Promise<BackupScheduleItem[]> {
    return this.dependencies.loadSchedules();
  }

  buildSignature(schedule: BackupScheduleItem): string {
    return `${schedule.cronExpression}\0${schedule.timezone}`;
  }

  protected override getCronMode(): "5-part" | undefined {
    return "5-part";
  }

  async onTrigger(scheduleId: string): Promise<void> {
    try {
      const run = await this.dependencies.trigger(scheduleId);
      if (run) {
        log.info({
          message: "Scheduled backup queued",
          scheduleId,
          runId: run.id,
        });
      }
    } catch (error) {
      log.error({
        message: "Failed to queue scheduled backup",
        scheduleId,
        err: error,
      });
    }
  }
}
