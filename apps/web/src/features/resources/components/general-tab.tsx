"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ApplicationBuildConfig,
  ApplicationBuildConfigSchema,
  DATABASE_IMAGE_OPTIONS,
  type DatabaseType,
  parseResourceAdvancedConfig,
  type ResourceComposeType,
} from "@upstand/domain";
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
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@upstand/ui/components/field";
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
import { Switch } from "@upstand/ui/components/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@upstand/ui/components/tooltip";
import { cn } from "@upstand/ui/lib/utils";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import { DangerZoneCard } from "@/components/dashboard/danger-zone-card";
import {
  Code,
  Copy,
  Globe,
  Play,
  RefreshCw,
  Square,
  Upload,
} from "@/components/huge-icons";
import { CodeEditor, CodeSurface } from "@/components/shared/code-editor";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { useSystemConfig } from "@/hooks/use-system-config";
import { uploadArchive, validateArchiveFile } from "@/lib/archive-upload";
import { copyText } from "@/lib/browser";
import { getServerApiUrl, getServerUrl } from "@/lib/server-url";
import { trpc } from "@/utils/trpc";
import type { ResourceDetailState } from "../hooks/use-resource-detail";
import { extractPortsAndVolumesFromServices } from "../utils/compose-parser";
import type { ResourceRuntimeStatus } from "../utils/resource-status";
import { ConfigureRollbackDialog } from "./configure-rollback-dialog";
import {
  createBuildConfig,
  type DatabaseCredentials,
  parseApplicationBuildConfig,
  parseResourceCredentials,
  RAILPACK_VERSIONS,
  type ResourceProvider,
  toStringRecord,
} from "./general-tab.helpers";

interface GeneralTabProps {
  resource: NonNullable<ResourceDetailState["resource"]>;
  secrets: ResourceDetailState["secrets"];
  refetchSecrets: ResourceDetailState["refetchSecrets"];
  deployments: ResourceDetailState["deployments"];
  sshKeys: ResourceDetailState["sshKeys"];
  servers: ResourceDetailState["servers"];
  gitProviders: ResourceDetailState["gitProviders"];
  updateResource: ResourceDetailState["updateResource"];
  isUpdatingResource: boolean;
  deployResource: ResourceDetailState["deployResource"];
  isDeployingResource: boolean;
  controlResource: ResourceDetailState["controlResource"];
  isControllingResource: boolean;
  rebuildDatabase: ResourceDetailState["rebuildDatabase"];
  isRebuildingDatabase: boolean;
  deleteResource: ResourceDetailState["deleteResource"];
  isDeletingResource: boolean;
  runtimeStatus?: ResourceRuntimeStatus;
}

type ResourceUpdateInput = Parameters<ResourceDetailState["updateResource"]>[0];

function isResourceProvider(value: string): value is ResourceProvider {
  return [
    "docker",
    "github",
    "gitlab",
    "bitbucket",
    "gitea",
    "git",
    "raw",
    "drop",
  ].includes(value);
}

