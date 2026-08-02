import type {
  CreateScheduleLogDTO,
  CronJobObservabilityResult,
  GetCronJobObservabilityInput,
  GetScheduleLogsInput,
  ScheduleLog,
} from "../entities/schedule";

export interface IScheduleLogRepository {
  findById(id: string): Promise<ScheduleLog | null>;
  find(input: GetScheduleLogsInput): Promise<ScheduleLog[]>;
  create(data: CreateScheduleLogDTO): Promise<ScheduleLog>;
  deleteByScheduleId(scheduleId: string): Promise<boolean>;
  deleteOlderThan?(cutoff: Date): Promise<number>;
  getObservabilityMetrics(
    input: GetCronJobObservabilityInput,
  ): Promise<CronJobObservabilityResult>;
}
