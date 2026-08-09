export type OutputMode = "human" | "json" | "silent";

export type GlobalOptions = {
  apiUrl: string;
  token?: string;
  sessionCookie?: string;
  output: OutputMode;
  yes: boolean;
  organizationId?: string;
  projectId?: string;
  environmentId?: string;
};

export type ProjectLink = {
  apiUrl: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  createdAt: string;
};

export type CommandContext = {
  options: GlobalOptions;
  positionals: string[];
  flags: Map<string, string | true>;
};

export type ApiResponse<T> = {
  data: T;
  response: Response;
};
