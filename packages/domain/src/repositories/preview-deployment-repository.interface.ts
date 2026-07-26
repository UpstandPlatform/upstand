import type {
  CreatePreviewDeploymentDTO,
  PreviewDeployment,
} from "../entities/preview-deployment";

export interface IPreviewDeploymentRepository {
  findById(id: string): Promise<PreviewDeployment | null>;
  findMany(): Promise<PreviewDeployment[]>;
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
