import type { CreateScheduleDTO, Schedule } from "../entities/schedule";

export interface IScheduleRepository {
  findById(id: string): Promise<Schedule | null>;
  findEnabled(): Promise<Schedule[]>;
  findByResourceId(resourceId: string): Promise<Schedule[]>;
  create(data: CreateScheduleDTO): Promise<Schedule>;
  updateById(
    id: string,
    data: Partial<CreateScheduleDTO>,
  ): Promise<Schedule | null>;
  deleteById(id: string): Promise<boolean>;
}
