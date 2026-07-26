import { schedule } from "@upstand/db";
import type {
  CreateScheduleDTO,
  IScheduleRepository,
  Schedule,
} from "@upstand/domain";
import { eq } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

export class DrizzleScheduleRepository
  extends BaseRepository<typeof schedule, Schedule, CreateScheduleDTO>
  implements IScheduleRepository
{
  constructor(executor: Executor) {
    super(executor, schedule);
  }

  async findEnabled(): Promise<Schedule[]> {
    return this.findMany({
      where: eq(schedule.enabled, true),
    });
  }

  async findByResourceId(resourceId: string): Promise<Schedule[]> {
    return this.findMany({
      where: eq(schedule.resourceId, resourceId),
    });
  }
}
