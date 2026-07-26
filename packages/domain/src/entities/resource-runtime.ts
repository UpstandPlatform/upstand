export interface ResourceRuntime {
  resourceId: string;
  version: number;
  containers: unknown[];
  observedAt: Date | null;
  source: string;
}
