"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Checkbox } from "@upstand/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@upstand/ui/components/dropdown-menu";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import { Switch } from "@upstand/ui/components/switch";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageSkeleton } from "@/components/dashboard/page-skeleton";
import {
  ArrowRightIcon as ArrowRight,
  Copy,
  PlusIcon,
  RefreshCw,
  ServerIcon,
  ShieldCheck,
  Trash2Icon,
} from "@/components/huge-icons";
import { SelfUpdateDialog } from "@/components/self-update-dialog";
import { CodeEditor, CodeSurface } from "@/components/shared/code-editor";
import { ShowDockerLogs } from "@/components/shared/docker-logs";
import {
  KeyValueEditor,
  validateKeyValuePairs,
} from "@/components/shared/key-value-editor";
import { WebServerTerminalDialog } from "@/components/web-server-terminal-dialog";
import {
  type CertificateProvider,
  ServerDomainCard,
} from "@/features/web-server/components/server-domain-card";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { useSystemConfig } from "@/hooks/use-system-config";
import type { authClient } from "@/lib/auth-client";
import { copyText } from "@/lib/browser";
import { trpc } from "@/utils/trpc";

interface PortMapping {
  targetPort: number;
  publishedPort: number;
  protocol: "tcp" | "udp";
}

interface EnvVar {
  key: string;
  value: string;
}

type CleanupInput = {
  organizationId: string;
  confirm: "CLEANUP";
  preserveRollbackImages?: boolean;
  pruneNetworks?: boolean;
};

interface CaddyMiddleware {
  name: string;
  body: string;
}

