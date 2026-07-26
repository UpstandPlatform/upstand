import type {
  GetScheduleLogsInput,
  IUnitOfWork,
  ScheduleLog,
} from "@upstand/domain";
import { GetScheduleLogsInputSchema } from "@upstand/domain";

export class GetScheduleLogsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetScheduleLogsInput): Promise<ScheduleLog[]> {
    const parsed = GetScheduleLogsInputSchema.parse(input);
    return this.uow.scheduleLogRepository.find(parsed);
  }
}