export function GeneralTab({
  resource,
  secrets,
  refetchSecrets,
  deployments,
  sshKeys,
  servers,
  gitProviders,
  updateResource,
  isUpdatingResource,
  deployResource,
  isDeployingResource,
  controlResource,
  isControllingResource,
  rebuildDatabase,
  isRebuildingDatabase,
  deleteResource,
  isDeletingResource,
  runtimeStatus,
}: GeneralTabProps) {
  const queryClient = useQueryClient();
  const organizationState = useRequiredActiveOrganization();
  const { isCloud } = useSystemConfig();
  const activeOrganization =
    organizationState.status === "ready"
      ? organizationState.organization
      : null;
  const dockerRegistriesQuery = useQuery({
    ...trpc.dockerRegistry.list.queryOptions({
      organizationId: organizationState.organizationId as string,
    }),
    enabled:
      resource.type === "application" && organizationState.status === "ready",
  });
  const previewsQuery = useQuery({
    ...trpc.resource.getPreviews.queryOptions({ id: resource.id }),
    enabled: resource.type === "application",
    refetchInterval: 5000,
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteVolumes, setDeleteVolumes] = useState(false);
  const [rebuildDialogOpen, setRebuildDialogOpen] = useState(false);

  useEffect(() => {
    if (!deleteDialogOpen) {
      setDeleteVolumes(false);
    }
  }, [deleteDialogOpen]);
  const webhookBaseUrl = getServerUrl();
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const rotateWebhookToken = useMutation({
    ...trpc.resource.rotateWebhookToken.mutationOptions(),
    onSuccess: (result) => {
      setWebhookToken(result.token);
      toast.success(
        "Webhook token rotated. Copy it now; it will not be shown again.",
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const randomizeCompose = useMutation({
    ...trpc.resource.randomizeCompose.mutationOptions(),
    onSuccess: () => {
      void refetchSecrets();
      toast.success("Compose service and named-resource identities randomized");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateApplication = useMutation({
    ...trpc.application.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Application provider configuration saved successfully");
    },
    onError: (error) => toast.error(error.message),
  });
  const databaseCommand = useMutation({
    ...trpc.resource.databaseCommand.mutationOptions(),
    onSuccess: (result) => {
      setDatabaseCommandOutput(
        `${result.command}: ${result.output || "(no output)"}`,
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const inspectCompose = useMutation({
    ...trpc.compose.inspect.mutationOptions(),
    onSuccess: (result) => {
      setComposeInspection(result);
      toast.success(
        `Found ${result.services.length} Compose service${result.services.length === 1 ? "" : "s"}`,
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const convertCompose = useMutation({
    ...trpc.compose.convert.mutationOptions(),
    onSuccess: (result) => {
      setRawComposeFile(result.composeFile);
      setComposeType(result.target);
      toast.success(
        `Compose file converted to ${result.target === "stack" ? "Docker Stack" : "Docker Compose"}`,
      );
    },
    onError: (error) => toast.error(error.message),
  });

  // General Rename State
  const [nameInput, setNameInput] = useState("");
  const [appNameInput, setAppNameInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");

  // Build Configuration State
  const [buildConfig, setBuildConfig] = useState<ApplicationBuildConfig>(() =>
    parseApplicationBuildConfig(resource.buildConfig),
  );
  const [previewActive, setPreviewActive] = useState(false);
  const [previewLimit, setPreviewLimit] = useState("3");
  const [previewWildcard, setPreviewWildcard] = useState("");
  const [previewHttps, setPreviewHttps] = useState(false);
  const [previewPort, setPreviewPort] = useState("3000");
  const [deploymentServerId, setDeploymentServerId] = useState("default");
  const [buildServerId, setBuildServerId] = useState("default");

  // Provider State
  const [providerType, setProviderType] = useState<ResourceProvider>("github");
  const [autoDeploy, setAutoDeploy] = useState(true);

  // Specific Provider States
  const [tagPattern, setTagPattern] = useState("");
  const [githubAccount, setGithubAccount] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubBranch, setGithubBranch] = useState("");
  const [githubComposePath, setGithubComposePath] = useState(
    "./docker-compose.yml",
  );
  const [githubTriggerType, setGithubTriggerType] = useState("On Push");
  const [githubWatchPaths, setGithubWatchPaths] = useState<string[]>([]);
  const [githubSubmodules, setGithubSubmodules] = useState(false);

  const [gitUrl, setGitUrl] = useState("");
  const [gitSshKeyId, setGitSshKeyId] = useState("");
  const [gitBranch, setGitBranch] = useState("master");
  const [gitComposePath, setGitComposePath] = useState("./docker-compose.yml");
  const [gitTriggerType, setGitTriggerType] = useState("push");
  const [gitWatchPaths, setGitWatchPaths] = useState<string[]>([]);
  const [gitSubmodules, setGitSubmodules] = useState(false);

  const [rawComposeFile, setRawComposeFile] = useState("");
  const [dockerImage, setDockerImage] = useState("");
  const [useCustomDatabaseImage, setUseCustomDatabaseImage] = useState(false);
  const [customDatabaseImage, setCustomDatabaseImage] = useState("");
  const [dockerRegistryId, setDockerRegistryId] = useState("");
  const [buildRegistryId, setBuildRegistryId] = useState("");
  const [rollbackActive, setRollbackActive] = useState(false);
  const [rollbackRegistryId, setRollbackRegistryId] = useState("");
  const [configureRollbackDialogOpen, setConfigureRollbackDialogOpen] =
    useState(false);
  const [dockerBuildSecretsJson, setDockerBuildSecretsJson] = useState("");
  const [databaseType, setDatabaseType] = useState<DatabaseType>("postgres");
  const [databaseExternalPort, setDatabaseExternalPort] = useState("");
  const [databaseLibsqlGrpcPort, setDatabaseLibsqlGrpcPort] = useState("");
  const [databaseLibsqlAdminPort, setDatabaseLibsqlAdminPort] = useState("");
  const [databaseCredentials, setDatabaseCredentials] =
    useState<DatabaseCredentials>({});
  const [databaseCommandOutput, setDatabaseCommandOutput] = useState("");
  const [composeType, setComposeType] = useState<ResourceComposeType>("stack");
  const [composeInspection, setComposeInspection] = useState<{
    services: Array<{
      name: string;
      image: string | null;
      replicas: number;
      ports: string[];
      dependsOn: string[];
    }>;
    warnings: string[];
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  void isUploading;
  const archiveFileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadDropFile = async (file: File) => {
    const fileError = validateArchiveFile(file, {
      extensions: [".zip", ".tar", ".gz", ".tgz"],
    });
    if (fileError) {
      toast.error(fileError);
      return;
    }

    setIsUploading(true);
    const toastId = toast.loading(
      "Uploading and extracting project archive...",
    );
    try {
      await uploadArchive({
        url: getServerApiUrl(`/api/resources/${resource.id}/upload`),
        file,
      });

      toast.success("Archive uploaded and deployment triggered!", {
        id: toastId,
      });
      void queryClient.invalidateQueries({
        queryKey: trpc.resource.get.queryKey({ id: resource.id }),
      });
      void queryClient.invalidateQueries({
        queryKey: trpc.deployment.getByResource.queryKey({
          resourceId: resource.id,
        }),
      });
    } catch (err: unknown) {
      toast.error(
        `Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        { id: toastId },
      );
    } finally {
      setIsUploading(false);
    }
  };

  const isRunning =
    runtimeStatus === "unknown"
      ? resource.status === "running"
      : (runtimeStatus ?? resource.status) === "running";
  const isBuilding = deployments.some(
    (deployment) => deployment.status === "running",
  );

  // Deployment polling updates status, logs, and container snapshots every few
  // seconds. Those changes must not re-hydrate the editable form and destroy a
  // draft. Only fields represented by this tab participate in hydration.
  const resourceFormVersion = JSON.stringify({
    id: resource.id,
    name: resource.name,
    appName: resource.appName,
    description: resource.description,
    buildConfig: resource.buildConfig,
    preview: [
      resource.isPreviewDeploymentsActive,
      resource.previewLimit,
      resource.previewWildcard,
      resource.previewHttps,
      resource.previewPort,
    ],
    server: [
      resource.serverId,
      resource.buildServerId,
      resource.buildRegistryId,
    ],
    provider: resource.provider,
    db: [
      resource.dbType,
      resource.dockerImage,
      resource.externalPort,
      resource.libsqlGrpcPort,
      resource.libsqlAdminPort,
    ],
    composeType: resource.composeType,
    credentials: secrets.credentials,
    watchPaths: resource.watchPaths,
  });

  // Hydrate states when resource changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: the serialized configuration snapshot is intentionally the only dependency; deployment status and runtime snapshots must not reset drafts.
  useEffect(() => {
    if (resource) {
      setNameInput(resource.name);
      setAppNameInput(resource.appName ?? "");
      setDescriptionInput(resource.description ?? "");
      setBuildConfig(parseApplicationBuildConfig(resource.buildConfig));
      setPreviewActive(resource.isPreviewDeploymentsActive === true);
      setPreviewLimit(String(resource.previewLimit ?? 3));
      setPreviewWildcard(resource.previewWildcard ?? "");
      setPreviewHttps(resource.previewHttps === true);
      setPreviewPort(String(resource.previewPort ?? 3000));
      setDeploymentServerId(resource.serverId ?? "default");
      setBuildServerId(resource.buildServerId ?? "default");
      if (resource.provider) {
        const provider =
          resource.provider === "docker-registry"
            ? "docker"
            : resource.provider;
        if (isResourceProvider(provider)) setProviderType(provider);
      }
      if (resource.dbType && resource.dbType in DATABASE_IMAGE_OPTIONS) {
        setDatabaseType(resource.dbType as DatabaseType);
      }
      const hydratedImage =
        resource.dockerImage ??
        (resource.dbType && resource.dbType in DATABASE_IMAGE_OPTIONS
          ? DATABASE_IMAGE_OPTIONS[resource.dbType as DatabaseType][0]
          : "");
      const knownImages: readonly string[] =
        resource.dbType && resource.dbType in DATABASE_IMAGE_OPTIONS
          ? DATABASE_IMAGE_OPTIONS[resource.dbType as DatabaseType]
          : [];
      setUseCustomDatabaseImage(
        resource.type === "database" && !knownImages.includes(hydratedImage),
      );
      setCustomDatabaseImage(
        resource.type === "database" && !knownImages.includes(hydratedImage)
          ? hydratedImage
          : "",
      );
      setDockerImage(hydratedImage);
      setBuildRegistryId(resource.buildRegistryId ?? "");
      setRollbackActive(resource.rollbackActive === true);
      setRollbackRegistryId(resource.rollbackRegistryId ?? "");
      setDatabaseExternalPort(
        resource.externalPort ? String(resource.externalPort) : "",
      );
      setDatabaseLibsqlGrpcPort(
        resource.libsqlGrpcPort ? String(resource.libsqlGrpcPort) : "",
      );
      setDatabaseLibsqlAdminPort(
        resource.libsqlAdminPort ? String(resource.libsqlAdminPort) : "",
      );
      if (
        resource.composeType === "compose" ||
        resource.composeType === "stack"
      ) {
        setComposeType(resource.composeType);
      }
      const config = parseResourceCredentials(secrets.credentials);
      let typedWatchPaths: string[] = [];
      if (typeof resource.watchPaths === "string") {
        try {
          const parsed = JSON.parse(resource.watchPaths) as unknown;
          if (Array.isArray(parsed)) {
            typedWatchPaths = parsed.filter(
              (value): value is string => typeof value === "string",
            );
          }
        } catch {
          typedWatchPaths = [];
        }
      }
      if (config) {
        const provider = config.provider;
        if (
          provider &&
          [
            "docker",
            "github",
            "gitlab",
            "bitbucket",
            "gitea",
            "git",
            "raw",
            "drop",
          ].includes(provider)
        ) {
          setProviderType(provider as ResourceProvider);
        }
        setDockerRegistryId(config.registryId ?? "");
        setTagPattern(resource.tagPattern ?? "");
        setBuildRegistryId(
          resource.buildRegistryId ?? config.buildRegistryId ?? "",
        );
        setRollbackActive(
          resource.rollbackActive === true || config.rollbackActive === true,
        );
        setRollbackRegistryId(
          resource.rollbackRegistryId ?? config.rollbackRegistryId ?? "",
        );
        setAutoDeploy(config.autoDeploy !== false);
        if (
          config.provider &&
          ["github", "gitlab", "bitbucket", "gitea"].includes(config.provider)
        ) {
          setGithubAccount(config.githubAccount ?? "");
          setGithubRepo(config.repository ?? "");
          setGithubBranch(config.branch ?? "");
          setGithubComposePath(config.composePath ?? "./docker-compose.yml");
          setGithubTriggerType(
            config.triggerType
              ? config.triggerType === "tag"
                ? "On Tag"
                : "On Push"
              : resource.triggerType === "tag"
                ? "On Tag"
                : "On Push",
          );
          setGithubWatchPaths(config.watchPaths ?? typedWatchPaths);
          setGithubSubmodules(config.enableSubmodules ?? false);
        } else if (config.provider === "git") {
          setGitUrl(config.repositoryUrl ?? "");
          setGitSshKeyId(config.sshKeyId ?? "");
          setGitBranch(config.branch ?? "master");
          setGitComposePath(config.composePath ?? "./docker-compose.yml");
          setGitTriggerType(
            config.triggerType
              ? config.triggerType === "tag"
                ? "tag"
                : "push"
              : (resource.triggerType ?? "push"),
          );
          setGitWatchPaths(config.watchPaths ?? typedWatchPaths);
          setGitSubmodules(config.enableSubmodules ?? false);
        } else if (config.provider === "raw") {
          setRawComposeFile(config.composeFile ?? "");
        }
        if (resource.type === "database") {
          setDatabaseCredentials(toStringRecord(config));
        }
      }
    }
  }, [resourceFormVersion]);

  // Fetch Repositories and Branches for select provider type
  const isSupported = ["github", "gitlab", "bitbucket", "gitea"].includes(
    providerType,
  );
  const isGitReposEnabled =
    !!githubAccount &&
    isSupported &&
    (() => {
      const p = gitProviders?.find((x) => x.id === githubAccount);
      if (!p) return false;
      const config = JSON.parse(p.config);
      if (p.provider === "github") return !!config.githubInstallationId;
      if (p.provider === "gitlab" || p.provider === "gitea")
        return !!config.accessToken;
      if (p.provider === "bitbucket") return true;
      return false;
    })();

  const gitReposQuery = useQuery({
    ...trpc.gitProvider.listRepositories.queryOptions({
      gitProviderId: githubAccount,
    }),
    enabled: isGitReposEnabled,
  });

  const [repoOwner, repoName] = githubRepo.includes("/")
    ? githubRepo.split("/")
    : ["", githubRepo];

  const isGitBranchesEnabled =
    !!githubAccount &&
    isSupported &&
    !!repoOwner &&
    !!repoName &&
    (() => {
      const p = gitProviders?.find((x) => x.id === githubAccount);
      if (!p) return false;
      const config = JSON.parse(p.config);
      if (p.provider === "github") return !!config.githubInstallationId;
      if (p.provider === "gitlab" || p.provider === "gitea")
        return !!config.accessToken;
      if (p.provider === "bitbucket") return true;
      return false;
    })();

  const gitBranchesQuery = useQuery({
    ...trpc.gitProvider.listBranches.queryOptions({
      gitProviderId: githubAccount,
      owner: repoOwner,
      repo: repoName,
    }),
    enabled: isGitBranchesEnabled,
  });

  const gitRepos = gitReposQuery.data;
  const loadingRepos = gitReposQuery.isPending;
  const gitBranches = gitBranchesQuery.data;
  const loadingBranches = gitBranchesQuery.isPending;

  // Sync GitHub account dropdown when switching tabs
  useEffect(() => {
    if (
      gitProviders &&
      ["github", "gitlab", "bitbucket", "gitea"].includes(providerType)
    ) {
      const filtered = gitProviders.filter((p) => p.provider === providerType);
      const currentIsValid = filtered.some((p) => p.id === githubAccount);

      if (!currentIsValid && filtered.length > 0) {
        const activeOne = filtered.find((p) => {
          const cfg = JSON.parse(p.config);
          return p.provider === "github"
            ? !!cfg.githubInstallationId
            : p.provider === "bitbucket"
              ? true
              : !!cfg.accessToken;
        });
        setGithubAccount(activeOne?.id || filtered[0].id);
      } else if (filtered.length === 0) {
        setGithubAccount("");
      }
    }
  }, [providerType, gitProviders, githubAccount]);

  // Reset repository when account changes
  useEffect(() => {
    if (githubAccount && gitRepos && gitRepos.length > 0) {
      const exists = gitRepos.some((repo) => repo.fullName === githubRepo);
      if (!exists) {
        setGithubRepo(gitRepos[0].fullName);
      }
    }
  }, [githubAccount, gitRepos, githubRepo]);

  // Reset branch when repository changes
  useEffect(() => {
    if (githubRepo && gitBranches && gitBranches.length > 0) {
      const exists = gitBranches.includes(githubBranch);
      if (!exists) {
        setGithubBranch(gitBranches[0]);
      }
    }
  }, [githubRepo, gitBranches, githubBranch]);

  const handleSaveProvider = () => {
    let config: Record<string, unknown> = {
      provider: providerType,
      autoDeploy,
    };
    let provider: string = providerType;
    if (providerType === "docker") {
      provider = "docker-registry";
      config = {
        provider,
        autoDeploy,
        dockerImage,
        ...(dockerRegistryId ? { registryId: dockerRegistryId } : {}),
      };
    } else if (
      ["github", "gitlab", "bitbucket", "gitea"].includes(providerType)
    ) {
      config = {
        ...config,
        githubAccount,
        repository: githubRepo,
        branch: githubBranch,
        ...(resource.type === "compose"
          ? { composePath: githubComposePath }
          : {}),
        triggerType: githubTriggerType,
        watchPaths: githubWatchPaths,
        enableSubmodules: githubSubmodules,
      };
    } else if (providerType === "git") {
      config = {
        ...config,
        repositoryUrl: gitUrl,
        sshKeyId: gitSshKeyId,
        branch: gitBranch,
        ...(resource.type === "compose" ? { composePath: gitComposePath } : {}),
        triggerType: gitTriggerType,
        watchPaths: gitWatchPaths,
        enableSubmodules: gitSubmodules,
      };
    } else if (providerType === "raw") {
      config = {
        ...config,
        composeFile: rawComposeFile,
      };
    }

    const updatePayload = {
      id: resource.id,
      provider,
      ...(resource.type === "application" || resource.type === "compose"
        ? {
            triggerType:
              providerType === "docker" || providerType === "raw"
                ? ("push" as const)
                : providerType === "git"
                  ? (gitTriggerType as "push" | "tag")
                  : githubTriggerType === "On Tag"
                    ? ("tag" as const)
                    : ("push" as const),
            tagPattern:
              providerType === "git" && gitTriggerType === "tag"
                ? tagPattern.trim() || null
                : providerType !== "git" && githubTriggerType === "On Tag"
                  ? tagPattern.trim() || null
                  : null,
            watchPaths:
              providerType === "git" ? gitWatchPaths : githubWatchPaths,
          }
        : {}),
      ...(providerType === "docker" ? { dockerImage } : {}),
      ...(resource.type === "application"
        ? {
            buildRegistryId: buildRegistryId || null,
            rollbackActive,
            rollbackRegistryId: rollbackRegistryId || null,
          }
        : {}),
      ...(resource.type === "compose" ? { composeType } : {}),
      credentials: JSON.stringify(config),
    };

    if (resource.type === "application") {
      updateApplication.mutate(updatePayload);
      return;
    }

    updateResource(updatePayload, {
      onSuccess: () => {
        toast.success("Provider configuration saved successfully");
      },
    });
  };

  const updateDatabaseCredential = (key: string, value: string) => {
    setDatabaseCredentials((current) => ({ ...current, [key]: value }));
  };

  const handleSaveDatabase = () => {
    const userRequired = databaseType !== "redis";
    const databaseRequired =
      databaseType !== "redis" &&
      databaseType !== "mongodb" &&
      databaseType !== "libsql";
    const rootPasswordRequired =
      databaseType === "mysql" || databaseType === "mariadb";

    if (useCustomDatabaseImage && !customDatabaseImage.trim()) {
      toast.error("Custom database image is required");
      return;
    }

    if (userRequired && !databaseCredentials.dbUser?.trim()) {
      toast.error("Database user is required");
      return;
    }
    if (databaseType !== "redis" && !databaseCredentials.dbPassword?.trim()) {
      toast.error("Database password is required");
      return;
    }
    if (databaseRequired && !databaseCredentials.dbName?.trim()) {
      toast.error("Database name is required");
      return;
    }
    if (rootPasswordRequired && !databaseCredentials.dbRootPassword?.trim()) {
      toast.error("Root password is required");
      return;
    }

    updateResource(
      {
        id: resource.id,
        dbType: databaseType,
        dockerImage: useCustomDatabaseImage
          ? customDatabaseImage.trim()
          : dockerImage,
        allowCustomImage: useCustomDatabaseImage,
        externalPort: databaseExternalPort.trim()
          ? Number(databaseExternalPort)
          : null,
        libsqlGrpcPort:
          databaseType === "libsql" && databaseLibsqlGrpcPort.trim()
            ? Number(databaseLibsqlGrpcPort)
            : null,
        libsqlAdminPort:
          databaseType === "libsql" && databaseLibsqlAdminPort.trim()
            ? Number(databaseLibsqlAdminPort)
            : null,
        credentials: JSON.stringify(databaseCredentials),
      },
      { onSuccess: () => toast.success("Database configuration saved") },
    );
  };

  const handleSaveCompose = () => {
    updateResource(
      { id: resource.id, composeType },
      { onSuccess: () => toast.success("Compose deployment mode saved") },
    );
  };

  const triggerStatusChange = (status: "running" | "stopped") => {
    const command = status === "running" ? "start" : "stop";
    toast.info(`Sending ${command} signal to resource...`);
    controlResource({ id: resource.id, command });
  };

  const handleRename = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (nameInput.trim() && appNameInput.trim()) {
      updateResource(
        {
          id: resource.id,
          name: nameInput.trim(),
          appName: appNameInput.trim(),
          description: descriptionInput.trim(),
        },
        {
          onSuccess: () => toast.success("Resource name saved"),
        },
      );
    }
  };

  return (
    <div className="grid min-w-0 gap-6 md:grid-cols-3">
      <div className="min-w-0 space-y-6 md:col-span-2">
        {/* Deploy settings */}
        {resource.type !== "database" && (
          <Card className="border border-border/40 bg-card/20">
            <CardHeader>
              <CardTitle className="font-semibold text-lg">
                Deployment Operations
              </CardTitle>
              <CardDescription className="text-muted-foreground text-sm">
                Control pipeline states and webhook configs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 border-border/20 border-t pt-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="block font-semibold text-foreground text-sm">
                    Auto Deploy webhook triggers
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Deploy the container automatically when source code updates.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-muted-foreground text-xs">
                    {autoDeploy ? "Active" : "Disabled"}
                  </span>
                  <Checkbox
                    checked={autoDeploy}
                    onCheckedChange={(val) => {
                      const checked = Boolean(val);
                      setAutoDeploy(checked);
                      const config = {
                        ...parseResourceCredentials(secrets.credentials),
                        autoDeploy: checked,
                      };
                      updateResource(
                        {
                          id: resource.id,
                          credentials: JSON.stringify(config),
                        },
                        {
                          onSuccess: () => {
                            toast.success(
                              `Auto Deploy ${val ? "enabled" : "disabled"}`,
                            );
                          },
                        },
                      );
                    }}
                    className="size-4 cursor-pointer rounded accent-primary"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 border-border/20 border-t pt-4">
                <div>
                  <span className="block font-semibold text-foreground text-sm">
                    External webhook URL
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Use this endpoint for CI systems that cannot install a
                    provider webhook. Tokens are stored only as hashes.
                    {!webhookToken && resource.webhookTokenPrefix && (
                      <span className="mt-1 block font-medium text-warning">
                        ⚠️ Only the prefix is shown below. Rotate the token to
                        copy the full URL.
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs">
                    {webhookBaseUrl}/api/deploy/
                    {webhookToken ??
                      (resource.webhookTokenPrefix
                        ? `${resource.webhookTokenPrefix}••••••••••••`
                        : "not-configured")}
                  </code>
                  {webhookToken && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Copy webhook URL"
                      onClick={() => {
                        void copyText(
                          `${webhookBaseUrl}/api/deploy/${webhookToken}`,
                        )
                          .then(() => toast.success("Webhook URL copied"))
                          .catch(() =>
                            toast.error("Failed to copy webhook URL"),
                          );
                      }}
                    >
                      <Copy className="size-4" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      rotateWebhookToken.mutate({ id: resource.id })
                    }
                    disabled={rotateWebhookToken.isPending}
                  >
                    {rotateWebhookToken.isPending
                      ? "Rotating…"
                      : "Rotate token"}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-border/20 border-t pt-4">
                <Button
                  onClick={() => deployResource({ id: resource.id })}
                  disabled={isBuilding || isDeployingResource}
                  className="gap-2 font-medium"
                >
                  <RefreshCw
                    className={cn(
                      "size-4",
                      (isBuilding || isDeployingResource) && "animate-spin",
                    )}
                  />
                  Deploy Now
                </Button>
                <Button
                  onClick={() =>
                    triggerStatusChange(isRunning ? "stopped" : "running")
                  }
                  variant="outline"
                  disabled={isControllingResource}
                  className="gap-2 border-border/40"
                >
                  {isRunning ? (
                    <Square className="size-4 text-destructive" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  {isRunning ? "Stop Service" : "Start Service"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border border-border/40 bg-card/20">
          <CardHeader>
            <CardTitle className="font-semibold text-lg">
              Execution Infrastructure
            </CardTitle>
            <CardDescription className="text-muted-foreground text-sm">
              {resource.type === "application"
                ? "Separate the Docker deployment target from the machine that performs application builds."
                : "Select the Docker deployment target server for this resource."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 border-border/20 border-t pt-4 sm:grid-cols-2">
            <div
              className={cn(
                "space-y-2",
                resource.type !== "application" && "sm:col-span-2",
              )}
            >
              <Label htmlFor="deployment-server">Deployment server</Label>
              <Select
                items={[
                  ...(!isCloud
                    ? [{ value: "default", label: "Local Swarm manager" }]
                    : []),
                  ...servers
                    .filter((server) =>
                      resource.type === "database"
                        ? server.serverType === "deploy" ||
                          server.serverType === "database"
                        : server.serverType === "deploy",
                    )
                    .map((server) => ({
                      value: server.id,
                      label: `${server.name} (${server.ipAddress})`,
                    })),
                ]}
                value={deploymentServerId}
                onValueChange={(value) => {
                  if (value) setDeploymentServerId(value);
                }}
              >
                <SelectTrigger id="deployment-server" className="w-full">
                  <SelectValue
                    placeholder={
                      isCloud ? "Select Server" : "Use local Swarm manager"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {!isCloud && (
                    <SelectItem value="default">Local Swarm manager</SelectItem>
                  )}
                  {servers
                    .filter((server) =>
                      resource.type === "database"
                        ? server.serverType === "deploy" ||
                          server.serverType === "database"
                        : server.serverType === "deploy",
                    )
                    .map((server) => (
                      <SelectItem key={server.id} value={server.id}>
                        {server.name} ({server.ipAddress})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Remote targets require a ready server with Docker and SSH access
                configured.
              </p>
            </div>
            {resource.type === "application" && (
              <div className="space-y-2">
                <Label htmlFor="build-server">Build server</Label>
                <Select
                  items={[
                    { value: "default", label: "Same as deployment server" },
                    ...servers
                      .filter(
                        (server) =>
                          server.serverType === "build" ||
                          server.serverType === "deploy",
                      )
                      .map((server) => ({
                        value: server.id,
                        label: `${server.name} (${server.ipAddress})`,
                      })),
                  ]}
                  value={buildServerId}
                  onValueChange={(value) => {
                    if (value) setBuildServerId(value);
                  }}
                >
                  <SelectTrigger id="build-server" className="w-full">
                    <SelectValue placeholder="Build on deployment server" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">
                      Same as deployment server
                    </SelectItem>
                    {servers
                      .filter(
                        (server) =>
                          server.serverType === "build" ||
                          server.serverType === "deploy",
                      )
                      .map((server) => (
                        <SelectItem key={server.id} value={server.id}>
                          {server.name} ({server.ipAddress})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Separate build servers use the selected registry to transfer
                  the resulting image to the deployment target.
                </p>
              </div>
            )}
            {resource.type === "application" && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="build-registry">Build registry</Label>
                <Select
                  items={[
                    {
                      value: "none",
                      label: "Automatic first organization registry",
                    },
                    ...(dockerRegistriesQuery.data || []).map((registry) => ({
                      value: registry.id,
                      label: registry.name,
                    })),
                  ]}
                  value={buildRegistryId || "none"}
                  onValueChange={(value) =>
                    setBuildRegistryId(value === "none" ? "" : (value ?? ""))
                  }
                >
                  <SelectTrigger id="build-registry" className="w-full">
                    <SelectValue placeholder="Choose a registry for build transfer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      Automatic first organization registry
                    </SelectItem>
                    {(dockerRegistriesQuery.data || []).map((registry) => (
                      <SelectItem key={registry.id} value={registry.id}>
                        {registry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Required when a separate build server is used. The selected
                  registry is organization-scoped and encrypted at rest.
                </p>
              </div>
            )}
            <div className="flex justify-end border-border/20 border-t pt-4 sm:col-span-2">
              <Button
                disabled={isUpdatingResource}
                onClick={() => {
                  if (
                    isCloud &&
                    (deploymentServerId === "default" || !deploymentServerId)
                  ) {
                    toast.error(
                      "Please select a target server for deployment.",
                    );
                    return;
                  }
                  updateResource(
                    {
                      id: resource.id,
                      serverId:
                        deploymentServerId === "default"
                          ? null
                          : deploymentServerId,
                      ...(resource.type === "application"
                        ? {
                            buildServerId:
                              buildServerId === "default"
                                ? null
                                : buildServerId,
                            buildRegistryId: buildRegistryId || null,
                          }
                        : {}),
                    },
                    {
                      onSuccess: () =>
                        toast.success("Execution infrastructure saved"),
                    },
                  );
                }}
              >
                Save Infrastructure
              </Button>
            </div>
          </CardContent>
        </Card>

        {resource.type === "database" && (
          <Card className="border border-border/40 bg-card/20">
            <CardHeader>
              <CardTitle className="font-semibold text-lg">
                Database Configuration
              </CardTitle>
              <CardDescription className="text-sm">
                Manage the engine, image version, and credentials used when the
                database Swarm service is deployed.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 border-border/20 border-t pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="database-engine">Database engine</Label>
                  <Input
                    id="database-engine"
                    value={
                      databaseType === "postgres"
                        ? "PostgreSQL"
                        : databaseType === "mysql"
                          ? "MySQL"
                          : databaseType === "mariadb"
                            ? "MariaDB"
                            : databaseType === "mongodb"
                              ? "MongoDB"
                              : databaseType === "redis"
                                ? "Redis"
                                : databaseType === "libsql"
                                  ? "libSQL"
                                  : databaseType
                    }
                    disabled
                    className="w-full cursor-not-allowed bg-muted/20 font-medium"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Database engine is fixed at resource creation.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="database-image">Image version</Label>
                  <Select
                    items={[
                      ...DATABASE_IMAGE_OPTIONS[databaseType].map((image) => ({
                        value: image,
                        label: image,
                      })),
                      { value: "__custom__", label: "Custom image" },
                    ]}
                    value={useCustomDatabaseImage ? "__custom__" : dockerImage}
                    onValueChange={(value) => {
                      if (value === "__custom__") {
                        setUseCustomDatabaseImage(true);
                        setDockerImage("");
                        return;
                      }
                      if (value) {
                        setUseCustomDatabaseImage(false);
                        setCustomDatabaseImage("");
                        setDockerImage(value);
                      }
                    }}
                  >
                    <SelectTrigger id="database-image" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {DATABASE_IMAGE_OPTIONS[databaseType].map((image) => (
                          <SelectItem key={image} value={image}>
                            {image}
                          </SelectItem>
                        ))}
                        <SelectItem value="__custom__">Custom image</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {useCustomDatabaseImage && (
                    <Input
                      value={customDatabaseImage}
                      onChange={(event) =>
                        setCustomDatabaseImage(event.target.value)
                      }
                      placeholder="ghcr.io/acme/postgres:17"
                    />
                  )}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {databaseType !== "redis" && (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="database-user">
                      {databaseType === "mongodb"
                        ? "Root username"
                        : "Database user"}
                    </Label>
                    <Input
                      id="database-user"
                      value={databaseCredentials.dbUser ?? ""}
                      onChange={(event) =>
                        updateDatabaseCredential("dbUser", event.target.value)
                      }
                      autoComplete="off"
                    />
                  </div>
                )}
                {databaseType !== "redis" && (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="database-password">Password</Label>
                    <Input
                      id="database-password"
                      type="password"
                      value={databaseCredentials.dbPassword ?? ""}
                      onChange={(event) =>
                        updateDatabaseCredential(
                          "dbPassword",
                          event.target.value,
                        )
                      }
                      autoComplete="new-password"
                    />
                  </div>
                )}
                {(databaseType === "mysql" || databaseType === "mariadb") && (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="database-root-password">
                      Root password
                    </Label>
                    <Input
                      id="database-root-password"
                      type="password"
                      value={databaseCredentials.dbRootPassword ?? ""}
                      onChange={(event) =>
                        updateDatabaseCredential(
                          "dbRootPassword",
                          event.target.value,
                        )
                      }
                      autoComplete="new-password"
                    />
                  </div>
                )}
                {databaseType !== "redis" &&
                  databaseType !== "mongodb" &&
                  databaseType !== "libsql" && (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="database-name">Database name</Label>
                      <Input
                        id="database-name"
                        value={databaseCredentials.dbName ?? ""}
                        onChange={(event) =>
                          updateDatabaseCredential("dbName", event.target.value)
                        }
                      />
                    </div>
                  )}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="database-external-port">
                    {databaseType === "libsql" ? "HTTP port" : "External port"}{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="database-external-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={databaseExternalPort}
                    onChange={(event) =>
                      setDatabaseExternalPort(event.target.value)
                    }
                    placeholder="Use engine default"
                  />
                </div>
                {databaseType === "libsql" && (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="database-libsql-grpc-port">
                        gRPC port{" "}
                        <span className="text-muted-foreground">
                          (optional)
                        </span>
                      </Label>
                      <Input
                        id="database-libsql-grpc-port"
                        type="number"
                        min={1}
                        max={65535}
                        value={databaseLibsqlGrpcPort}
                        onChange={(event) =>
                          setDatabaseLibsqlGrpcPort(event.target.value)
                        }
                        placeholder="Use engine default"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="database-libsql-admin-port">
                        Admin port{" "}
                        <span className="text-muted-foreground">
                          (optional)
                        </span>
                      </Label>
                      <Input
                        id="database-libsql-admin-port"
                        type="number"
                        min={1}
                        max={65535}
                        value={databaseLibsqlAdminPort}
                        onChange={(event) =>
                          setDatabaseLibsqlAdminPort(event.target.value)
                        }
                        placeholder="Use engine default"
                      />
                    </div>
                  </>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {databaseType === "libsql"
                  ? "libSQL uses HTTP 8080, gRPC 5001, and admin 5000 inside the container; blank fields use those defaults."
                  : "Published Docker port; blank uses the engine default."}
              </p>
              <div className="flex justify-end border-border/20 border-t pt-4">
                <Button
                  onClick={handleSaveDatabase}
                  disabled={isUpdatingResource}
                >
                  Save Database Configuration
                </Button>
              </div>
              <div className="flex flex-col gap-3 border-border/20 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-sm">
                    Database Controls &amp; Lifecycle
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Control the database service status, check its
                    health/version, or rebuild the database instance.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant={isRunning ? "destructive" : "default"}
                          disabled={
                            isControllingResource || isRebuildingDatabase
                          }
                          onClick={() =>
                            triggerStatusChange(
                              isRunning ? "stopped" : "running",
                            )
                          }
                          className="gap-2"
                        >
                          {isRunning ? (
                            <>
                              <Square className="size-4" /> Stop
                            </>
                          ) : (
                            <>
                              <Play className="size-4" /> Start
                            </>
                          )}
                        </Button>
                      }
                    />
                    <TooltipContent>
                      {isRunning
                        ? "Stop the database service containers"
                        : "Start the database service containers"}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="outline"
                          disabled={databaseCommand.isPending}
                          onClick={() =>
                            databaseCommand.mutate({
                              id: resource.id,
                              command: "health",
                            })
                          }
                        >
                          {databaseCommand.isPending ? "Checking..." : "Health"}
                        </Button>
                      }
                    />
                    <TooltipContent>
                      Query container health check status
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="outline"
                          disabled={databaseCommand.isPending}
                          onClick={() =>
                            databaseCommand.mutate({
                              id: resource.id,
                              command: "version",
                            })
                          }
                        >
                          Version
                        </Button>
                      }
                    />
                    <TooltipContent>
                      Query database engine runtime version
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="outline"
                          disabled={
                            isControllingResource || isRebuildingDatabase
                          }
                          onClick={() => {
                            toast.info("Reloading database service...");
                            controlResource({
                              id: resource.id,
                              command: "restart",
                            });
                          }}
                        >
                          <RefreshCw className="mr-2 size-4" />
                          Reload
                        </Button>
                      }
                    />
                    <TooltipContent>
                      Gracefully restart container tasks without destroying data
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="destructive"
                          disabled={
                            isControllingResource || isRebuildingDatabase
                          }
                          onClick={() => setRebuildDialogOpen(true)}
                        >
                          {isRebuildingDatabase ? "Rebuilding..." : "Rebuild"}
                        </Button>
                      }
                    />
                    <TooltipContent>
                      Dismantle service and recreate instance from scratch
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {databaseCommandOutput && (
                <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-xs">
                  {databaseCommandOutput}
                </pre>
              )}
            </CardContent>
          </Card>
        )}

        {resource.type === "compose" && (
          <Card className="border border-border/40 bg-card/20">
            <CardHeader>
              <CardTitle className="font-semibold text-lg">
                Compose Deployment Mode
              </CardTitle>
              <CardDescription className="text-sm">
                Choose standard Docker Compose for a single host or Docker Stack
                for Swarm-managed deployments.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 border-border/20 border-t pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="compose-deployment-mode">
                    Deployment mode
                  </Label>
                  <Select
                    items={[
                      { value: "compose", label: "Docker Compose" },
                      { value: "stack", label: "Docker Swarm Stack" },
                    ]}
                    value={composeType}
                    onValueChange={(value) =>
                      setComposeType(value as ResourceComposeType)
                    }
                  >
                    <SelectTrigger
                      id="compose-deployment-mode"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="compose">Docker Compose</SelectItem>
                      <SelectItem value="stack">Docker Swarm Stack</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-muted-foreground text-sm">
                  {composeType === "stack"
                    ? "Uses the Swarm scheduler and supports multi-node placement."
                    : "Runs with Docker Compose on the selected host and does not create Swarm services."}
                </div>
              </div>
              <div className="flex justify-end border-border/20 border-t pt-4">
                <Button
                  onClick={handleSaveCompose}
                  disabled={isUpdatingResource}
                >
                  Save Deployment Mode
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {resource.type === "application" && (
          <Card className="border border-border/40 bg-card/20">
            <CardHeader>
              <CardTitle className="font-semibold text-lg">
                Build Configuration
              </CardTitle>
              <CardDescription className="text-sm">
                Select the builder and configure only the inputs it requires.
                Changes apply to the next deployment.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 border-border/20 border-t pt-4">
              <div className="max-w-sm space-y-2">
                <Label htmlFor="build-path">Build path</Label>
                <Input
                  id="build-path"
                  value={buildConfig.buildPath}
                  onChange={(event) =>
                    setBuildConfig({
                      ...buildConfig,
                      buildPath: event.target.value || ".",
                    })
                  }
                  placeholder=". or apps/web"
                />
                <p className="text-muted-foreground text-xs">
                  Repository subdirectory used as the source root for the
                  selected builder.
                </p>
              </div>
              <FieldGroup>
                <Field>
                  <FieldContent>
                    <FieldLabel htmlFor="build-type">Build type</FieldLabel>
                    <FieldDescription>
                      Dockerfile, Railpack, Nixpacks, Cloud Native Buildpacks,
                      or a static NGINX image.
                    </FieldDescription>
                  </FieldContent>
                  <Select
                    items={[
                      { value: "dockerfile", label: "Dockerfile" },
                      { value: "railpack", label: "Railpack" },
                      { value: "nixpacks", label: "Nixpacks" },
                      {
                        value: "heroku-buildpacks",
                        label: "Heroku Buildpacks",
                      },
                      {
                        value: "paketo-buildpacks",
                        label: "Paketo Buildpacks",
                      },
                      { value: "static", label: "Static" },
                    ]}
                    value={buildConfig.type}
                    onValueChange={(value) => {
                      const nextType = value as ApplicationBuildConfig["type"];
                      setBuildConfig(createBuildConfig(nextType));
                    }}
                  >
                    <SelectTrigger id="build-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="dockerfile">Dockerfile</SelectItem>
                        <SelectItem value="railpack">Railpack</SelectItem>
                        <SelectItem value="nixpacks">Nixpacks</SelectItem>
                        <SelectItem value="heroku-buildpacks">
                          Heroku Buildpacks
                        </SelectItem>
                        <SelectItem value="paketo-buildpacks">
                          Paketo Buildpacks
                        </SelectItem>
                        <SelectItem value="static">Static</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>

              {buildConfig.type === "dockerfile" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="dockerfile-path">Dockerfile path</Label>
                      <Input
                        id="dockerfile-path"
                        value={buildConfig.dockerfilePath}
                        onChange={(event) =>
                          setBuildConfig({
                            ...buildConfig,
                            dockerfilePath: event.target.value,
                          })
                        }
                        placeholder="Dockerfile"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="docker-context-path">
                        Docker context path
                      </Label>
                      <Input
                        id="docker-context-path"
                        value={buildConfig.dockerContextPath}
                        onChange={(event) =>
                          setBuildConfig({
                            ...buildConfig,
                            dockerContextPath: event.target.value,
                          })
                        }
                        placeholder="."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="docker-build-stage">
                        Build stage{" "}
                        <span className="text-muted-foreground">
                          (optional)
                        </span>
                      </Label>
                      <Input
                        id="docker-build-stage"
                        value={buildConfig.dockerBuildStage ?? ""}
                        onChange={(event) =>
                          setBuildConfig({
                            ...buildConfig,
                            dockerBuildStage: event.target.value || undefined,
                          })
                        }
                        placeholder="production"
                      />
                    </div>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="docker-build-args">
                      Docker build arguments
                    </FieldLabel>
                    <FieldDescription>
                      Configure values passed to the Dockerfile builder.
                    </FieldDescription>
                    <CodeSurface>
                      <CodeEditor
                        id="docker-build-args"
                        language="json"
                        allowLanguageChange={false}
                        height="130px"
                        value={JSON.stringify(
                          buildConfig.dockerBuildArgs ?? {},
                          null,
                          2,
                        )}
                        onChange={(value) => {
                          try {
                            const parsed = JSON.parse(value) as unknown;
                            if (
                              parsed &&
                              typeof parsed === "object" &&
                              !Array.isArray(parsed)
                            ) {
                              const args = Object.fromEntries(
                                Object.entries(parsed).filter(
                                  ([, item]) => typeof item === "string",
                                ),
                              );
                              setBuildConfig({
                                ...buildConfig,
                                dockerBuildArgs: args,
                              });
                            }
                          } catch {
                            // Keep reactive typing
                          }
                        }}
                        aria-label="Docker build arguments JSON"
                      />
                    </CodeSurface>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="docker-build-secrets">
                      Docker BuildKit secrets
                    </FieldLabel>
                    <FieldDescription>
                      JSON object of secret environment values. Dockerfile and
                      Railpack builds expose them through BuildKit secret
                      mounts; unsupported builders do not persist them in the
                      image. Values are encrypted and never returned to the UI.
                    </FieldDescription>
                    <CodeSurface>
                      <CodeEditor
                        id="docker-build-secrets"
                        language="json"
                        allowLanguageChange={false}
                        height="130px"
                        value={dockerBuildSecretsJson}
                        onChange={(value) =>
                          setDockerBuildSecretsJson(value || "")
                        }
                        aria-label="Docker BuildKit secrets JSON"
                      />
                    </CodeSurface>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldLabel htmlFor="docker-no-cache">
                          Disable build cache
                        </FieldLabel>
                        <FieldDescription>
                          Force a clean Dockerfile build for the next deploy.
                        </FieldDescription>
                      </FieldContent>
                      <Switch
                        id="docker-no-cache"
                        checked={buildConfig.dockerNoCache}
                        onCheckedChange={(dockerNoCache) =>
                          setBuildConfig({ ...buildConfig, dockerNoCache })
                        }
                      />
                    </Field>
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldLabel htmlFor="docker-cleanup-cache">
                          Clean builder cache
                        </FieldLabel>
                        <FieldDescription>
                          Prune unused Docker builder layers after building.
                        </FieldDescription>
                      </FieldContent>
                      <Switch
                        id="docker-cleanup-cache"
                        checked={buildConfig.dockerCleanupCache}
                        onCheckedChange={(dockerCleanupCache) =>
                          setBuildConfig({ ...buildConfig, dockerCleanupCache })
                        }
                      />
                    </Field>
                  </div>
                </>
              )}

              {buildConfig.type === "railpack" && (
                <div className="max-w-sm space-y-2">
                  <Label htmlFor="railpack-version">Railpack version</Label>
                  <Select
                    items={[
                      ...RAILPACK_VERSIONS.map((version) => ({
                        value: version,
                        label: version,
                      })),
                      { value: "custom", label: "Custom version" },
                    ]}
                    value={
                      RAILPACK_VERSIONS.includes(
                        (buildConfig.railpackVersion ??
                          "") as (typeof RAILPACK_VERSIONS)[number],
                      )
                        ? (buildConfig.railpackVersion ?? "")
                        : "custom"
                    }
                    onValueChange={(value) => {
                      if (value !== "custom") {
                        setBuildConfig({
                          ...buildConfig,
                          railpackVersion: value ?? "",
                        });
                      }
                    }}
                  >
                    <SelectTrigger id="railpack-version" className="w-full">
                      <SelectValue placeholder="Select Railpack version" />
                    </SelectTrigger>
                    <SelectContent>
                      {RAILPACK_VERSIONS.map((version) => (
                        <SelectItem key={version} value={version}>
                          {version}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Custom version</SelectItem>
                    </SelectContent>
                  </Select>
                  {!RAILPACK_VERSIONS.includes(
                    (buildConfig.railpackVersion ??
                      "") as (typeof RAILPACK_VERSIONS)[number],
                  ) && (
                    <Input
                      value={buildConfig.railpackVersion ?? ""}
                      onChange={(event) =>
                        setBuildConfig({
                          ...buildConfig,
                          railpackVersion: event.target.value,
                        })
                      }
                      placeholder="0.15.4"
                      aria-label="Custom Railpack version"
                    />
                  )}
                </div>
              )}

              {buildConfig.type === "nixpacks" && (
                <div className="max-w-sm space-y-2">
                  <Label htmlFor="nixpacks-publish-directory">
                    Publish directory{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="nixpacks-publish-directory"
                    value={buildConfig.publishDirectory ?? ""}
                    onChange={(event) =>
                      setBuildConfig({
                        ...buildConfig,
                        publishDirectory: event.target.value || undefined,
                      })
                    }
                    placeholder="dist"
                  />
                </div>
              )}

              {buildConfig.type === "heroku-buildpacks" && (
                <div className="max-w-sm space-y-2">
                  <Label htmlFor="heroku-version">Heroku stack version</Label>
                  <Select
                    items={[
                      { value: "24", label: "Heroku-24" },
                      { value: "26", label: "Heroku-26" },
                    ]}
                    value={buildConfig.herokuVersion}
                    onValueChange={(value) => {
                      setBuildConfig({
                        ...buildConfig,
                        herokuVersion: value as "24" | "26",
                      });
                    }}
                  >
                    <SelectTrigger id="heroku-version" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="24">Heroku-24</SelectItem>
                        <SelectItem value="26">Heroku-26</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {buildConfig.type === "paketo-buildpacks" && (
                <p className="rounded-md border border-border bg-muted/40 p-3 text-muted-foreground text-sm">
                  Paketo builds use the production Jammy full builder and rely
                  on buildpack detection in your repository.
                </p>
              )}

              {buildConfig.type === "static" && (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                  <div className="w-full max-w-sm space-y-2">
                    <Label htmlFor="static-publish-directory">
                      Publish directory
                    </Label>
                    <Input
                      id="static-publish-directory"
                      value={buildConfig.publishDirectory}
                      onChange={(event) =>
                        setBuildConfig({
                          ...buildConfig,
                          publishDirectory: event.target.value,
                        })
                      }
                      placeholder="dist"
                    />
                  </div>
                  <Field orientation="horizontal" className="w-full sm:w-auto">
                    <FieldContent>
                      <FieldLabel htmlFor="static-spa">
                        Single-page application
                      </FieldLabel>
                      <FieldDescription>
                        Fallback unknown routes to index.html.
                      </FieldDescription>
                    </FieldContent>
                    <Switch
                      id="static-spa"
                      checked={buildConfig.spa}
                      onCheckedChange={(spa) => {
                        setBuildConfig({ ...buildConfig, spa });
                      }}
                    />
                  </Field>
                </div>
              )}

              <div className="flex justify-end border-border/20 border-t pt-4">
                <Button
                  type="button"
                  onClick={() => {
                    const parsed =
                      ApplicationBuildConfigSchema.safeParse(buildConfig);
                    if (!parsed.success) {
                      toast.error(
                        parsed.error.issues[0]?.message ??
                          "Invalid build configuration",
                      );
                      return;
                    }
                    const patch: ResourceUpdateInput = {
                      id: resource.id,
                      buildConfig: parsed.data,
                    };
                    if (dockerBuildSecretsJson.trim()) {
                      try {
                        const secrets = JSON.parse(
                          dockerBuildSecretsJson,
                        ) as unknown;
                        if (
                          !secrets ||
                          typeof secrets !== "object" ||
                          Array.isArray(secrets) ||
                          Object.values(secrets).some(
                            (value) => typeof value !== "string",
                          )
                        ) {
                          throw new Error(
                            "Build secrets must be a JSON object of strings",
                          );
                        }
                        patch.buildSecrets = dockerBuildSecretsJson;
                      } catch (error) {
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "Invalid build secrets JSON",
                        );
                        return;
                      }
                    }
                    updateResource(patch);
                  }}
                  disabled={isUpdatingResource}
                >
                  Save Build Configuration
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {resource.type === "application" && (
          <Card className="border border-border/40 bg-card/20">
            <CardHeader>
              <CardTitle className="font-semibold text-lg">
                Pull request previews
              </CardTitle>
              <CardDescription className="text-sm">
                Deploy GitHub pull requests as temporary services with isolated
                preview domains.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 border-border/20 border-t pt-4">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="preview-active">
                    Enable previews
                  </FieldLabel>
                  <FieldDescription>
                    Requires a signed GitHub pull-request webhook for this
                    application.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="preview-active"
                  checked={previewActive}
                  onCheckedChange={setPreviewActive}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="preview-limit">Preview limit</Label>
                  <Input
                    id="preview-limit"
                    type="number"
                    min={1}
                    max={100}
                    value={previewLimit}
                    onChange={(event) => setPreviewLimit(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="preview-wildcard">Wildcard domain</Label>
                  <Input
                    id="preview-wildcard"
                    value={previewWildcard}
                    onChange={(event) => setPreviewWildcard(event.target.value)}
                    placeholder="sslip.io"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="preview-port">Preview port</Label>
                  <Input
                    id="preview-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={previewPort}
                    onChange={(event) => setPreviewPort(event.target.value)}
                  />
                </div>
              </div>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="preview-https">
                    HTTPS previews
                  </FieldLabel>
                  <FieldDescription>
                    Reuse the automatic certificate resolver for preview hosts.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="preview-https"
                  checked={previewHttps}
                  onCheckedChange={setPreviewHttps}
                />
              </Field>
              <div className="flex justify-end border-border/20 border-t pt-4">
                <Button
                  disabled={isUpdatingResource}
                  onClick={() =>
                    updateResource(
                      {
                        id: resource.id,
                        isPreviewDeploymentsActive: previewActive,
                        previewLimit: Number(previewLimit),
                        previewWildcard: previewWildcard.trim() || null,
                        previewHttps,
                        previewPort: Number(previewPort),
                      },
                      {
                        onSuccess: () =>
                          toast.success("Preview settings saved"),
                      },
                    )
                  }
                >
                  Save Preview Settings
                </Button>
              </div>
              {(previewsQuery.data?.length ?? 0) > 0 && (
                <div className="space-y-2 border-border/20 border-t pt-4">
                  <p className="font-medium text-sm">
                    Active preview deployments
                  </p>
                  <div className="space-y-2">
                    {previewsQuery.data?.map((preview) => (
                      <div
                        key={preview.id}
                        className="flex flex-col gap-1 rounded-md border border-border/40 bg-muted/20 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span>
                          PR #{preview.pullRequestId} · {preview.branchName}
                        </span>
                        <span className="text-muted-foreground">
                          {preview.domain} · {preview.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Provider Card */}
        {resource.type !== "database" && (
          <Card className="border border-border/40 bg-card/20">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="font-semibold text-lg">
                  Provider
                </CardTitle>
                <CardDescription className="text-muted-foreground text-sm">
                  Select the source of your code
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 border-border/20 border-t pt-4">
              {/* Provider Tabs */}
              <div
                aria-label="Source provider"
                className="flex max-w-full gap-1 overflow-x-auto border border-border/30 bg-muted/40 p-1 [scrollbar-width:thin]"
                role="tablist"
              >
                {[
                  ...(resource.type === "application"
                    ? [
                        { id: "docker", label: "Docker", icon: Code },
                        { id: "drop", label: "Drag & Drop", icon: Upload },
                      ]
                    : []),
                  { id: "github", label: "GitHub", icon: Globe },
                  { id: "gitlab", label: "GitLab", icon: Globe },
                  { id: "bitbucket", label: "Bitbucket", icon: Globe },
                  { id: "gitea", label: "Gitea", icon: Code },
                  { id: "git", label: "Git", icon: Globe },
                  ...(resource.type === "compose"
                    ? [{ id: "raw", label: "Raw", icon: Code }]
                    : []),
                ].map((prov) => {
                  const Icon = prov.icon;
                  const active = providerType === prov.id;
                  return (
                    <button
                      key={prov.id}
                      aria-selected={active}
                      role="tab"
                      type="button"
                      onClick={() =>
                        setProviderType(prov.id as ResourceProvider)
                      }
                      className={cn(
                        "flex shrink-0 cursor-pointer items-center gap-2 border-none px-3 py-1.5 font-semibold text-xs transition-colors",
                        active
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-background/20 hover:text-foreground",
                      )}
                    >
                      <Icon className="size-3.5" />
                      {prov.label}
                    </button>
                  );
                })}
              </div>

              {providerType === "drop" && (
                <div className="flex flex-col gap-3 pt-2">
                  <Label>Source Archive (ZIP or Tarball)</Label>
                  <input
                    type="file"
                    ref={archiveFileInputRef}
                    accept=".zip,.tar,.gz,.tgz"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void handleUploadDropFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => archiveFileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        archiveFileInputRef.current?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files?.[0];
                      if (file) {
                        await handleUploadDropFile(file);
                      }
                    }}
                    className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border/40 border-dashed bg-muted/20 p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
                  >
                    <Upload className="mb-2 size-8 text-muted-foreground" />
                    <p className="font-medium text-foreground text-sm">
                      Drag & drop your archive file here, or click to select
                    </p>
                    <p className="mt-1 text-muted-foreground text-xs">
                      Supports .zip, .tar, .tar.gz, .tgz (Max 50MB)
                    </p>
                  </div>
                </div>
              )}

              {providerType === "docker" && resource.type === "application" && (
                <div className="flex flex-col gap-2 pt-2">
                  <Label htmlFor="application-image">Docker image</Label>
                  <Input
                    id="application-image"
                    value={dockerImage}
                    onChange={(event) => setDockerImage(event.target.value)}
                    placeholder="ghcr.io/example/app:latest"
                  />
                  <p className="text-muted-foreground text-xs">
                    The image is pulled and deployed as a Swarm service.
                  </p>
                  <Label htmlFor="application-registry">
                    Private registry (optional)
                  </Label>
                  <Select
                    items={[
                      { value: "none", label: "Public image / no registry" },
                      ...(dockerRegistriesQuery.data || []).map((registry) => ({
                        value: registry.id,
                        label: registry.name,
                      })),
                    ]}
                    value={dockerRegistryId || "none"}
                    onValueChange={(value) =>
                      setDockerRegistryId(value === "none" ? "" : (value ?? ""))
                    }
                  >
                    <SelectTrigger id="application-registry" className="w-full">
                      <SelectValue placeholder="Use public image credentials" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        Public image / no registry
                      </SelectItem>
                      {(dockerRegistriesQuery.data || []).map((registry) => (
                        <SelectItem key={registry.id} value={registry.id}>
                          {registry.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    Upstand sends the selected registry credentials to Docker
                    for image pulls and Swarm task authentication.
                  </p>
                  <div className="mt-4 space-y-3 rounded-lg border border-border/40 bg-muted/10 p-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1 pr-4">
                        <Label
                          htmlFor="application-rollback-active"
                          className="font-medium text-sm"
                        >
                          Enable registry-backed rollback
                        </Label>
                        <p className="text-muted-foreground text-xs">
                          Pass private-registry credentials when Swarm restores
                          the previous service specification.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setConfigureRollbackDialogOpen(true)}
                        >
                          Configure Rollback
                        </Button>
                        <Switch
                          id="application-rollback-active"
                          checked={rollbackActive}
                          onCheckedChange={(checked) => {
                            if (
                              checked &&
                              !(dockerRegistriesQuery.data || []).length
                            ) {
                              toast.error(
                                "No registries available. Please configure a registry first to enable rollbacks.",
                              );
                              return;
                            }
                            setRollbackActive(checked);
                          }}
                        />
                      </div>
                    </div>

                    {!(dockerRegistriesQuery.data || []).length && (
                      <div className="space-y-1 rounded-md border border-warning/30 bg-warning/10 p-3 text-warning text-xs">
                        <p className="font-medium">
                          No registries available. Please configure a registry
                          first to enable rollbacks.
                        </p>
                        <Link
                          href="/docker-registry"
                          className="mt-1 inline-block font-semibold underline hover:opacity-80"
                        >
                          Go to Docker Registry page &rarr;
                        </Link>
                      </div>
                    )}

                    {rollbackActive &&
                      (dockerRegistriesQuery.data || []).length > 0 && (
                        <>
                          <Label
                            htmlFor="application-rollback-registry"
                            className="text-xs"
                          >
                            Rollback registry
                          </Label>
                          <Select
                            items={[
                              ...(dockerRegistriesQuery.data || []).map(
                                (registry) => ({
                                  value: registry.id,
                                  label: registry.name,
                                }),
                              ),
                            ]}
                            value={
                              rollbackRegistryId ||
                              (dockerRegistriesQuery.data || [])[0]?.id ||
                              ""
                            }
                            onValueChange={(value) =>
                              setRollbackRegistryId(value || "")
                            }
                          >
                            <SelectTrigger
                              id="application-rollback-registry"
                              className="w-full"
                            >
                              <SelectValue placeholder="Select a rollback registry" />
                            </SelectTrigger>
                            <SelectContent>
                              {(dockerRegistriesQuery.data || []).map(
                                (registry) => (
                                  <SelectItem
                                    key={registry.id}
                                    value={registry.id}
                                  >
                                    {registry.name}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                          <p className="text-muted-foreground text-xs">
                            Credentials are organization-scoped and encrypted at
                            rest. Used during service rollback.
                          </p>
                        </>
                      )}
                  </div>
                </div>
              )}

              {/* GitHub/GitLab/Bitbucket/Gitea Form */}
              {["github", "gitlab", "bitbucket", "gitea"].includes(
                providerType,
              ) && (
                <div className="space-y-4 pt-2">
                  {gitProviders?.filter((p) => p.provider === providerType)
                    .length === 0 && (
                    <div className="space-y-1 rounded-md border border-warning/20 bg-warning/10 p-3.5 text-warning text-xs">
                      <p className="font-semibold capitalize">
                        No {providerType} accounts configured.
                      </p>
                      <p>
                        To pull repositories and branches from {providerType},
                        configure a connection in{" "}
                        <Link
                          href={"/git-providers" as Route}
                          className="font-bold underline hover:opacity-80"
                        >
                          Git Providers Settings
                        </Link>
                        .
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label className="capitalize">{providerType} Account</Label>
                    <Select
                      items={(gitProviders || [])
                        .filter((p) => p.provider === providerType)
                        .map((p) => {
                          const config = JSON.parse(p.config);
                          const isInstalled =
                            p.provider === "github"
                              ? !!config.githubInstallationId
                              : p.provider === "bitbucket"
                                ? true
                                : !!config.accessToken;
                          return {
                            value: p.id,
                            label: isInstalled
                              ? p.name
                              : `${p.name} (Not Installed/Authorized)`,
                          };
                        })}
                      value={githubAccount}
                      onValueChange={(value) => setGithubAccount(value ?? "")}
                      disabled={
                        gitProviders?.filter((p) => p.provider === providerType)
                          .length === 0
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select Account" />
                      </SelectTrigger>
                      <SelectContent>
                        {gitProviders
                          ?.filter((p) => p.provider === providerType)
                          .map((p) => {
                            const config = JSON.parse(p.config);
                            const isInstalled =
                              p.provider === "github"
                                ? !!config.githubInstallationId
                                : p.provider === "bitbucket"
                                  ? true
                                  : !!config.accessToken;
                            return (
                              <SelectItem
                                key={p.id}
                                value={p.id}
                                disabled={!isInstalled}
                              >
                                {p.name}{" "}
                                {!isInstalled
                                  ? "(Not Installed/Authorized)"
                                  : ""}
                              </SelectItem>
                            );
                          })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Repository</Label>
                    <Select
                      items={(gitRepos || []).map((repo) => ({
                        value: repo.fullName,
                        label: repo.fullName,
                      }))}
                      value={githubRepo}
                      onValueChange={(value) => setGithubRepo(value ?? "")}
                      disabled={
                        !githubAccount ||
                        gitProviders?.filter((p) => p.provider === providerType)
                          .length === 0
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={
                            loadingRepos
                              ? "Loading Repositories..."
                              : "Select Repository"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {gitRepos?.map((repo) => (
                          <SelectItem key={repo.id} value={repo.fullName}>
                            {repo.fullName}
                          </SelectItem>
                        ))}
                        {(!gitRepos || gitRepos.length === 0) && (
                          <SelectItem value="none" disabled>
                            No Repositories Found
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  {resource.type === "compose" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Branch</Label>
                        <Select
                          items={(gitBranches || []).map((branch: string) => ({
                            value: branch,
                            label: branch,
                          }))}
                          value={githubBranch}
                          onValueChange={(value) =>
                            setGithubBranch(value ?? "")
                          }
                          disabled={
                            !githubRepo ||
                            gitProviders?.filter(
                              (p) => p.provider === providerType,
                            ).length === 0
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue
                              placeholder={
                                loadingBranches
                                  ? "Loading Branches..."
                                  : "Select Branch"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {gitBranches?.map((branch: string) => (
                              <SelectItem key={branch} value={branch}>
                                {branch}
                              </SelectItem>
                            ))}
                            {(!gitBranches || gitBranches.length === 0) && (
                              <SelectItem value="none" disabled>
                                No Branches Found
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Compose Path</Label>
                        <Input
                          value={githubComposePath}
                          onChange={(e) => setGithubComposePath(e.target.value)}
                          placeholder="./docker-compose.yml"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Branch</Label>
                      <Select
                        items={(gitBranches || []).map((branch: string) => ({
                          value: branch,
                          label: branch,
                        }))}
                        value={githubBranch}
                        onValueChange={(value) => setGithubBranch(value ?? "")}
                        disabled={
                          !githubRepo ||
                          gitProviders?.filter(
                            (p) => p.provider === providerType,
                          ).length === 0
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue
                            placeholder={
                              loadingBranches
                                ? "Loading Branches..."
                                : "Select Branch"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {gitBranches?.map((branch: string) => (
                            <SelectItem key={branch} value={branch}>
                              {branch}
                            </SelectItem>
                          ))}
                          {(!gitBranches || gitBranches.length === 0) && (
                            <SelectItem value="none" disabled>
                              No Branches Found
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Trigger Type</Label>
                    <Select
                      items={[
                        { value: "On Push", label: "On Push" },
                        { value: "On Tag", label: "On Tag" },
                      ]}
                      value={githubTriggerType}
                      onValueChange={(value) =>
                        setGithubTriggerType(value ?? "On Push")
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select Trigger" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="On Push">On Push</SelectItem>
                        <SelectItem value="On Tag">On Tag</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {githubTriggerType === "On Tag" && (
                    <div className="space-y-2">
                      <Label htmlFor="github-tag-pattern">Tag Pattern</Label>
                      <Input
                        id="github-tag-pattern"
                        value={tagPattern}
                        onChange={(e) => setTagPattern(e.target.value)}
                        placeholder="e.g. v*, release-v1.* (optional)"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Optional. If empty, all tags will trigger a deployment.
                        Supports wildcards like * (e.g. v*).
                      </p>
                    </div>
                  )}

                  {/* Watch Paths */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      Watch Paths{" "}
                      <span className="font-normal text-[10px] text-muted-foreground">
                        (Trigger build only when changes occur under these
                        paths)
                      </span>
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="watch-path-in"
                        placeholder="e.g. src/**, dist/*.js"
                        className="flex-1 border-border/40 bg-card/30"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const val = e.currentTarget.value.trim();
                            if (val && !githubWatchPaths.includes(val)) {
                              setGithubWatchPaths([...githubWatchPaths, val]);
                              e.currentTarget.value = "";
                            }
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          const input = document.getElementById(
                            "watch-path-in",
                          ) as HTMLInputElement;
                          const val = input?.value?.trim();
                          if (val && !githubWatchPaths.includes(val)) {
                            setGithubWatchPaths([...githubWatchPaths, val]);
                            input.value = "";
                          }
                        }}
                        className="text-xs"
                      >
                        Add
                      </Button>
                    </div>
                    {githubWatchPaths.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {githubWatchPaths.map((p) => (
                          <span
                            key={p}
                            className="inline-flex items-center gap-1 rounded-md border border-border/30 bg-accent/30 px-2 py-0.5 text-foreground text-xs"
                          >
                            {p}
                            <button
                              type="button"
                              onClick={() =>
                                setGithubWatchPaths(
                                  githubWatchPaths.filter((x) => x !== p),
                                )
                              }
                              className="text-[10px] text-muted-foreground hover:text-foreground"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Enable submodules */}
                  <div className="flex items-center justify-between border-border/20 border-t pt-2">
                    <div>
                      <span className="block font-medium text-foreground text-sm">
                        Enable Submodules
                      </span>
                      <span className="text-muted-foreground text-xs">
                        Clone submodules recursively during repository
                        checkouts.
                      </span>
                    </div>
                    <Checkbox
                      checked={githubSubmodules}
                      onCheckedChange={(val) =>
                        setGithubSubmodules(Boolean(val))
                      }
                    />
                  </div>
                </div>
              )}

              {/* Git Form */}
              {providerType === "git" && (
                <div className="space-y-4 pt-2">
                  <div className="grid items-end gap-4 sm:grid-cols-3">
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Repository URL</Label>
                      <Input
                        value={gitUrl}
                        onChange={(e) => setGitUrl(e.target.value)}
                        placeholder="git@github.com:user/repo.git"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center justify-between">
                        <span>SSH Key</span>
                        <Link
                          href={"/ssh-keys" as Route}
                          className="text-[10px] text-primary hover:underline"
                        >
                          Manage Keys
                        </Link>
                      </Label>
                      <Select
                        items={[
                          { value: "none", label: "No authentication" },
                          ...(sshKeys || []).map((key) => ({
                            value: key.id,
                            label: key.name,
                          })),
                        ]}
                        value={gitSshKeyId}
                        onValueChange={(value) => setGitSshKeyId(value ?? "")}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select SSH Key" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            No authentication
                          </SelectItem>
                          {sshKeys?.map((key) => (
                            <SelectItem key={key.id} value={key.id}>
                              {key.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {resource.type === "compose" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Branch</Label>
                        <Input
                          value={gitBranch}
                          onChange={(e) => setGitBranch(e.target.value)}
                          placeholder="master"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Compose Path</Label>
                        <Input
                          value={gitComposePath}
                          onChange={(e) => setGitComposePath(e.target.value)}
                          placeholder="./docker-compose.yml"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Branch</Label>
                      <Input
                        value={gitBranch}
                        onChange={(e) => setGitBranch(e.target.value)}
                        placeholder="master"
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Trigger Type</Label>
                    <Select
                      items={[
                        { value: "push", label: "On Push" },
                        { value: "tag", label: "On Tag" },
                      ]}
                      value={gitTriggerType}
                      onValueChange={(value) =>
                        setGitTriggerType(value ?? "push")
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select Trigger" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="push">On Push</SelectItem>
                        <SelectItem value="tag">On Tag</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {gitTriggerType === "tag" && (
                    <div className="space-y-2">
                      <Label htmlFor="git-tag-pattern">Tag Pattern</Label>
                      <Input
                        id="git-tag-pattern"
                        value={tagPattern}
                        onChange={(e) => setTagPattern(e.target.value)}
                        placeholder="e.g. v*, release-v1.* (optional)"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Optional. If empty, all tags will trigger a deployment.
                        Supports wildcards like * (e.g. v*).
                      </p>
                    </div>
                  )}

                  {/* Watch Paths */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      Watch Paths
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="git-watch-path-in"
                        placeholder="e.g. src/**, dist/*.js"
                        className="flex-1 border-border/40 bg-card/30"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const val = e.currentTarget.value.trim();
                            if (val && !gitWatchPaths.includes(val)) {
                              setGitWatchPaths([...gitWatchPaths, val]);
                              e.currentTarget.value = "";
                            }
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          const input = document.getElementById(
                            "git-watch-path-in",
                          ) as HTMLInputElement;
                          const val = input?.value?.trim();
                          if (val && !gitWatchPaths.includes(val)) {
                            setGitWatchPaths([...gitWatchPaths, val]);
                            input.value = "";
                          }
                        }}
                        className="text-xs"
                      >
                        Add
                      </Button>
                    </div>
                    {gitWatchPaths.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {gitWatchPaths.map((p) => (
                          <span
                            key={p}
                            className="inline-flex items-center gap-1 rounded-md border border-border/30 bg-accent/30 px-2 py-0.5 text-foreground text-xs"
                          >
                            {p}
                            <button
                              type="button"
                              onClick={() =>
                                setGitWatchPaths(
                                  gitWatchPaths.filter((x) => x !== p),
                                )
                              }
                              className="text-[10px] text-muted-foreground hover:text-foreground"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Enable submodules */}
                  <div className="flex items-center justify-between border-border/20 border-t pt-2">
                    <div>
                      <span className="block font-medium text-foreground text-sm">
                        Enable Submodules
                      </span>
                      <span className="text-muted-foreground text-xs">
                        Clone submodules recursively during repository
                        checkouts.
                      </span>
                    </div>
                    <Checkbox
                      checked={gitSubmodules}
                      onCheckedChange={(val) => setGitSubmodules(Boolean(val))}
                    />
                  </div>
                </div>
              )}

              {/* Raw Form */}
              {providerType === "raw" && (
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label>Compose File</Label>
                      <div className="flex flex-wrap justify-end gap-2">
                        {resource.type === "compose" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={randomizeCompose.isPending}
                            onClick={() =>
                              randomizeCompose.mutate({ id: resource.id })
                            }
                          >
                            {randomizeCompose.isPending
                              ? "Randomizing..."
                              : "Randomize names"}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={
                            !rawComposeFile.trim() || inspectCompose.isPending
                          }
                          onClick={() => {
                            if (!activeOrganization?.id) {
                              toast.error("Select an organization first");
                              return;
                            }
                            inspectCompose.mutate({
                              organizationId: activeOrganization.id,
                              composeFile: rawComposeFile,
                            });
                          }}
                        >
                          {inspectCompose.isPending
                            ? "Inspecting…"
                            : "Inspect services"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={
                            !rawComposeFile.trim() || convertCompose.isPending
                          }
                          onClick={() => {
                            if (!activeOrganization?.id) {
                              toast.error("Select an organization first");
                              return;
                            }
                            const target =
                              composeType === "stack" ? "compose" : "stack";
                            convertCompose.mutate({
                              organizationId: activeOrganization.id,
                              composeFile: rawComposeFile,
                              target,
                            });
                          }}
                        >
                          {convertCompose.isPending
                            ? "Converting…"
                            : `Convert to ${composeType === "stack" ? "Compose" : "Stack"}`}
                        </Button>
                      </div>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Adds a collision-safe suffix to services, networks,
                      volumes, configs, and secrets while preserving references.
                    </p>
                    <div className="overflow-hidden rounded-md border border-border/30 bg-muted/20 p-2">
                      <CodeEditor
                        height="350px"
                        language="yaml"
                        value={rawComposeFile}
                        onChange={(value) => setRawComposeFile(value || "")}
                      />
                    </div>
                    {composeInspection && (
                      <div className="space-y-2 rounded-md border border-border/30 bg-muted/10 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 font-medium text-sm">
                          <span>Service discovery</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              const {
                                ports: detectedPorts,
                                volumes: detectedVolumes,
                              } = extractPortsAndVolumesFromServices(
                                composeInspection.services,
                              );

                              const currentConfig = parseResourceAdvancedConfig(
                                resource.advancedConfig,
                              );
                              const existingPortKeys = new Set(
                                currentConfig.ports.map(
                                  (p) =>
                                    `${p.publishedPort}:${p.targetPort}/${p.protocol}`,
                                ),
                              );
                              const existingVolKeys = new Set(
                                currentConfig.volumes.map(
                                  (v) => `${v.source}:${v.target}`,
                                ),
                              );

                              const mergedPorts = [...currentConfig.ports];
                              let portsAdded = 0;
                              for (const p of detectedPorts) {
                                const key = `${p.publishedPort}:${p.targetPort}/${p.protocol}`;
                                if (!existingPortKeys.has(key)) {
                                  mergedPorts.push(p);
                                  portsAdded++;
                                }
                              }

                              const mergedVolumes = [...currentConfig.volumes];
                              let volsAdded = 0;
                              for (const v of detectedVolumes) {
                                if (
                                  !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(v.source)
                                ) {
                                  continue;
                                }
                                const key = `${v.source}:${v.target}`;
                                if (!existingVolKeys.has(key)) {
                                  mergedVolumes.push(v);
                                  volsAdded++;
                                }
                              }

                              if (portsAdded === 0 && volsAdded === 0) {
                                toast.info(
                                  "All detected ports and volumes are already present in Advanced Config.",
                                );
                                return;
                              }

                              const updatedConfig = {
                                ...currentConfig,
                                ports: mergedPorts,
                                volumes: mergedVolumes,
                              };

                              updateResource({
                                id: resource.id,
                                advancedConfig: JSON.stringify(updatedConfig),
                              });
                              toast.success(
                                `Applied ${portsAdded} port(s) and ${volsAdded} volume(s) to Advanced Config`,
                              );
                            }}
                          >
                            Apply Ports &amp; Volumes to Advanced Config
                          </Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {composeInspection.services.map((service) => (
                            <div
                              key={service.name}
                              className="rounded border border-border/20 bg-background/30 p-2 text-xs"
                            >
                              <div className="font-medium">{service.name}</div>
                              <div className="text-muted-foreground">
                                {service.image ?? "Build context"} ·{" "}
                                {service.replicas} replica
                                {service.replicas === 1 ? "" : "s"}
                              </div>
                              {service.ports.length > 0 && (
                                <div className="text-muted-foreground">
                                  Ports: {service.ports.join(", ")}
                                </div>
                              )}
                              {service.dependsOn.length > 0 && (
                                <div className="text-muted-foreground">
                                  Depends on: {service.dependsOn.join(", ")}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        {composeInspection.warnings.length > 0 && (
                          <div className="text-warning text-xs">
                            {composeInspection.warnings.join(" ")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Save Button */}
              <div className="flex justify-end border-border/20 border-t pt-2">
                <Button
                  onClick={handleSaveProvider}
                  disabled={
                    isUpdatingResource ||
                    (providerType === "docker" && !dockerImage.trim())
                  }
                  className="font-medium"
                >
                  {isUpdatingResource ? "Saving..." : "Save"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Rename settings */}
        <Card className="border border-border/40 bg-card/20">
          <CardHeader>
            <CardTitle className="font-semibold text-lg">
              General Configuration
            </CardTitle>
            <CardDescription className="text-muted-foreground text-sm">
              Modify resource identification parameters.
            </CardDescription>
          </CardHeader>
          <CardContent className="border-border/20 border-t pt-4">
            <form onSubmit={handleRename} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="res-name-set">Resource Name</Label>
                <Input
                  id="res-name-set"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="res-service-name-set">
                  Docker service name
                </Label>
                <Input
                  id="res-service-name-set"
                  value={appNameInput}
                  onChange={(e) => setAppNameInput(e.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  This stable service or stack name is used by deployment and
                  routing.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="res-description-set">Description</Label>
                <Input
                  id="res-description-set"
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={
                  isUpdatingResource ||
                  !nameInput.trim() ||
                  !appNameInput.trim()
                }
              >
                {isUpdatingResource ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <DangerZoneCard
          title="Delete Resource"
          description="Permanently delete this service and terminate all associated container states and configuration."
          actionLabel="Delete Resource"
          onAction={() => setDeleteDialogOpen(true)}
          pending={isDeletingResource}
        />
      </div>

      {/* Right Column: details info */}
      <div className="min-w-0 space-y-6">
        <Card className="border border-border/40 bg-card/20">
          <CardHeader>
            <CardTitle className="font-semibold text-base">
              Service Details
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border/20 border-border/10 border-t pt-2 text-sm">
            {[
              { label: "Resource ID", value: resource.id },
              { label: "Type", value: resource.type, className: "capitalize" },
              {
                label: "Docker Swarm Status",
                value: resource.status,
                className: "capitalize font-semibold text-primary",
              },
              ...(resource.type === "database"
                ? [
                    { label: "Database", value: resource.dbType ?? "—" },
                    { label: "Image", value: resource.dockerImage ?? "—" },
                  ]
                : []),
              ...(resource.type === "compose"
                ? [
                    {
                      label: "Deployment mode",
                      value: resource.composeType ?? "stack",
                    },
                  ]
                : []),
            ].map(({ label, value, className }) => (
              <div key={label} className="flex justify-between py-2.5">
                <span className="text-muted-foreground">{label}</span>
                <span className={cn("text-right font-mono text-xs", className)}>
                  {value}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Delete Dialog */}
      <ConfirmActionDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Resource?"
        description={`Are you sure you want to delete "${resource.name}"? This permanently removes all configuration records, container states, and active service mappings. This cannot be undone.`}
        actionLabel="Delete Resource"
        requireConfirmText={true}
        pending={isDeletingResource}
        onConfirm={() => {
          deleteResource({ id: resource.id, deleteVolumes });
        }}
      >
        <div className="flex items-center space-x-2 py-2">
          <Checkbox
            id="general-delete-volumes"
            checked={deleteVolumes}
            onCheckedChange={(checked) => setDeleteVolumes(!!checked)}
          />
          <label
            htmlFor="general-delete-volumes"
            className="cursor-pointer select-none font-medium text-foreground text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Remove associated volumes
          </label>
        </div>
      </ConfirmActionDialog>

      <Dialog open={rebuildDialogOpen} onOpenChange={setRebuildDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rebuild database service?</DialogTitle>
            <DialogDescription>
              This permanently deletes the managed Docker volume for{" "}
              {resource.name}
              and all data stored in it, then deploys a clean database with the
              saved credentials. Export a backup before continuing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRebuildDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isRebuildingDatabase}
              onClick={() => {
                rebuildDatabase({ id: resource.id, confirm: true });
                setRebuildDialogOpen(false);
              }}
            >
              {isRebuildingDatabase
                ? "Rebuilding..."
                : "Delete data and rebuild"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfigureRollbackDialog
        open={configureRollbackDialogOpen}
        onOpenChange={setConfigureRollbackDialogOpen}
        resource={resource}
        organizationId={organizationState.organizationId as string}
        onSuccess={() => {
          void refetchSecrets();
        }}
      />
    </div>
  );
}