export default function WebServerDashboard(_props: {
  session: typeof authClient.$Infer.Session;
}) {
  const queryClient = useQueryClient();
  const organizationState = useRequiredActiveOrganization();
  const activeOrganization =
    organizationState.status === "ready"
      ? organizationState.organization
      : null;
  const organizationId = organizationState.organizationId as string;
  // Database Web Server settings
  const [serverDomain, setServerDomain] = useState("");
  const [httpsEnabled, setHttpsEnabled] = useState(true);
  const [ipAccessEnabled, setIpAccessEnabled] = useState(true);
  const [certificateProvider, setCertificateProvider] =
    useState<CertificateProvider>("letsencrypt");
  const [certificateId, setCertificateId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [cloudflareApiToken, setCloudflareApiToken] = useState("");
  const [httpPort, setHttpPort] = useState(80);
  const [httpsPort, setHttpsPort] = useState(443);
  const [enableHttp3, setEnableHttp3] = useState(true);
  const [globalCaddyfile, setGlobalCaddyfile] = useState("");
  const [caddySnippets, setCaddySnippets] = useState("");
  const [caddyMiddlewares, setCaddyMiddlewares] = useState<CaddyMiddleware[]>(
    [],
  );
  const [editingSettings, setEditingSettings] = useState(false);

  // Dialogue States
  const [serverLogsOpen, setServerLogsOpen] = useState(false);
  const [gpuModalOpen, setGpuModalOpen] = useState(false);
  const [envModalOpen, setEnvModalOpen] = useState(false);
  const [portsModalOpen, setPortsModalOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [updateDialogVersion, setUpdateDialogVersion] = useState<string>();
  const [webBackupDestinationId, setWebBackupDestinationId] = useState("");
  const [webBackupName, setWebBackupName] = useState("Web server backup");
  const [webBackupCron, setWebBackupCron] = useState("0 3 * * *");
  const [webBackupPrefix, setWebBackupPrefix] = useState("web-server");

  // Additional settings states
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [portMappings, setPortMappings] = useState<PortMapping[]>([]);

  // Log views
  const [caddyLogsTail, setCaddyLogsTail] = useState(100);
  const [serverLogsTail, _setServerLogsTail] = useState(100);
  const [_caddyLogsCopied, setCaddyLogsCopied] = useState(false);
  const [, setServerLogsCopied] = useState(false);
  const [autoRefreshCaddyLogs, setAutoRefreshCaddyLogs] = useState(true);
  const [autoRefreshServerLogs, _setAutoRefreshServerLogs] = useState(true);
  const [restoreRunIdToConfirm, setRestoreRunIdToConfirm] = useState<
    string | null
  >(null);
  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);

  // 1. Fetch Caddy/server settings and container status
  const {
    data: info,
    isPending: loadingInfo,
    refetch: refetchInfo,
  } = useQuery({
    ...trpc.webServer.getSettings.queryOptions(),
    refetchInterval: 30_000,
  });

  const { data: webBackupDestinations = [] } = useQuery({
    ...trpc.s3Destination.list.queryOptions({
      organizationId,
    }),
    enabled: organizationState.status === "ready",
  });
  const { data: certificatesData = [] } = useQuery({
    ...trpc.certificate.list.queryOptions({
      organizationId,
    }),
    enabled: organizationState.status === "ready",
  });
  const { data: webBackupSchedules = [], refetch: refetchWebBackupSchedules } =
    useQuery({
      ...trpc.backup.listWebServerSchedules.queryOptions({
        organizationId,
      }),
      enabled: organizationState.status === "ready",
    });
  const { data: webBackupRuns = [], refetch: refetchWebBackupRuns } = useQuery({
    ...trpc.backup.listWebServerRuns.queryOptions({
      organizationId,
      limit: 10,
    }),
    enabled: organizationState.status === "ready",
  });

  // 2. Fetch Caddy logs
  const {
    data: caddyLogs,
    isPending: loadingCaddyLogs,
    refetch: refetchCaddyLogs,
  } = useQuery({
    ...trpc.webServer.getLogs.queryOptions({ tail: caddyLogsTail }),
    refetchInterval: autoRefreshCaddyLogs ? 5000 : false,
  });

  // 3. Fetch Server logs
  const {
    data: serverLogs,
    isPending: loadingServerLogs,
    refetch: refetchServerLogs,
  } = useQuery({
    ...trpc.webServer.getServerLogs.queryOptions({ tail: serverLogsTail }),
    refetchInterval: serverLogsOpen && autoRefreshServerLogs ? 5000 : false,
    enabled: serverLogsOpen,
  });

  useEffect(() => {
    if (serverLogsOpen) {
      void refetchServerLogs();
    }
  }, [serverLogsOpen, refetchServerLogs]);

  // 4. Fetch GPU Status
  const { data: gpuStatus, isPending: loadingGpu } = useQuery({
    ...trpc.webServer.checkGpuStatus.queryOptions(),
    enabled: gpuModalOpen,
  });

  // 5. Fetch Updates status
  const { data: updateData, refetch: refetchUpdates } = useQuery({
    ...trpc.webServer.getUpdateData.queryOptions(),
  });

  // Sync state with fetched settings
  useEffect(() => {
    if (info?.settings && !editingSettings) {
      setServerDomain(info.settings.serverDomain || "");
      setHttpsEnabled(info.settings.httpsEnabled ?? true);
      setIpAccessEnabled(info.settings.ipAccessEnabled ?? true);
      setCertificateProvider(
        (info.settings.certificateProvider as CertificateProvider) ||
          "letsencrypt",
      );
      setCertificateId(info.settings.certificateId || null);
      setEmail(info.settings.letsEncryptEmail || "");
      setCloudflareApiToken(info.settings.cloudflareApiToken || "");
      setHttpPort(info.settings.httpPort);
      setHttpsPort(info.settings.httpsPort);
      setEnableHttp3(info.settings.enableHttp3);
      setGlobalCaddyfile(info.settings.globalCaddyfile || "");
      setCaddySnippets(info.settings.caddySnippets || "");
      try {
        const parsed = JSON.parse(info.settings.caddyMiddlewares || "[]");
        setCaddyMiddlewares(
          Array.isArray(parsed)
            ? parsed.filter(
                (item): item is CaddyMiddleware =>
                  Boolean(item) &&
                  typeof item.name === "string" &&
                  typeof item.body === "string",
              )
            : [],
        );
      } catch {
        setCaddyMiddlewares([]);
      }

      // Sync Environment variables
      try {
        const parsedEnv = JSON.parse(info.settings.caddyEnvironment || "{}");
        const list = Object.entries(parsedEnv).map(([k, v]) => ({
          key: k,
          value: String(v),
        }));
        setEnvVars(list);
      } catch {
        setEnvVars([]);
      }

      // Sync Ports
      try {
        const parsedPorts = JSON.parse(info.settings.caddyPorts || "[]");
        setPortMappings(parsedPorts);
      } catch {
        setPortMappings([]);
      }
    }
  }, [info, editingSettings]);

  // Mutations
  const updateSettingsMutation = useMutation({
    ...trpc.webServer.updateSettings.mutationOptions(),
    onSuccess: () => {
      toast.success("Web Server settings updated successfully");
      refetchInfo();
      refetchCaddyLogs();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update settings");
    },
  });

  const reloadMutation = useMutation({
    ...trpc.webServer.reload.mutationOptions(),
    onSuccess: (_, variables) => {
      const act = variables.action === "restart" ? "restarted" : "reloaded";
      toast.success(`Caddy proxy successfully ${act}`);
      refetchInfo();
      refetchCaddyLogs();
    },
    onError: (err) => {
      toast.error(err.message || "Operation failed");
    },
  });

  const reloadServerMutation = useMutation({
    ...trpc.webServer.reloadServer.mutationOptions(),
    onSuccess: () => {
      toast.success("Upstand server restart command issued successfully");
      setTimeout(() => refetchInfo(), 3000);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to restart server container");
    },
  });

  const updateServerIpMutation = useMutation({
    ...trpc.webServer.updateServerIp.mutationOptions(),
    onSuccess: (data) => {
      toast.success(`Server public IP updated to: ${data.ip}`);
      refetchInfo();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update Server IP");
    },
  });

  const cleanRedisMutation = useMutation({
    ...trpc.webServer.cleanRedis.mutationOptions(),
    onSuccess: () => {
      toast.success("Redis database flushed successfully (flushall)");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to flush Redis");
    },
  });

  const reloadRedisMutation = useMutation({
    ...trpc.webServer.reloadRedis.mutationOptions(),
    onSuccess: () => {
      toast.success("Redis container restarted successfully");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to restart Redis container");
    },
  });

  const cleanAllDeploymentQueueMutation = useMutation({
    ...trpc.webServer.cleanAllDeploymentQueue.mutationOptions(),
    onSuccess: () => {
      toast.success(
        "Deployment queue cleaned. Stuck deployments marked as failed.",
      );
    },
    onError: (err) => {
      toast.error(err.message || "Failed to clean deployment queue");
    },
  });

  const [cleanupAction, setCleanupAction] = useState<{
    title: string;
    description: string;
    action: (input: CleanupInput) => void;
    pending: boolean;
  } | null>(null);
  const [preserveRollbackImages, setPreserveRollbackImages] = useState(true);
  const [pruneNetworks, setPruneNetworks] = useState(false);
  const [updateIpDialogOpen, setUpdateIpDialogOpen] = useState(false);
  const [serverIpInput, setServerIpInput] = useState("");

  const triggerCleanup = (
    title: string,
    description: string,
    action: (input: CleanupInput) => void,
    pending: boolean,
  ) => {
    if (!activeOrganization?.id) {
      toast.error("Select an organization before running Docker cleanup.");
      return;
    }
    setCleanupAction({ title, description, action, pending });
  };

  const cleanUnusedImagesMutation = useMutation({
    ...trpc.webServer.cleanUnusedImages.mutationOptions(),
    onSuccess: () => {
      toast.success("Unused Docker images pruned successfully");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to prune images");
    },
  });

  const cleanUnusedVolumesMutation = useMutation({
    ...trpc.webServer.cleanUnusedVolumes.mutationOptions(),
    onSuccess: () => {
      toast.success("Unused Docker volumes pruned successfully");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to prune volumes");
    },
  });

  const cleanStoppedContainersMutation = useMutation({
    ...trpc.webServer.cleanStoppedContainers.mutationOptions(),
    onSuccess: () => {
      toast.success("Stopped Docker containers pruned successfully");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to prune containers");
    },
  });

  const cleanDockerBuilderMutation = useMutation({
    ...trpc.webServer.cleanDockerBuilder.mutationOptions(),
    onSuccess: () => {
      toast.success("Docker build cache cleaned successfully");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to clean builder cache");
    },
  });

  const cleanDockerPruneMutation = useMutation({
    ...trpc.webServer.cleanDockerPrune.mutationOptions(),
    onSuccess: () => {
      toast.success("Docker system prune completed successfully");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to run system prune");
    },
  });

  const cleanAllMutation = useMutation({
    ...trpc.webServer.cleanAll.mutationOptions(),
    onSuccess: () => {
      toast.success("Comprehensive background Docker cleanup started");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to start cleanup");
    },
  });

  const setupGpuMutation = useMutation({
    ...trpc.webServer.setupGpuSupport.mutationOptions(),
    onSuccess: () => {
      toast.success(
        "NVIDIA GPU support configured. Docker daemon restarting...",
      );
      setGpuModalOpen(false);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to setup GPU support");
    },
  });

  const triggerUpdateMutation = useMutation({
    ...trpc.webServer.triggerUpdate.mutationOptions(),
    onSuccess: (_, variables) => {
      setUpdateDialogVersion(variables.version);
      refetchUpdates();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to start self-update");
    },
  });

  const checkUpdatesMutation = useMutation({
    ...trpc.webServer.checkForUpdates.mutationOptions(),
    onSuccess: (result) => {
      queryClient.setQueryData(trpc.webServer.getUpdateData.queryKey(), result);
      if (result.updateAvailable && !result.canUpdate) {
        toast.info(
          `Upstand ${result.latestVersion} is available, but this source installation must be updated with the installer.`,
        );
      } else if (result.channel === "source") {
        toast.info(
          "This source installation is updated by rerunning the installer.",
        );
      } else if (result.updateAvailable) {
        toast.success(`A new version is available: ${result.latestVersion}!`, {
          description:
            "You can click 'Update Now' next to the version below to update.",
        });
      } else {
        toast.success(`Upstand is up to date (${result.currentVersion})`, {
          description: "No new updates found.",
        });
      }
    },
    onError: (err) => toast.error(err.message || "Failed to check for updates"),
  });

  const createWebBackupMutation = useMutation({
    ...trpc.backup.createWebServerSchedule.mutationOptions(),
    onSuccess: () => {
      toast.success("Web-server backup schedule created");
      refetchWebBackupSchedules();
    },
    onError: (error) => toast.error(error.message),
  });
  const runWebBackupMutation = useMutation({
    ...trpc.backup.runWebServerNow.mutationOptions(),
    onSuccess: () => {
      toast.success("Web-server backup queued");
      refetchWebBackupRuns();
    },
    onError: (error) => toast.error(error.message),
  });
  const updateWebBackupMutation = useMutation({
    ...trpc.backup.updateWebServerSchedule.mutationOptions(),
    onSuccess: () => {
      toast.success("Web-server backup schedule updated");
      refetchWebBackupSchedules();
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteWebBackupMutation = useMutation({
    ...trpc.backup.deleteWebServerSchedule.mutationOptions(),
    onSuccess: () => {
      toast.success("Web-server backup schedule deleted");
      refetchWebBackupSchedules();
    },
    onError: (error) => toast.error(error.message),
  });
  const restoreWebBackupMutation = useMutation({
    ...trpc.backup.restoreWebServer.mutationOptions(),
    onSuccess: () => toast.success("Web-server restore completed"),
    onError: (error) => toast.error(error.message),
  });

  const canDisableIpAccess =
    serverDomain.trim().length > 0 &&
    serverDomain.trim().length <= 253 &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
      serverDomain.trim(),
    ) &&
    httpsEnabled &&
    certificateProvider !== "none" &&
    (certificateProvider !== "custom" || Boolean(certificateId));

  const handleSaveServerDomain = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setEditingSettings(true);
    const savedIpAccessEnabled = canDisableIpAccess ? ipAccessEnabled : true;
    setIpAccessEnabled(savedIpAccessEnabled);
    updateSettingsMutation.mutate({
      serverDomain: serverDomain.trim() || null,
      letsEncryptEmail: email.trim() || null,
      httpsEnabled,
      certificateProvider,
      certificateId: certificateProvider === "custom" ? certificateId : null,
      ipAccessEnabled: savedIpAccessEnabled,
    });
  };

  const handleSaveSettings = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setEditingSettings(true);
    const savedIpAccessEnabled = canDisableIpAccess ? ipAccessEnabled : true;
    setIpAccessEnabled(savedIpAccessEnabled);
    updateSettingsMutation.mutate({
      serverDomain: serverDomain.trim() || null,
      letsEncryptEmail: email.trim() || null,
      httpsEnabled,
      certificateProvider,
      cloudflareApiToken: cloudflareApiToken.trim() || null,
      httpPort,
      httpsPort,
      enableHttp3,
      globalCaddyfile: globalCaddyfile.trim() || null,
      caddySnippets,
      caddyMiddlewares,
      ipAccessEnabled: savedIpAccessEnabled,
    });
  };

  const _handleCopyLogs = async (type: "caddy" | "server") => {
    const text = type === "caddy" ? caddyLogs : serverLogs;
    if (!text) return;
    try {
      await copyText(text);
      if (type === "caddy") {
        setCaddyLogsCopied(true);
        setTimeout(() => setCaddyLogsCopied(false), 2000);
      } else {
        setServerLogsCopied(true);
        setTimeout(() => setServerLogsCopied(false), 2000);
      }
      toast.success("Logs copied to clipboard");
    } catch {
      toast.error("Failed to copy logs");
    }
  };

  const handleCheckUpdates = async () => {
    toast.info("Checking for Upstand updates...");
    await checkUpdatesMutation.mutateAsync();
  };

  const handleToggleDailyCleanup = (checked: boolean) => {
    updateSettingsMutation.mutate({
      dailyDockerCleanup: checked,
    });
  };

  const handleSaveEnv = () => {
    setEditingSettings(true);
    const issues = validateKeyValuePairs(envVars);
    if (issues.length > 0) {
      toast.error(issues[0]?.message ?? "Fix the environment variables");
      return;
    }
    const obj: Record<string, string> = {};
    for (const item of envVars) {
      if (item.key.trim()) {
        obj[item.key.trim()] = item.value;
      }
    }
    updateSettingsMutation.mutate({
      caddyEnvironment: JSON.stringify(obj),
    });
    setEnvModalOpen(false);
  };

  // Ports helpers
  const handleAddPort = () => {
    setPortMappings([
      ...portMappings,
      { targetPort: 80, publishedPort: 80, protocol: "tcp" },
    ]);
  };

  const handleUpdatePort = <Field extends keyof PortMapping>(
    idx: number,
    field: Field,
    val: PortMapping[Field],
  ): void => {
    const next = [...portMappings];
    if (next[idx]) {
      next[idx] = {
        ...next[idx],
        [field]: val,
      };
      setPortMappings(next);
    }
  };

  const handleRemovePort = (idx: number) => {
    setPortMappings(portMappings.filter((_, i) => i !== idx));
  };

  const handleSavePorts = () => {
    setEditingSettings(true);
    const filtered = portMappings.filter(
      (p) => p.targetPort > 0 && p.publishedPort > 0,
    );
    updateSettingsMutation.mutate({
      caddyPorts: JSON.stringify(filtered),
    });
    setPortsModalOpen(false);
  };

  const { isCloud, isInstanceOwner, platformMode } = useSystemConfig();
  const isDesktop = platformMode === "desktop";
  const isSaving = updateSettingsMutation.isPending;

  if (isCloud && !isInstanceOwner) {
    return (
      <DashboardPage className="gap-6">
        <DashboardPageHeader
          title="Web Server"
          description="Control-plane reverse proxy and web server management."
          icon={<ServerIcon className="size-6 text-primary" />}
        />
        <Card className="p-6">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="font-semibold text-base">
              Self-Hosted Feature
            </CardTitle>
            <CardDescription className="text-xs">
              Web Server control-plane configuration (global Caddy reverse
              proxy, ports, and SSL settings for the control-plane host) applies
              to self-hosted Upstand installations.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-xs">
            On Upstand Cloud, your workloads, databases, and domain routing are
            managed on your connected{" "}
            <a
              href="/remote-servers"
              className="font-medium text-primary underline"
            >
              Remote Servers
            </a>
            .
          </CardContent>
        </Card>
      </DashboardPage>
    );
  }

  return (
    <DashboardPage>
      {/* Page Header */}
      <DashboardPageHeader
        title="Web Server"
        description="Configure dynamic domain routing, global SSL settings, ACME Let's Encrypt certificates, and review proxy access logs."
        icon={<ServerIcon className="size-6 text-primary" />}
        actions={
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              refetchInfo();
              refetchCaddyLogs();
            }}
            className="text-xs"
          >
            <RefreshCw />
          </Button>
        }
      />

      {loadingInfo ? (
        <PageSkeleton />
      ) : (
        <div className="space-y-6">
          {!isDesktop ? (
            <ServerDomainCard
              serverDomain={serverDomain}
              setServerDomain={setServerDomain}
              email={email}
              setEmail={setEmail}
              httpsEnabled={httpsEnabled}
              setHttpsEnabled={setHttpsEnabled}
              certificateProvider={certificateProvider}
              setCertificateProvider={setCertificateProvider}
              certificateId={certificateId}
              setCertificateId={setCertificateId}
              certificatesList={certificatesData}
              ipAccessEnabled={ipAccessEnabled}
              setIpAccessEnabled={setIpAccessEnabled}
              canDisableIpAccess={canDisableIpAccess}
              onSave={handleSaveServerDomain}
              isSaving={updateSettingsMutation.isPending}
            />
          ) : (
            <Card className="border border-border/40 bg-card/20 p-6 shadow-sm">
              <CardHeader className="p-0 pb-3">
                <CardTitle className="font-semibold text-base">
                  Server Domain & SSL — Desktop Mode
                </CardTitle>
                <CardDescription className="text-xs">
                  In Desktop mode, Upstand runs locally on your machine. Linking
                  custom domain names and ACME Let's Encrypt certificates to the
                  control plane is not applicable for desktop runtime.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 text-muted-foreground text-xs">
                Your workloads and applications deployed on remote servers can
                still use custom domains and SSL certificates managed on those
                specific servers.
              </CardContent>
            </Card>
          )}
          {/* <Card className="border border-border/40 bg-card/20 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-between font-semibold text-lg">
                <span>Security audit</span>
                {securityAudit && (
                  <Badge
                    variant={
                      securityAudit.score >= 80 ? "default" : "destructive"
                    }
                  >
                    {securityAudit.score}/100
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs">
                Read-only checks for Docker reachability, Swarm, ingress
                networking, and proxy exposure.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 border-border/10 border-t">
              {(securityAudit?.checks ?? []).map((check) => (
                <div
                  key={check.id}
                  className="flex items-start justify-between gap-4 rounded-md border p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{check.title}</p>
                    <p className="text-muted-foreground text-xs">
                      {check.detail}
                    </p>
                  </div>
                  <Badge
                    variant={
                      check.status === "pass"
                        ? "default"
                        : check.status === "warn"
                          ? "secondary"
                          : "destructive"
                    }
                  >
                    {check.status}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card> */}

          <Card className="border border-border/40 bg-card/20 shadow-sm">
            <CardHeader>
              <CardTitle className="font-semibold text-lg">
                Web-server backups
              </CardTitle>
              <CardDescription className="text-xs">
                Back up the Upstand control-plane database and Caddy runtime
                volumes to an organization-owned S3 destination. Restore is
                destructive and requires an explicit confirmation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 border-border/10 border-t">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="web-backup-destination">Destination</Label>
                  <Select
                    items={webBackupDestinations.map((destination) => ({
                      value: destination.id,
                      label: destination.name,
                    }))}
                    value={webBackupDestinationId}
                    onValueChange={(value) => {
                      if (value) setWebBackupDestinationId(value);
                    }}
                  >
                    <SelectTrigger
                      id="web-backup-destination"
                      className="w-full"
                    >
                      <SelectValue placeholder="Choose S3 destination" />
                    </SelectTrigger>
                    <SelectContent>
                      {webBackupDestinations.map((destination) => (
                        <SelectItem key={destination.id} value={destination.id}>
                          {destination.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="web-backup-name">Schedule name</Label>
                  <Input
                    id="web-backup-name"
                    value={webBackupName}
                    onChange={(event) => setWebBackupName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="web-backup-cron">Cron</Label>
                  <Input
                    id="web-backup-cron"
                    value={webBackupCron}
                    onChange={(event) => setWebBackupCron(event.target.value)}
                    placeholder="0 3 * * *"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="web-backup-prefix">Storage prefix</Label>
                  <Input
                    id="web-backup-prefix"
                    value={webBackupPrefix}
                    onChange={(event) => setWebBackupPrefix(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={
                    createWebBackupMutation.isPending ||
                    !activeOrganization?.id ||
                    !webBackupDestinationId
                  }
                  onClick={() => {
                    if (!activeOrganization?.id) return;
                    createWebBackupMutation.mutate({
                      organizationId: activeOrganization.id,
                      destinationId: webBackupDestinationId,
                      name: webBackupName.trim(),
                      cronExpression: webBackupCron.trim(),
                      timezone: "UTC",
                      prefix: webBackupPrefix.trim(),
                      enabled: true,
                    });
                  }}
                >
                  Create schedule
                </Button>
                {webBackupSchedules.map((schedule) => (
                  <div
                    key={schedule.id}
                    className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
                  >
                    <span className="font-medium">{schedule.name}</span>
                    <span className="text-muted-foreground">
                      {schedule.cronExpression}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        runWebBackupMutation.isPending ||
                        updateWebBackupMutation.isPending
                      }
                      onClick={() =>
                        runWebBackupMutation.mutate({
                          scheduleId: schedule.id,
                        })
                      }
                    >
                      Run now
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updateWebBackupMutation.isPending}
                      onClick={() => {
                        if (!activeOrganization?.id) return;
                        updateWebBackupMutation.mutate({
                          id: schedule.id,
                          organizationId: activeOrganization.id,
                          enabled: !schedule.enabled,
                        });
                      }}
                    >
                      {schedule.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deleteWebBackupMutation.isPending}
                      onClick={() =>
                        deleteWebBackupMutation.mutate({ id: schedule.id })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
              {webBackupRuns.length > 0 && (
                <div className="space-y-2 text-xs">
                  <p className="font-medium">Recent runs</p>
                  {webBackupRuns.slice(0, 10).map((run) => (
                    <div
                      key={run.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <span>
                        {run.status} · {run.createdAt.toLocaleString()}
                      </span>
                      {run.status === "succeeded" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={restoreWebBackupMutation.isPending}
                          onClick={() => {
                            setRestoreRunIdToConfirm(run.id);
                          }}
                        >
                          Restore
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ─── WEB SERVER OPERATIONS PANEL ────────────────────────────────── */}
          <Card className="border border-border/40 bg-card/20 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-semibold text-lg">
                <ServerIcon className="size-5 text-primary" />
                Web Server Control Panel
              </CardTitle>
              <CardDescription className="text-xs">
                Reload, configure, or clean the proxy and node services.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 border-border/10 border-t">
              {/* Dropdowns Row */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {/* Server Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        className="w-full justify-between border-border/60 font-semibold"
                      >
                        Server
                        <ArrowRight className="size-4 rotate-90 opacity-60" />
                      </Button>
                    }
                  />
                  <DropdownMenuPortal>
                    <DropdownMenuContent className="w-56 bg-popover text-popover-foreground">
                      <DropdownMenuItem
                        onClick={() => reloadServerMutation.mutate()}
                      >
                        Reload (Restart Server)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setServerLogsOpen(true)}>
                        View Logs
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setTerminalOpen(true)}>
                        Open Terminal
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setGpuModalOpen(true)}>
                        GPU Setup
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setServerIpInput(info?.settings?.serverIp || "");
                          setUpdateIpDialogOpen(true);
                        }}
                      >
                        Update Server IP
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => cleanRedisMutation.mutate()}
                      >
                        Clean Redis
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          triggerCleanup(
                            "Clean Deployment Queue",
                            "This will clean all stuck deployments in the queue and mark them as failed. Continue?",
                            (input) =>
                              cleanAllDeploymentQueueMutation.mutate(input),
                            cleanAllDeploymentQueueMutation.isPending,
                          )
                        }
                      >
                        Clean all deployment queue
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => reloadRedisMutation.mutate()}
                      >
                        Reload Redis
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>

                {/* Caddy Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        className="w-full justify-between border-border/60 font-semibold"
                      >
                        Caddy
                        <ArrowRight className="size-4 rotate-90 opacity-60" />
                      </Button>
                    }
                  />
                  <DropdownMenuPortal>
                    <DropdownMenuContent className="w-56 bg-popover text-popover-foreground">
                      <DropdownMenuItem
                        onClick={() =>
                          reloadMutation.mutate({ action: "reload" })
                        }
                      >
                        Reload
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          reloadMutation.mutate({ action: "restart" })
                        }
                      >
                        Restart Container
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEnvModalOpen(true)}>
                        Modify Environment
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPortsModalOpen(true)}>
                        Additional Port Mappings
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>

                {/* Space Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        className="w-full justify-between border-border/60 font-semibold"
                      >
                        Space
                        <ArrowRight className="size-4 rotate-90 opacity-60" />
                      </Button>
                    }
                  />
                  <DropdownMenuPortal>
                    <DropdownMenuContent className="w-56 bg-popover text-popover-foreground">
                      <DropdownMenuItem
                        onClick={() =>
                          triggerCleanup(
                            "Clean Unused Images",
                            "This will prune all unused Docker images on the host. Continue?",
                            (input) => cleanUnusedImagesMutation.mutate(input),
                            cleanUnusedImagesMutation.isPending,
                          )
                        }
                      >
                        Clean unused images
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          triggerCleanup(
                            "Clean Unused Volumes",
                            "This will remove unused Docker volumes on the host. Continue?",
                            (input) => cleanUnusedVolumesMutation.mutate(input),
                            cleanUnusedVolumesMutation.isPending,
                          )
                        }
                      >
                        Clean unused volumes
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          triggerCleanup(
                            "Clean Stopped Containers",
                            "This will remove all stopped Docker containers on the host. Continue?",
                            (input) =>
                              cleanStoppedContainersMutation.mutate(input),
                            cleanStoppedContainersMutation.isPending,
                          )
                        }
                      >
                        Clean stopped containers
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          triggerCleanup(
                            "Clean Docker Builder Cache",
                            "This will clear the Docker build cache on the host. Continue?",
                            (input) => cleanDockerBuilderMutation.mutate(input),
                            cleanDockerBuilderMutation.isPending,
                          )
                        }
                      >
                        Clean Docker Builder
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          triggerCleanup(
                            "Clean Docker System",
                            "This will run docker system prune on the host. Continue?",
                            (input) => cleanDockerPruneMutation.mutate(input),
                            cleanDockerPruneMutation.isPending,
                          )
                        }
                      >
                        Clean Docker System
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          triggerCleanup(
                            "Clean All Docker Resources",
                            "This is destructive and will prune unused images, volumes, build cache, and containers. Continue?",
                            (input) => cleanAllMutation.mutate(input),
                            cleanAllMutation.isPending,
                          )
                        }
                      >
                        Clean all
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>

                {/* Check for updates Button */}
                <Button
                  variant="outline"
                  className="w-full justify-center border-border/60 font-semibold"
                  onClick={handleCheckUpdates}
                  disabled={checkUpdatesMutation.isPending}
                >
                  {checkUpdatesMutation.isPending && (
                    <Spinner data-icon="inline-start" />
                  )}
                  {checkUpdatesMutation.isPending
                    ? "Checking…"
                    : "Check for updates"}
                </Button>
              </div>

              {/* Status footer information */}
              <div className="flex flex-col gap-4 border-border/10 border-t pt-4 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <span>Server IP:</span>
                    <span className="font-mono text-foreground">
                      {info?.settings?.serverIp || "Detecting..."}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 hover:bg-muted/20"
                      onClick={() => {
                        void copyText(info?.settings?.serverIp || "")
                          .then(() => toast.success("IP copied to clipboard"))
                          .catch(() => toast.error("Failed to copy IP"));
                      }}
                      disabled={!info?.settings?.serverIp}
                      aria-label="Copy server IP"
                    >
                      <Copy className="size-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>Version:</span>
                    <span className="font-semibold text-foreground">
                      {updateData?.currentVersion || "Loading…"}
                    </span>
                    {updateData?.updateAvailable &&
                      updateData.canUpdate &&
                      updateData.images && (
                        <Button
                          size="xs"
                          variant="default"
                          className="cursor-pointer bg-indigo-600 font-semibold text-[10px] text-white hover:bg-indigo-700"
                          onClick={() => {
                            const images = updateData.images;
                            if (!images) return;
                            setUpdateConfirmOpen(true);
                          }}
                          disabled={triggerUpdateMutation.isPending}
                        >
                          {triggerUpdateMutation.isPending
                            ? "Updating..."
                            : `Update to ${updateData.latestVersion}`}
                        </Button>
                      )}
                    {updateData?.channel && (
                      <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                        {updateData.channel}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor="daily-cleanup"
                      className="cursor-pointer text-xs"
                    >
                      Daily Docker Cleanup
                    </Label>
                    <Switch
                      id="daily-cleanup"
                      checked={info?.settings?.dailyDockerCleanup || false}
                      onCheckedChange={handleToggleDailyCleanup}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Uptime and stats */}
            <div className="space-y-6 lg:col-span-1">
              <Card className="border border-border/40 bg-card/20 shadow-sm">
                <CardHeader>
                  <CardTitle className="font-semibold text-lg">
                    Server Status
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Real-time status of the proxy container
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 border-border/10 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">
                      Container State
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          info?.status?.running
                            ? "animate-pulse bg-success"
                            : "bg-destructive"
                        }`}
                      />
                      <span className="font-semibold text-foreground text-sm capitalize">
                        {info?.status?.status || "Unknown"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">
                      Uptime
                    </span>
                    <span className="font-mono text-foreground text-sm">
                      {info?.status?.uptime || "N/A"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">
                      Active Port Mappings
                    </span>
                    <div className="flex flex-col items-end gap-0.5">
                      {info?.status?.ports && info.status.ports.length > 0 ? (
                        info.status.ports.map((port: string, idx: number) => (
                          <span
                            key={idx}
                            className="font-mono text-muted-foreground text-xs"
                          >
                            {port}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          None
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">
                      Connected Domains
                    </span>
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-bold text-primary text-xs">
                      {info?.status?.activeDomainsCount || 0}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* General Configurations & Custom Caddyfile */}
            <div className="space-y-6 lg:col-span-2">
              <form
                onSubmit={handleSaveSettings}
                onFocusCapture={() => setEditingSettings(true)}
              >
                <Card className="border border-border/40 bg-card/20 shadow-sm">
                  <CardHeader>
                    <CardTitle className="font-semibold text-lg">
                      General Settings
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Configure port bindings and automatic SSL generation
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 border-border/10 border-t">
                    {/* Let's Encrypt Email */}
                    <div className="space-y-2">
                      <Label htmlFor="lets-encrypt-email" className="text-xs">
                        ACME Email Address (Optional for Let&apos;s Encrypt)
                      </Label>
                      <Input
                        id="lets-encrypt-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="e.g. ssl-admin@yourdomain.com (optional)"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Optional for Let&apos;s Encrypt (expiration emails ended
                        June 4, 2025). Used for ACME registration and ZeroSSL
                        notifications.
                      </p>
                    </div>

                    {/* Cloudflare API Token */}
                    <div className="space-y-2">
                      <Label htmlFor="cloudflare-api-token" className="text-xs">
                        Cloudflare API Token (for Wildcard DNS-01 SSL)
                      </Label>
                      <Input
                        id="cloudflare-api-token"
                        type="password"
                        value={cloudflareApiToken}
                        onChange={(e) => setCloudflareApiToken(e.target.value)}
                        placeholder="e.g. your-cloudflare-api-token"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Used by Caddy to perform DNS-01 ACME challenges for
                        wildcard domains (*.example.com).
                      </p>
                    </div>

                    {/* Ports configurations */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="http-port" className="text-xs">
                          Caddy HTTP listener
                        </Label>
                        <Input
                          id="http-port"
                          type="number"
                          min={1}
                          max={65535}
                          value={httpPort}
                          onChange={(e) =>
                            setHttpPort(Number(e.target.value) || 80)
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="https-port" className="text-xs">
                          Caddy HTTPS listener
                        </Label>
                        <Input
                          id="https-port"
                          type="number"
                          min={1}
                          max={65535}
                          value={httpsPort}
                          onChange={(e) =>
                            setHttpsPort(Number(e.target.value) || 443)
                          }
                        />
                      </div>
                    </div>

                    {/* HTTP/3 Toggle */}
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="font-semibold text-foreground text-xs">
                          Enable HTTP/3 (QUIC)
                        </Label>
                        <p className="text-[11px] text-muted-foreground">
                          Enables UDP port bindings and protocol handshakes for
                          modern web performance.
                        </p>
                      </div>
                      <Checkbox
                        checked={enableHttp3}
                        onCheckedChange={(val) => setEnableHttp3(Boolean(val))}
                      />
                    </div>

                    {/* Custom Global Options Overrides */}
                    <div className="space-y-2">
                      <Label
                        htmlFor="global-caddyfile-overrides"
                        className="text-xs"
                      >
                        Custom Global Caddyfile Options (User Overrides)
                      </Label>
                      <CodeSurface>
                        <CodeEditor
                          id="global-caddyfile-overrides"
                          height="132px"
                          language="caddy"
                          allowLanguageChange={false}
                          value={globalCaddyfile}
                          onChange={setGlobalCaddyfile}
                          aria-label="Custom global Caddyfile options"
                        />
                      </CodeSurface>
                      <p className="text-[11px] text-muted-foreground">
                        This block is injected directly into Caddy's global
                        option block <code>{"{ ... }"}</code>.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="caddy-snippets" className="text-xs">
                        Reusable Caddy route snippets
                      </Label>
                      <CodeSurface>
                        <CodeEditor
                          id="caddy-snippets"
                          height="190px"
                          language="caddy"
                          allowLanguageChange={false}
                          value={caddySnippets}
                          onChange={setCaddySnippets}
                          aria-label="Reusable Caddy route snippets"
                        />
                      </CodeSurface>
                      <p className="text-[11px] text-muted-foreground">
                        Define named Caddy snippets here, then reference their
                        names from a resource domain. The generated Caddyfile is
                        validated before it is loaded.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <Label className="font-semibold text-xs">
                            Managed Caddy middlewares
                          </Label>
                          <p className="text-[11px] text-muted-foreground">
                            Define named, reusable route middleware without
                            editing generated files. Reference names from a
                            resource domain mapping.
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setCaddyMiddlewares((current) => [
                              ...current,
                              {
                                name: "security-headers",
                                body: "header -Server",
                              },
                            ])
                          }
                        >
                          <PlusIcon data-icon="inline-start" />
                          Add middleware
                        </Button>
                      </div>
                      {caddyMiddlewares.length === 0 ? (
                        <p className="rounded border border-dashed p-3 text-muted-foreground text-xs">
                          No managed middlewares configured.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {caddyMiddlewares.map((middleware, index) => (
                            <div
                              className="grid gap-2 rounded border border-border/20 p-3 md:grid-cols-[minmax(0,180px)_1fr_auto]"
                              key={`${middleware.name}-${index}`}
                            >
                              <Input
                                value={middleware.name}
                                placeholder="middleware-name"
                                aria-label="Caddy middleware name"
                                onChange={(event) =>
                                  setCaddyMiddlewares((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, name: event.target.value }
                                        : item,
                                    ),
                                  )
                                }
                              />
                              <CodeSurface>
                                <CodeEditor
                                  height="100px"
                                  language="caddy"
                                  value={middleware.body}
                                  onChange={(body) =>
                                    setCaddyMiddlewares((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, body }
                                          : item,
                                      ),
                                    )
                                  }
                                  aria-label={`Caddy middleware ${middleware.name}`}
                                />
                              </CodeSurface>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Remove middleware ${middleware.name}`}
                                onClick={() =>
                                  setCaddyMiddlewares((current) =>
                                    current.filter(
                                      (_, itemIndex) => itemIndex !== index,
                                    ),
                                  )
                                }
                              >
                                <Trash2Icon />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Save button */}
                    <div className="flex justify-end pt-2">
                      <Button
                        type="submit"
                        disabled={isSaving}
                        className="gap-2 font-medium"
                      >
                        {isSaving && <Spinner className="size-4" />}
                        Save Configuration
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </form>

              {/* HTTPS & certificates */}
              <Card className="border border-border/40 bg-card/20 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 font-semibold text-lg">
                    <ShieldCheck className="size-5 text-primary" />
                    HTTPS &amp; Certificates
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Caddy provisions and renews Let&apos;s Encrypt certificates
                    for every HTTPS domain route.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 border-t pt-4 sm:grid-cols-3">
                  <div className="rounded-lg border border-border/30 bg-muted/20 p-3">
                    <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      Issuer
                    </p>
                    <p className="mt-1 font-semibold text-sm">
                      Let&apos;s Encrypt ACME
                    </p>
                    <p className="mt-1 text-muted-foreground text-xs">
                      Automatic renewal is handled by Caddy.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/30 bg-muted/20 p-3">
                    <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      Configured email
                    </p>
                    <p className="mt-1 truncate font-semibold text-sm">
                      {email || "Not configured"}
                    </p>
                    <p className="mt-1 text-muted-foreground text-xs">
                      Used for ACME expiry notifications.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/30 bg-muted/20 p-3">
                    <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      Active HTTPS routes
                    </p>
                    <p className="mt-1 font-semibold text-sm tabular-nums">
                      {info?.status?.activeDomainsCount || 0}
                    </p>
                    <p className="mt-1 text-muted-foreground text-xs">
                      Domains are managed from each resource&apos;s Domains tab.
                    </p>
                  </div>
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-muted-foreground text-xs sm:col-span-3">
                    DNS for each hostname must resolve to this server and TCP
                    ports 80 and 443 must be reachable. Use the Caddyfile editor
                    below for advanced ACME settings such as a staging CA or
                    internal certificates.
                  </div>
                </CardContent>
              </Card>

              {/* Compiled Caddyfile Preview Card */}
              <Card className="border border-border/40 bg-card/20 shadow-sm">
                <CardHeader>
                  <CardTitle className="font-semibold text-lg">
                    Main Caddyfile
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Active read-only main config file compiled on the host
                  </CardDescription>
                </CardHeader>
                <CardContent className="border-border/10 border-t pt-4">
                  <CodeSurface>
                    <CodeEditor
                      height="360px"
                      language="caddy"
                      allowLanguageChange={false}
                      value={
                        info?.status?.mainCaddyfile || "# No Caddyfile found."
                      }
                      mode="view"
                      aria-label="Compiled Caddyfile preview"
                    />
                  </CodeSurface>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ─── LIVE CONTAINER LOGS (Caddy) ────────────────────────────────── */}
          <Card className="border border-border/40 bg-card/20 shadow-sm">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="font-semibold text-lg">
                  Live Access & Process Logs
                </CardTitle>
                <CardDescription className="text-xs">
                  Tail standard output from the <code>upstand-caddy</code>{" "}
                  container
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Checkbox
                    id="auto-refresh-logs"
                    checked={autoRefreshCaddyLogs}
                    onCheckedChange={(val) =>
                      setAutoRefreshCaddyLogs(Boolean(val))
                    }
                  />
                  <Label
                    htmlFor="auto-refresh-logs"
                    className="cursor-pointer text-xs"
                  >
                    Auto-refresh (5s)
                  </Label>
                </div>

                <Select
                  items={[
                    { value: "50", label: "Last 50 lines" },
                    { value: "100", label: "Last 100 lines" },
                    { value: "200", label: "Last 200 lines" },
                    { value: "500", label: "Last 500 lines" },
                  ]}
                  value={String(caddyLogsTail)}
                  onValueChange={(val) => {
                    setCaddyLogsTail(Number(val));
                    setTimeout(() => refetchCaddyLogs(), 50);
                  }}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="50">Last 50 lines</SelectItem>
                      <SelectItem value="100">Last 100 lines</SelectItem>
                      <SelectItem value="200">Last 200 lines</SelectItem>
                      <SelectItem value="500">Last 500 lines</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="border-border/10 border-t pt-4">
              {loadingCaddyLogs && !caddyLogs ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Spinner className="mr-2 size-4" /> Loading log stream...
                </div>
              ) : (
                <ShowDockerLogs
                  containerId="caddy"
                  logs={caddyLogs?.split("\n") ?? []}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── SERVER LOGS DIALOG ─────────────────────────────────────────── */}
      <Dialog open={serverLogsOpen} onOpenChange={setServerLogsOpen}>
        <DialogContent className="max-h-[90svh] w-[calc(100vw-1rem)] max-w-[min(96vw,64rem)] overflow-y-auto sm:min-w-[min(42rem,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Upstand Server Logs</DialogTitle>
            <DialogDescription>
              Tailing stdout from Upstand backend process.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            {loadingServerLogs && !serverLogs ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Spinner className="mr-2 size-4" /> Loading log stream...
              </div>
            ) : (
              <ShowDockerLogs
                containerId="upstand-server"
                logs={serverLogs?.split("\n") ?? []}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── GPU SUPPORT DIALOG ─────────────────────────────────────────── */}
      <Dialog open={gpuModalOpen} onOpenChange={setGpuModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>GPU Support Setup</DialogTitle>
            <DialogDescription>
              Detect and configure NVIDIA GPU runtime resources in Docker Swarm.
            </DialogDescription>
          </DialogHeader>
          {loadingGpu ? (
            <div className="flex justify-center py-8">
              <Spinner className="size-6" />
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    NVIDIA Driver Status:
                  </span>
                  <Badge
                    variant={
                      gpuStatus?.driverInstalled ? "default" : "destructive"
                    }
                  >
                    {gpuStatus?.driverInstalled ? "Installed" : "Not Installed"}
                  </Badge>
                </div>
                {gpuStatus?.driverVersion && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Driver Version:
                    </span>
                    <span className="font-mono text-xs">
                      {gpuStatus.driverVersion}
                    </span>
                  </div>
                )}
                {gpuStatus?.gpuModel && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Model:</span>
                    <span className="font-semibold text-xs">
                      {gpuStatus.gpuModel}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">CUDA Support:</span>
                  <Badge
                    variant={gpuStatus?.cudaSupport ? "default" : "outline"}
                  >
                    {gpuStatus?.cudaSupport ? "Yes" : "No"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    NVIDIA Runtime Configured:
                  </span>
                  <Badge
                    variant={
                      gpuStatus?.runtimeConfigured ? "default" : "destructive"
                    }
                  >
                    {gpuStatus?.runtimeConfigured
                      ? "Configured"
                      : "Not Configured"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Generic GPU Resources:
                  </span>
                  <span className="font-semibold">
                    {gpuStatus?.gpuResources || 0}
                  </span>
                </div>
              </div>

              {!gpuStatus?.runtimeConfigured && gpuStatus?.driverInstalled && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-warning text-xs">
                  NVIDIA drivers were found, but Docker nvidia-runtime is not
                  active. Click the configure button below to setup
                  `/etc/docker/daemon.json`.
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGpuModalOpen(false)}>
              Close
            </Button>
            <Button
              disabled={
                setupGpuMutation.isPending || !gpuStatus?.driverInstalled
              }
              onClick={() => setupGpuMutation.mutate()}
            >
              {setupGpuMutation.isPending
                ? "Configuring..."
                : "Configure GPU Support"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODIFY ENVIRONMENT DIALOG ──────────────────────────────────── */}
      <Dialog open={envModalOpen} onOpenChange={setEnvModalOpen}>
        <DialogContent className="max-h-[85svh] w-[calc(100vw-1rem)] max-w-[min(96vw,48rem)] overflow-y-auto sm:min-w-[36rem]">
          <DialogHeader>
            <DialogTitle>Modify Environment Variables</DialogTitle>
            <DialogDescription>
              Configure global environment variables for the Caddy container.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <KeyValueEditor
              value={envVars}
              onChange={setEnvVars}
              keyLabel="Variable name"
              valuePlaceholder="value"
              addLabel="Add variable"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEnvModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEnv} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save & Recreate Container"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── ADDITIONAL PORTS DIALOG ────────────────────────────────────── */}
      <Dialog open={portsModalOpen} onOpenChange={setPortsModalOpen}>
        <DialogContent className="max-h-[85svh] w-[calc(100vw-1rem)] max-w-[min(96vw,48rem)] overflow-y-auto sm:min-w-[36rem]">
          <DialogHeader>
            <DialogTitle>Additional Port Mappings</DialogTitle>
            <DialogDescription>
              Configure additional ports to bind on the host interface for Caddy
              container.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-xs"
                onClick={handleAddPort}
              >
                <PlusIcon className="size-3.5" />
                Add Mapping
              </Button>
            </div>
            {portMappings.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-xs">
                No custom port mappings configured.
              </div>
            ) : (
              <div className="space-y-2">
                {portMappings.map((port, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="w-1/3">
                      <Label className="text-[10px] text-muted-foreground">
                        Target Port
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        max={65535}
                        placeholder="8080"
                        value={port.targetPort}
                        onChange={(e) =>
                          handleUpdatePort(
                            idx,
                            "targetPort",
                            Number(e.target.value) || 0,
                          )
                        }
                        className="text-xs"
                      />
                    </div>
                    <span className="pt-4 text-muted-foreground">:</span>
                    <div className="w-1/3">
                      <Label className="text-[10px] text-muted-foreground">
                        Published Port
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        max={65535}
                        placeholder="8080"
                        value={port.publishedPort}
                        onChange={(e) =>
                          handleUpdatePort(
                            idx,
                            "publishedPort",
                            Number(e.target.value) || 0,
                          )
                        }
                        className="text-xs"
                      />
                    </div>
                    <div className="w-1/4">
                      <Label className="text-[10px] text-muted-foreground">
                        Protocol
                      </Label>
                      <Select
                        items={[
                          { value: "tcp", label: "TCP" },
                          { value: "udp", label: "UDP" },
                        ]}
                        value={port.protocol}
                        onValueChange={(val) =>
                          handleUpdatePort(
                            idx,
                            "protocol",
                            val === "udp" ? "udp" : "tcp",
                          )
                        }
                      >
                        <SelectTrigger className="text-xs">
                          <SelectValue placeholder="Protocol" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tcp">TCP</SelectItem>
                          <SelectItem value="udp">UDP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemovePort(idx)}
                      className="mt-4 size-9 shrink-0 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPortsModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePorts} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save & Recreate Container"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <WebServerTerminalDialog
        open={terminalOpen}
        onOpenChange={setTerminalOpen}
      />
      {updateDialogVersion ? (
        <SelfUpdateDialog open version={updateDialogVersion} />
      ) : null}

      <ConfirmActionDialog
        open={Boolean(restoreRunIdToConfirm)}
        onOpenChange={(open) => !open && setRestoreRunIdToConfirm(null)}
        title="Restore Web Server Backup?"
        description="This replaces the control-plane database and Caddy configuration volumes with the selected backup state."
        actionLabel="Restore Backup"
        pending={restoreWebBackupMutation.isPending}
        onConfirm={() => {
          if (restoreRunIdToConfirm) {
            restoreWebBackupMutation.mutate(
              {
                runId: restoreRunIdToConfirm,
                confirm: "RESTORE_WEB_SERVER",
              },
              {
                onSuccess: () => setRestoreRunIdToConfirm(null),
              },
            );
          }
        }}
      />

      <ConfirmActionDialog
        open={updateConfirmOpen}
        onOpenChange={setUpdateConfirmOpen}
        title="Update Upstand Server?"
        description={`Are you sure you want to update Upstand to ${updateData?.latestVersion}? This will pull the latest version and update all services in the cluster.`}
        actionLabel="Update Server"
        pending={triggerUpdateMutation.isPending}
        onConfirm={() => {
          if (updateData?.images && updateData?.latestVersion) {
            triggerUpdateMutation.mutate(
              {
                version: updateData.latestVersion,
                images: updateData.images,
              },
              {
                onSuccess: () => setUpdateConfirmOpen(false),
              },
            );
          }
        }}
      />
      <ConfirmActionDialog
        open={Boolean(cleanupAction)}
        onOpenChange={(open) => !open && setCleanupAction(null)}
        title={cleanupAction?.title || "Docker Cleanup"}
        description={
          <div className="space-y-3">
            <p>
              {cleanupAction?.description ||
                "This action is destructive. Continue?"}
            </p>
            <div className="space-y-2 rounded-md border border-border/40 bg-muted/20 p-3 text-xs">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={preserveRollbackImages}
                  onCheckedChange={(value) =>
                    setPreserveRollbackImages(Boolean(value))
                  }
                />
                Preserve images marked for rollback
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={pruneNetworks}
                  onCheckedChange={(value) => setPruneNetworks(Boolean(value))}
                />
                Also prune unused Docker networks (all cleanup only)
              </label>
            </div>
          </div>
        }
        actionLabel="Run Cleanup"
        pending={cleanupAction?.pending ?? false}
        onConfirm={() => {
          if (cleanupAction && activeOrganization?.id) {
            cleanupAction.action({
              organizationId: activeOrganization.id,
              confirm: "CLEANUP",
              preserveRollbackImages,
              pruneNetworks,
            });
            setCleanupAction(null);
          }
        }}
      />

      <Dialog open={updateIpDialogOpen} onOpenChange={setUpdateIpDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update Server IP</DialogTitle>
            <DialogDescription>
              Enter Server IP Address (leave empty to auto-detect).
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="server-ip-input" className="sr-only">
              Server IP Address
            </Label>
            <Input
              id="server-ip-input"
              value={serverIpInput}
              onChange={(e) => setServerIpInput(e.target.value)}
              placeholder="e.g. 192.168.1.1 or leave empty"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const ip = serverIpInput.trim();
                  updateServerIpMutation.mutate(ip ? { ip } : {});
                  setUpdateIpDialogOpen(false);
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUpdateIpDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const ip = serverIpInput.trim();
                updateServerIpMutation.mutate(ip ? { ip } : {});
                setUpdateIpDialogOpen(false);
              }}
            >
              Save IP Address
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardPage>
  );
}
