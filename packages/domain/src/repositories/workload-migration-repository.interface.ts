import type {
  CreateWorkloadMigrationDTO,
  UpdateWorkloadMigrationDTO,
  WorkloadMigration,
} from "../entities/workload-migration";

export interface IWorkloadMigrationRepository {
  findById(id: string): Promise<WorkloadMigration | null>;
  findByResourceId(
    resourceId: string,
    limit?: number,
  ): Promise<WorkloadMigration[]>;
  findResumable(limit?: number): Promise<WorkloadMigration[]>;
  create(input: CreateWorkloadMigrationDTO): Promise<WorkloadMigration>;
  updateById(
    id: string,
    patch: UpdateWorkloadMigrationDTO,
  ): Promise<WorkloadMigration | null>;
  claim(
    id: string,
    executionToken: string,
    now: Date,
    staleBefore: Date,
  ): Promise<WorkloadMigration | null>;
  updateOwned(
    id: string,
    executionToken: string,
    patch: UpdateWorkloadMigrationDTO,
  ): Promise<WorkloadMigration | null>;
}
