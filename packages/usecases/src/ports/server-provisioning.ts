import type { Server } from "@upstand/domain";

export interface ProvisioningCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ServerProvisioningSession {
  execute(command: string): Promise<ProvisioningCommandResult>;
  upload(localPath: string, remotePath: string): Promise<void>;
  dockerInfo(): Promise<{ Swarm?: { LocalNodeState?: string } }>;
  initializeCaddy(settings: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

export interface ServerProvisioningPort {
  connect(input: {
    server: Server;
    privateKey: string;
    hostKeyFingerprint: string;
  }): Promise<ServerProvisioningSession>;
}
