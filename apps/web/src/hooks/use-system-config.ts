import { useQuery } from "@tanstack/react-query";
import { getServerApiUrl } from "@/lib/server-url";

type SystemConfig = {
  isCloud: boolean;
  platformMode: "desktop" | "self-hosted" | "cloud";
  capabilities: {
    mode: "desktop" | "self-hosted" | "cloud";
    localRuntime: boolean;
    remoteServers: boolean;
    localEdge: boolean;
    remoteEdge: boolean;
    scheduler: boolean;
    redis: boolean;
    cloudConnection: boolean;
    jobs: boolean;
    acmeCertificates?: boolean;
    localGitCli?: boolean;
    localDockerSocket?: boolean;
    swarmManagement?: boolean;
    localFileSystemBackups?: boolean;
    embeddedMonitoring?: boolean;
    desktopNativeNotifications?: boolean;
    enterpriseScimSso?: boolean;
    serverMigration?: boolean;
  };
};

async function fetchSystemConfig(): Promise<SystemConfig> {
  const response = await fetch(getServerApiUrl("/api/setup/status"), {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Unable to load system configuration");
  }

  const payload = (await response.json()) as {
    isCloud?: unknown;
    platformMode?: unknown;
    capabilities?: SystemConfig["capabilities"];
  };
  const platformMode =
    payload.platformMode === "desktop" ||
    payload.platformMode === "cloud" ||
    payload.platformMode === "self-hosted"
      ? payload.platformMode
      : payload.isCloud === true
        ? "cloud"
        : "self-hosted";
  return {
    isCloud: platformMode === "cloud",
    platformMode,
    capabilities: payload.capabilities ?? {
      mode: platformMode,
      localRuntime: platformMode !== "cloud",
      remoteServers: true,
      localEdge: platformMode !== "cloud",
      remoteEdge: true,
      scheduler: true,
      redis: platformMode !== "desktop",
      cloudConnection: platformMode !== "cloud",
      jobs: true,
      acmeCertificates: platformMode !== "desktop",
      localGitCli: platformMode === "desktop",
      localDockerSocket: platformMode !== "cloud",
      swarmManagement: platformMode === "self-hosted",
      localFileSystemBackups: platformMode !== "cloud",
      embeddedMonitoring: platformMode !== "cloud",
      desktopNativeNotifications: platformMode === "desktop",
      enterpriseScimSso: platformMode !== "desktop",
      serverMigration: true,
    },
  };
}

/** Reads deployment mode from the server so the web image is deployment-agnostic. */
export function useSystemConfig() {
  const query = useQuery({
    queryKey: ["system-config"],
    queryFn: fetchSystemConfig,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });

  return {
    ...query,
    isCloud: query.data?.isCloud === true,
    platformMode: query.data?.platformMode ?? "self-hosted",
    capabilities: query.data?.capabilities,
  };
}
