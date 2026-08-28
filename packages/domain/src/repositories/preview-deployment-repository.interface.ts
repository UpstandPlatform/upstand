import type {
  CreatePreviewDeploymentDTO,
  PreviewDeployment,
} from "../entities/preview-deployment";

export type PreviewRoutingProjection = Pick<
  PreviewDeployment,
  "id" | "resourceId" | "appName" | "status" | "domain"
>;

export interface IPreviewDeploymentRepository {
  findById(id: string): Promise<PreviewDeployment | null>;
  findMany(): Promise<PreviewDeployment[]>;
  /** Return a bounded batch of previews in one lifecycle state. */
  findByStatus(
    status: PreviewDeployment["status"],
    limit?: number,
  ): Promise<PreviewDeployment[]>;
  /** Return only previews that can affect Caddy routing. */
  findForCaddy?(includePreviewId?: string): Promise<PreviewRoutingProjection[]>;
  findByResourceId(resourceId: string): Promise<PreviewDeployment[]>;
  findByPullRequestId(
    resourceId: string,
    pullRequestId: number,
  ): Promise<PreviewDeployment | null>;
  create(data: CreatePreviewDeploymentDTO): Promise<PreviewDeployment>;
  updateById(
    id: string,
    data: Partial<CreatePreviewDeploymentDTO>,
  ): Promise<PreviewDeployment | null>;
  deleteById(id: string): Promise<boolean>;
}
