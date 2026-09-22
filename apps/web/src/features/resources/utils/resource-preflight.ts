import {
  isSupportedDatabaseImage,
  isValidDockerImageReference,
  ResourceAdvancedConfigSchema,
  type Server,
} from "@upstand/domain";
import { parseResourceCredentials } from "../components/general-tab.helpers";

export interface PreflightError {
  id: string;
  category: "source" | "server" | "advanced";
  title: string;
  message: string;
  actionableTip: string;
}

export interface GitProviderItem {
  id: string;
  name: string;
  provider: string;
}

const GIT_SOURCE_PROVIDERS = new Set([
  "github",
  "gitlab",
  "bitbucket",
  "gitea",
]);

export function getResourcePreflightErrors(
  resource: Record<string, any> | null | undefined,
  secrets: { credentials?: string } | null | undefined,
  servers: (Server | Record<string, any>)[],
  gitProviders: (GitProviderItem | Record<string, any>)[],
  options?: {
    isCloud?: boolean;
    platformMode?: "desktop" | "self-hosted" | "cloud";
  },
): PreflightError[] {
  if (!resource) return [];

  const errors: PreflightError[] = [];
  const credentials = parseResourceCredentials(secrets?.credentials);
  const requiresRemoteTarget =
    options?.isCloud === true || options?.platformMode === "desktop";

  // 1. Source Availability & Validation
  if (resource.type === "database") {
    if (!resource.dbType) {
      errors.push({
        id: "source-db-type",
        category: "source",
        title: "Database Type Not Selected",
        message:
          "This database resource does not have a database engine selected.",
        actionableTip:
          "Go to General settings and select a database type (e.g., PostgreSQL, Redis, MongoDB).",
      });
    } else if (
      !isSupportedDatabaseImage(resource.dbType, resource.dockerImage, true)
    ) {
      errors.push({
        id: "source-db-image",
        category: "source",
        title: "Invalid Database Docker Image",
        message: `The database image "${resource.dockerImage ?? ""}" is invalid or incompatible with ${resource.dbType}.`,
        actionableTip:
          "Go to General settings and pick a supported database image version.",
      });
    }
  } else if (resource.type === "compose") {
    if (resource.provider === "raw") {
      const composeFile = credentials?.composeFile;
      if (
        !composeFile ||
        typeof composeFile !== "string" ||
        !composeFile.trim()
      ) {
        errors.push({
          id: "source-compose-empty",
          category: "source",
          title: "Docker Compose Specification Missing",
          message:
            "No Docker Compose definition has been provided for this resource.",
          actionableTip:
            "Go to General settings and paste your docker-compose.yml content before deploying.",
        });
      }
    } else if (resource.provider === "git") {
      const repoUrl = credentials?.repositoryUrl;
      if (!repoUrl || typeof repoUrl !== "string" || !repoUrl.trim()) {
        errors.push({
          id: "source-compose-git-url",
          category: "source",
          title: "Repository URL Missing",
          message:
            "No Git repository URL is configured for this Compose resource.",
          actionableTip:
            "Go to General settings and specify a valid Git repository URL.",
        });
      }
    } else if (
      GIT_SOURCE_PROVIDERS.has(resource.provider) ||
      resource.provider === "generic"
    ) {
      const providerId = credentials?.githubAccount;
      const repo = credentials?.repository;
      if (!providerId || typeof providerId !== "string" || !providerId.trim()) {
        errors.push({
          id: "source-compose-provider-missing",
          category: "source",
          title: "Git Provider Connection Missing",
          message:
            "No Git Provider account is connected for this Compose resource.",
          actionableTip:
            "Go to General settings and select a connected Git Provider account.",
        });
      } else if (!gitProviders.some((gp) => gp.id === providerId)) {
        errors.push({
          id: "source-compose-provider-not-found",
          category: "source",
          title: "Associated Git Account Not Found",
          message: "The connected Git account is missing or was removed.",
          actionableTip:
            "Go to General settings and select a valid Git Provider connection.",
        });
      }
      if (!repo || typeof repo !== "string" || !repo.trim()) {
        errors.push({
          id: "source-compose-repo-missing",
          category: "source",
          title: "Repository Not Selected",
          message: "No Git repository is selected for this Compose resource.",
          actionableTip: "Go to General settings and choose a repository.",
        });
      }
    }
  } else {
    // Application type
    // Hosted Git-provider tabs are intentionally unavailable in the desktop
    // runtime. Treat a legacy persisted hosted source as a local-folder draft
    // in preflight so the user gets an actionable local-path error instead of
    // being sent to a Git-provider screen that cannot exist on this runtime.
    const applicationProvider =
      options?.platformMode === "desktop" &&
      GIT_SOURCE_PROVIDERS.has(resource.provider)
        ? "local"
        : resource.provider;
    if (
      applicationProvider === "docker-registry" ||
      applicationProvider === "docker"
    ) {
      if (
        !resource.dockerImage ||
        !isValidDockerImageReference(resource.dockerImage)
      ) {
        errors.push({
          id: "source-app-docker-image",
          category: "source",
          title: "Docker Image Reference Missing or Invalid",
          message: resource.dockerImage
            ? `The Docker image reference "${resource.dockerImage}" contains invalid characters.`
            : "No Docker image reference has been specified for this application.",
          actionableTip:
            "Go to General settings and specify a valid Docker image (e.g., nginx:alpine or ghcr.io/org/app:v1).",
        });
      }
    } else if (applicationProvider === "local") {
      const localPath = credentials?.localPath;
      if (!localPath || typeof localPath !== "string" || !localPath.trim()) {
        errors.push({
          id: "source-app-local-path",
          category: "source",
          title: "Local Project Path Missing",
          message:
            "No local project folder has been selected for this application.",
          actionableTip:
            "Go to General settings and select or enter the local project folder.",
        });
      }
    } else if (applicationProvider === "drop") {
      // The uploaded archive is validated by the deployment worker when the
      // user starts a deployment.
    } else if (GIT_SOURCE_PROVIDERS.has(applicationProvider)) {
      const providerId = credentials?.githubAccount;
      const repo = credentials?.repository;
      if (!providerId || typeof providerId !== "string" || !providerId.trim()) {
        errors.push({
          id: "source-app-provider-missing",
          category: "source",
          title: "Git Provider Connection Not Selected",
          message:
            "No Git provider account connection is assigned to this application.",
          actionableTip:
            "Go to General settings and select a Git account connection.",
        });
      } else if (!gitProviders.some((gp) => gp.id === providerId)) {
        errors.push({
          id: "source-app-provider-not-found",
          category: "source",
          title: "Associated Git Provider Connection Not Found",
          message:
            "The configured Git account connection does not exist or has been deleted.",
          actionableTip:
            "Go to General settings and pick an existing Git Provider connection.",
        });
      }
      if (!repo || typeof repo !== "string" || !repo.trim()) {
        errors.push({
          id: "source-app-repo-missing",
          category: "source",
          title: "Git Repository Not Selected",
          message: "No Git repository is selected for deployment.",
          actionableTip: "Go to General settings and select a repository.",
        });
      }
    } else if (applicationProvider === "git") {
      const repoUrl = credentials?.repositoryUrl;
      if (!repoUrl || typeof repoUrl !== "string" || !repoUrl.trim()) {
        errors.push({
          id: "source-app-git-url",
          category: "source",
          title: "Git Repository URL Missing",
          message: "No Git repository URL has been provided for this resource.",
          actionableTip:
            "Go to General settings and enter a valid Git clone URL.",
        });
      }
    }
  }

  // 2. Server Configuration & Credentials
  if (
    requiresRemoteTarget &&
    (!resource.serverId || ["local", "manager"].includes(resource.serverId))
  ) {
    errors.push({
      id: "server-unassigned",
      category: "server",
      title: "Deployment Server Unassigned",
      message:
        "Desktop and cloud runtimes require a configured remote deployment server.",
      actionableTip:
        "Go to General settings and select a deployment server target.",
    });
  } else if (
    resource.serverId &&
    !["local", "manager"].includes(resource.serverId)
  ) {
    const targetServer = servers.find((s) => s.id === resource.serverId);
    if (!targetServer) {
      errors.push({
        id: "server-not-found",
        category: "server",
        title: "Target Server Not Found",
        message: `The assigned deployment server (ID: ${resource.serverId}) could not be found in your organization's infrastructure.`,
        actionableTip:
          "Go to General settings and assign a valid remote server or Local Docker.",
      });
    } else {
      if (targetServer.status !== "ready") {
        errors.push({
          id: "server-not-ready",
          category: "server",
          title: `Target Server '${targetServer.name}' Is Not Ready`,
          message: `The server status is currently "${targetServer.status}". Resources cannot be deployed until server setup completes successfully.`,
          actionableTip:
            "Go to Remote Servers and complete server setup/provisioning.",
        });
      }

      const isPasswordAuth =
        targetServer.authType === "password" ||
        (!targetServer.sshKeyId && Boolean(targetServer.passwordCiphertext));

      if (isPasswordAuth) {
        if (
          !targetServer.passwordCiphertext ||
          !targetServer.passwordIv ||
          !targetServer.passwordAuthTag ||
          targetServer.passwordVersion == null
        ) {
          errors.push({
            id: "server-password-missing",
            category: "server",
            title: `Password Credentials Missing for Server '${targetServer.name}'`,
            message:
              "The server is configured for Password authentication, but no password credentials were found.",
            actionableTip:
              "Go to Remote Servers, edit this server, and update its SSH password.",
          });
        }
      } else {
        if (!targetServer.sshKeyId) {
          errors.push({
            id: "server-ssh-key-missing",
            category: "server",
            title: `No SSH Key Attached for Server '${targetServer.name}'`,
            message:
              "The server is configured for SSH Key authentication, but no SSH key is selected.",
            actionableTip:
              "Go to Remote Servers, edit this server, and select an SSH key.",
          });
        }
      }

      if (!targetServer.sshHostKeyFingerprint) {
        errors.push({
          id: "server-fingerprint-missing",
          category: "server",
          title: `SSH Host Key Fingerprint Untrusted for Server '${targetServer.name}'`,
          message:
            "The server's SSH host key has not been verified or trusted yet.",
          actionableTip:
            "Go to Remote Servers, click Test Connection or Setup to trust the server's SSH fingerprint.",
        });
      }
    }
  }

  // 3. Advanced Settings Validation
  if (resource.advancedConfig) {
    try {
      const parsedRaw: unknown = JSON.parse(resource.advancedConfig);
      const parsedConfig = ResourceAdvancedConfigSchema.safeParse(parsedRaw);
      if (!parsedConfig.success) {
        errors.push({
          id: "advanced-config-invalid",
          category: "advanced",
          title: "Advanced Configuration Invalid",
          message:
            "The resource's advanced configuration does not match the expected schema.",
          actionableTip:
            "Go to the Advanced tab, review the errors, and save a valid configuration.",
        });
      }
    } catch {
      errors.push({
        id: "advanced-config-json",
        category: "advanced",
        title: "Advanced Settings Syntax Error",
        message: "The resource's advanced settings JSON string is malformed.",
        actionableTip:
          "Go to the Advanced tab and fix the JSON syntax under the Raw JSON sub-tab.",
      });
    }
  }

  return errors;
}
