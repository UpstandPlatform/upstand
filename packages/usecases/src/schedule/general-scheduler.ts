import { log } from "evlog";
import {
  BaseCronScheduler,
  type ScheduledJobItem,
} from "./base-cron-scheduler";

export interface CustomScheduleItem extends ScheduledJobItem {
  id: string;
  cronExpression: string;
  timezone?: string | null;
  jobType?: string | null;
  serviceName?: string | null;
  shellType?: string | null;
  backupScheduleId?: string | null;
  httpMethod?: string | null;
  secretEnvVar?: string | null;
  command: string;
}

export interface GeneralSchedulerDependencies {
  loadSchedules: () => Promise<CustomScheduleItem[]>;
  execute: (scheduleId: string, manual: boolean) => Promise<void>;
}

export class GeneralScheduler extends BaseCronScheduler<CustomScheduleItem> {
  constructor(private readonly dependencies: GeneralSchedulerDependencies) {
    super("Failed to refresh custom schedules", "general");
  }

  loadSchedules(): Promise<CustomScheduleItem[]> {
    return this.dependencies.loadSchedules();
  }

  buildSignature(schedule: CustomScheduleItem): string {
    const timezone = schedule.timezone || "UTC";
    return `${schedule.cronExpression}\0${timezone}\0${schedule.jobType ?? "command"}\0${schedule.serviceName ?? ""}\0${schedule.shellType ?? "bash"}\0${schedule.backupScheduleId ?? ""}\0${schedule.httpMethod ?? "GET"}\0${schedule.secretEnvVar ?? ""}\0${schedule.command}`;
  }

  /** Execute a persisted schedule immediately, even when it is disabled. */
  async executeNow(scheduleId: string): Promise<void> {
    await this.trigger(scheduleId, true);
  }

  async onTrigger(scheduleId: string): Promise<void> {
    await this.trigger(scheduleId, false);
  }

  private async trigger(scheduleId: string, manual = false): Promise<void> {
    try {
      await this.dependencies.execute(scheduleId, manual);
    } catch (error) {
      log.error({
        message: "Failed to execute scheduled job",
        scheduleId,
        err: error,
      });
    }
  }
}
