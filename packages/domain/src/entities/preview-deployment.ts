export interface PreviewDeployment {
  id: string;
  resourceId: string;
  pullRequestId: number;
  branchName: string;
  appName: string;
  status: "idle" | "running" | "success" | "failed";
  domain: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePreviewDeploymentDTO = Omit<
  PreviewDeployment,
  "id" | "createdAt" | "updatedAt"
>;
