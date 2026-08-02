import type {
  CreateEnvironmentDTO,
  Environment,
  EnvironmentSummaryProjection,
  UpdateEnvironmentDTO,
} from "../entities/environment";

export interface IEnvironmentRepository {
  findById(id: string): Promise<Environment | null>;
  /** Return one environment's metadata without hydrating encrypted variables. */
  findSummaryById?(id: string): Promise<EnvironmentSummaryProjection | null>;
  findByProjectId(projectId: string): Promise<Environment[]>;
  /** Return environment metadata without hydrating encrypted variables. */
  findSummariesByProjectId?(
    projectId: string,
  ): Promise<EnvironmentSummaryProjection[]>;
  /** Return only identifiers for organization-scoping reads. */
  findIdsByProjectId?(projectId: string): Promise<string[]>;
  findAncestors?(id: string): Promise<Environment[]>;
  create(data: CreateEnvironmentDTO): Promise<Environment>;
  findMany(options?: unknown): Promise<Environment[]>;
  createMany(values: CreateEnvironmentDTO[]): Promise<Environment[]>;
  updateById(
    id: string,
    patch: Partial<CreateEnvironmentDTO>,
  ): Promise<Environment | null>;
  /** Update mutable fields including project-level environment variables. */
  updateEnvironment(
    id: string,
    patch: UpdateEnvironmentDTO,
  ): Promise<Environment | null>;
  incrementResourceCount(id: string, delta: number): Promise<void>;
  deleteById(id: string): Promise<boolean>;
  count(where?: unknown): Promise<number>;
}
