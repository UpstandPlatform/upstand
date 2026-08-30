import type { Certificate, Resource } from "@upstand/domain";

export type CaddySettings = {
  letsEncryptEmail?: string | null;
  cloudflareApiToken?: string | null;
  httpPort?: number;
  httpsPort?: number;
  enableHttp3?: boolean;
  globalCaddyfile?: string | null;
  caddySnippets?: string;
  caddyMiddlewares?: string;
  caddyEnvironment?: string;
  caddyPorts?: string;
  caddyDashboardEnabled?: boolean;
  accessLogsEnabled?: boolean;
};

export type CaddyCertificate = Pick<
  Certificate,
  "id" | "certificatePem" | "privateKeyPem"
>;
export interface CaddyStatus {
  running: boolean;
  status: string;
  uptime: string;
  ports: string[];
  activeDomainsCount: number;
  activeDomains: string[];
  mainCaddyfile: string;
}

export type CaddyPortBinding = {
  protocol: "tcp" | "udp";
  targetPort: number;
  publishedPort: number;
};

export type CaddyProvisioningInput = {
  networkName: string;
  caddyfileBase64: string;
  environment: string[];
  ports: CaddyPortBinding[];
  forceRecreate?: boolean;
};

export type CaddyConfigurationInput = {
  caddyfileBase64: string;
  certificates: CaddyCertificate[];
};

/**
 * Fixed-shape capability for provisioning the platform Caddy container.
 * Resource deployment code must not receive this platform-level authority.
 */
export interface CaddyProvisioningPort {
  ensureCaddyContainer(input: CaddyProvisioningInput): Promise<void>;
  setControlPlaneIpAccess?(enabled: boolean): Promise<void>;
  applyCaddyConfiguration?(input: CaddyConfigurationInput): Promise<{
    changed: boolean;
  }>;
}

export type CaddyResource = Pick<
  Resource,
  "id" | "name" | "type" | "appName" | "domains" | "composeType"
> & {
  advancedConfig?: Resource["advancedConfig"];
};

export interface CaddyServicePort {
  initializeCaddy(
    settings?: CaddySettings,
    forceRecreate?: boolean,
  ): Promise<void>;
  syncResourceConfigs(
    resources: CaddyResource[],
    settings?: CaddySettings,
    certificates?: CaddyCertificate[],
  ): Promise<{ success: true; domains: string[]; changed: boolean }>;
  reloadCaddy(): Promise<{ success: boolean; error?: string }>;
  getStatus(): Promise<CaddyStatus>;
  getLogs(tail?: number): Promise<string>;
  getAccessLogs(tail?: number): Promise<string>;
  cleanupAccessLogs(): Promise<void>;
  setControlPlaneIpAccess(enabled: boolean): Promise<void>;
  restartCaddy(): Promise<{ success: boolean; error?: string }>;
}
