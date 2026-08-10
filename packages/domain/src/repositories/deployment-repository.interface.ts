import type {
  CreateDeploymentDTO,
  Deployment,
  UpdateDeploymentDTO,
} from "../entities/deployment";

export interface IDeploymentRepository {
  findById(id: string): Promise<Deployment | null>;
  findByIds?(ids: readonly string[]): Promise<Deployment[]>;
  findMany(): Promise<Deployment[]>;
  findRecent(limit?: number): Promise<Deployment[]>;
  findRecentByResourceIds(
    resourceIds: readonly string[],
    limit?: number,
  ): Promise<Deployment[]>;
  findByStatus(status: string, limit?: number): Promise<Deployment[]>;
  findByResourceId(resourceId: string): Promise<Deployment[]>;
  create(data: CreateDeploymentDTO): Promise<Deployment>;
  setPlanIfAbsent(
    id: string,
    plan: import("../entities/deployment-plan").DeploymentPlan,
  ): Promise<Deployment | null>;
  updateById(
    id: string,
    patch: UpdateDeploymentDTO,
  ): Promise<Deployment | null>;
  claimForExecution?(
    id: string,
    executionToken: string,
    now: Date,
    leaseMs?: number,
  ): Promise<Deployment | null>;
  updateByIdOwned?(
    id: string,
    executionToken: string,
    patch: UpdateDeploymentDTO,
  ): Promise<Deployment | null>;
  heartbeatOwned?(
    id: string,
    executionToken: string,
    now: Date,
  ): Promise<Deployment | null>;
  findStaleRunning?(staleBefore: Date, limit?: number): Promise<Deployment[]>;
  markStale?(
    id: string,
    staleBefore: Date,
    message: string,
  ): Promise<Deployment | null>;
  deleteById(id: string): Promise<boolean>;
}
