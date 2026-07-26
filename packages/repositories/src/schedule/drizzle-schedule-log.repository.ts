import {
  environment,
  project,
  resource,
  schedule,
  scheduleLog,
} from "@upstand/db";
import type {
  CreateScheduleLogDTO,
  CronJobObservabilityItem,
  CronJobObservabilityResult,
  GetCronJobObservabilityInput,
  GetScheduleLogsInput,
  IScheduleLogRepository,
  ScheduleLog,
} from "@upstand/domain";
import { and, desc, eq, gte } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

type ScheduleJobType = "command" | "deployment" | "backup" | "cron";
type ScheduleSource = "upstand.json" | "manual";
type ScheduleRunStatus = "success" | "failed";

function normalizeJobType(value: string | null): ScheduleJobType {
  return value === "deployment" ||
    value === "backup" ||
    value === "cron" ||
    value === "command"
    ? value
    : "command";
}

function normalizeSource(value: string | null): ScheduleSource {
  return value === "upstand.json" ? value : "manual";
}

function normalizeRunStatus(value: string | null): ScheduleRunStatus | null {
  return value === "success" || value === "failed" ? value : null;
}

export class DrizzleScheduleLogRepository
  extends BaseRepository<typeof scheduleLog, ScheduleLog, CreateScheduleLogDTO>
  implements IScheduleLogRepository
{
  constructor(executor: Executor) {
    super(executor, scheduleLog);
  }

  async find(input: GetScheduleLogsInput): Promise<ScheduleLog[]> {
    const conditions = [];
    if (input.scheduleId) {
      conditions.push(eq(scheduleLog.scheduleId, input.scheduleId));
    }
    if (input.resourceId) {
      conditions.push(eq(scheduleLog.resourceId, input.resourceId));
    }

    const whereClause =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);

    return this.findMany({
      where: whereClause,
      orderBy: desc(scheduleLog.executedAt),
      limit: input.limit ?? 50,
    });
  }

  async deleteByScheduleId(scheduleId: string): Promise<boolean> {
    await this.deleteMany(eq(scheduleLog.scheduleId, scheduleId));
    return true;
  }

  async getObservabilityMetrics(
    input: GetCronJobObservabilityInput,
  ): Promise<CronJobObservabilityResult> {
    const timespan = input.timespan || "30d";
    const now = Date.now();
    const millisInTimespan =
      timespan === "24h"
        ? 24 * 60 * 60 * 1000
        : timespan === "7d"
          ? 7 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(now - millisInTimespan);

    // Fetch schedules belonging to the organization
    const scheduleRows = await this.executor
      .select({
        scheduleId: schedule.id,
        resourceId: schedule.resourceId,
        resourceName: resource.name,
        name: schedule.name,
        description: schedule.description,
        command: schedule.command,
        cronExpression: schedule.cronExpression,
        timezone: schedule.timezone,
        jobType: schedule.jobType,
        source: schedule.source,
        enabled: schedule.enabled,
        lastRunAt: schedule.lastRunAt,
        lastRunStatus: schedule.lastRunStatus,
      })
      .from(schedule)
      .innerJoin(resource, eq(schedule.resourceId, resource.id))
      .innerJoin(environment, eq(resource.environmentId, environment.id))
      .innerJoin(project, eq(environment.projectId, project.id))
      .where(
        and(
          eq(project.organizationId, input.organizationId),
          input.resourceId ? eq(resource.id, input.resourceId) : undefined,
        ),
      );

    const scheduleIds: string[] = scheduleRows.map(
      (scheduleRow): string => scheduleRow.scheduleId,
    );

    // Fetch logs within timeframe
    const logs =
      scheduleIds.length > 0
        ? await this.findMany({
            where: gte(scheduleLog.executedAt, cutoffDate),
            orderBy: desc(scheduleLog.executedAt),
          })
        : [];

    // Group logs by scheduleId
    const logsBySchedule = new Map<string, ScheduleLog[]>();
    for (const item of logs) {
      const existing = logsBySchedule.get(item.scheduleId) || [];
      existing.push(item);
      logsBySchedule.set(item.scheduleId, existing);
    }

    const items: CronJobObservabilityItem[] = [];
    let totalInvocations = 0;
    let totalSuccess = 0;
    const allDurations: number[] = [];

    for (const sch of scheduleRows) {
      const schLogs = logsBySchedule.get(sch.scheduleId) || [];
      const invocationsCount = schLogs.length;

      let successCount = 0;
      let failedCount = 0;
      const durations: number[] = [];

      for (const l of schLogs) {
        if (l.status === "success") successCount++;
        else failedCount++;
        durations.push(l.durationMs);
        allDurations.push(l.durationMs);
      }

      totalInvocations += invocationsCount;
      totalSuccess += successCount;

      durations.sort((a, b) => a - b);
      const p75DurationMs =
        durations.length > 0
          ? durations[Math.floor(durations.length * 0.75)] || 0
          : 0;

      // Filter by status if requested
      if (input.status === "success" && sch.lastRunStatus !== "success")
        continue;
      if (input.status === "failed" && sch.lastRunStatus !== "failed") continue;

      // Filter by search text
      if (input.search) {
        const q = input.search.toLowerCase();
        const match =
          sch.name.toLowerCase().includes(q) ||
          sch.command.toLowerCase().includes(q) ||
          Boolean(sch.resourceName?.toLowerCase().includes(q));
        if (!match) continue;
      }

      items.push({
        id: sch.scheduleId,
        resourceId: sch.resourceId,
        resourceName: sch.resourceName,
        name: sch.name,
        description: sch.description,
        command: sch.command,
        cronExpression: sch.cronExpression,
        timezone: sch.timezone || "UTC",
        jobType: normalizeJobType(sch.jobType),
        source: normalizeSource(sch.source),
        enabled: sch.enabled,
        invocationsCount,
        p75DurationMs,
        successCount,
        failedCount,
        lastRunAt: sch.lastRunAt,
        lastRunStatus: normalizeRunStatus(sch.lastRunStatus),
      });
    }

    allDurations.sort((a, b) => a - b);
    const p75DurationMs =
      allDurations.length > 0
        ? allDurations[Math.floor(allDurations.length * 0.75)] || 0
        : 0;
    const successRate =
      totalInvocations > 0 ? (totalSuccess / totalInvocations) * 100 : 100;

    return {
      timespan,
      totalJobs: items.length,
      totalInvocations,
      p75DurationMs,
      successRate,
      items,
    };
  }
}
