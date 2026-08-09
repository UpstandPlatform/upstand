export type GitHubRepositoryInspection = {
  repository: {
    fullName: string;
    defaultBranch: string;
    cloneProtocol: "https" | "ssh" | "unknown";
    permissions: { pull: boolean; push: boolean; admin: boolean };
  };
  ref: { name: string; sha: string } | null;
  webhook: { configured: boolean; active: boolean; host?: string } | null;
  rateLimit: { remaining: number | null; resetAt: string | null };
};

export interface GitHubDiagnosticsPort {
  inspect(input: {
    token: string;
    appJwt?: string;
    owner: string;
    repository: string;
    ref: string;
  }): Promise<GitHubRepositoryInspection>;
}
