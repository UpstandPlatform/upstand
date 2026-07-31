import type {
  AdoptedCert,
  EdgeStatus,
  ProxyKind,
  ProxyScanResult,
} from "@upstand/domain";

export interface CommandExecutor {
  exec(
    command: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface IProxyDetector {
  probeEdge(executor?: CommandExecutor, serverId?: string): Promise<EdgeStatus>;
}

export interface IProxyImporter {
  canImportProxy(kind: ProxyKind): boolean;
  scanImportableSites(
    executor?: CommandExecutor,
    kind?: ProxyKind,
    serverId?: string,
  ): Promise<ProxyScanResult>;
  extractCertificates(
    executor?: CommandExecutor,
    serverId?: string,
  ): Promise<AdoptedCert[]>;
}

export interface RunProxyTakeoverInput {
  serverId: string;
  executor?: CommandExecutor;
  acmeEmail?: string;
}

export interface ProxyTakeoverResult {
  ok: boolean;
  registeredSites: string[];
  journalId: string;
  warnings: string[];
  error?: string;
}

export interface IProxyTakeoverManager {
  takeover(input: RunProxyTakeoverInput): Promise<ProxyTakeoverResult>;
  rollback(journalId: string, executor?: CommandExecutor): Promise<boolean>;
}
