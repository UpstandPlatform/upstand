import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import { parseResourceCredentials } from "../resource/resource-credentials";
import {
  optionalGitProviderString,
  parseGitProviderConfig,
  requiredGitProviderString,
} from "./git-provider-config";
import { getInstallationToken, signJwtRs256 } from "./github-client";
import type {
  GitHubDiagnosticsPort,
  GitHubRepositoryInspection,
} from "./github-diagnostics.port";

export const RunGitHubDiagnosticsInputSchema = z.object({
  organizationId: z.string().min(1),
  gitProviderId: z.string().min(1),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  ref: z.string().min(1).max(255).optional(),
  resourceId: z.string().min(1).optional(),
});

export type RunGitHubDiagnosticsInput = z.infer<
  typeof RunGitHubDiagnosticsInputSchema
>;

export type GitHubDiagnosticCheck = {
  code: string;
  status: "pass" | "warn" | "fail";
  summary: string;
  action?: string;
  details?: Record<string, string | number | boolean | null>;
};

function check(
  code: string,
  status: GitHubDiagnosticCheck["status"],
  summary: string,
  action?: string,
  details?: GitHubDiagnosticCheck["details"],
): GitHubDiagnosticCheck {
  return {
    code,
    status,
    summary,
    ...(action ? { action } : {}),
    ...(details ? { details } : {}),
  };
}

export class RunGitHubDiagnosticsUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly diagnostics: GitHubDiagnosticsPort,
    private readonly replayProtectionReady: () => Promise<boolean>,
  ) {}

  async execute(input: RunGitHubDiagnosticsInput): Promise<{
    repository: string;
    ref: string;
    ready: boolean;
    checks: GitHubDiagnosticCheck[];
  }> {
    const parsed = RunGitHubDiagnosticsInputSchema.parse(input);
    const provider = await this.uow.gitProviderRepository.findById(
      parsed.gitProviderId,
    );
    if (!provider || provider.organizationId !== parsed.organizationId) {
      throw new Error("Git provider not found");
    }
    if (provider.provider !== "github") {
      throw new Error("GitHub diagnostics require a GitHub provider");
    }

    const checks: GitHubDiagnosticCheck[] = [];
    const config = parseGitProviderConfig(provider);
    const [owner, repository] = parsed.repository.split("/") as [
      string,
      string,
    ];
    const requestedRef = parsed.ref ?? "";
    const pat =
      optionalGitProviderString(config, "personalAccessToken") ??
      optionalGitProviderString(config, "accessToken");
    let token: string;
    let appJwt: string | undefined;
    try {
      if (pat) {
        token = pat;
        checks.push(
          check(
            "GH_AUTH_TOKEN_VALID",
            "pass",
            "A configured GitHub token is available for diagnostics.",
          ),
        );
      } else {
        const appId = String(config.githubAppId ?? "");
        if (!appId) throw new Error("GitHub App ID is not configured");
        const privateKey = requiredGitProviderString(
          config,
          "githubPrivateKey",
        );
        const installationId = requiredGitProviderString(
          config,
          "githubInstallationId",
        );
        appJwt = signJwtRs256({}, privateKey, appId);
        token = await getInstallationToken(appId, privateKey, installationId);
        checks.push(
          check(
            "GH_APP_INSTALLATION_VALID",
            "pass",
            "GitHub App installation authentication succeeded.",
          ),
        );
      }
    } catch {
      checks.push(
        check(
          "GH_AUTH_FAILED",
          "fail",
          "GitHub authentication could not be completed.",
          "Reconnect the provider and verify the App installation or token permissions.",
        ),
      );
      return {
        repository: parsed.repository,
        ref: requestedRef || "default",
        ready: false,
        checks,
      };
    }

    let inspection: GitHubRepositoryInspection;
    try {
      inspection = await this.diagnostics.inspect({
        token,
        appJwt,
        owner,
        repository,
        ref: requestedRef,
      });
    } catch {
      checks.push(
        check(
          "GH_REPOSITORY_UNREACHABLE",
          "fail",
          "The repository could not be inspected with the configured identity.",
          "Verify repository selection, installation access, and GitHub availability.",
        ),
      );
      return {
        repository: parsed.repository,
        ref: requestedRef || "default",
        ready: false,
        checks,
      };
    }

    const resolvedRef = requestedRef || inspection.repository.defaultBranch;
    checks.push(
      check(
        "GH_REPOSITORY_ACCESS_VALID",
        "pass",
        "Repository metadata is accessible.",
        undefined,
        { repository: inspection.repository.fullName },
      ),
    );
    checks.push(
      inspection.repository.permissions.pull
        ? check(
            "GH_REPOSITORY_PERMISSIONS_VALID",
            "pass",
            "Repository contents can be read.",
            undefined,
            {
              push: inspection.repository.permissions.push,
              admin: inspection.repository.permissions.admin,
            },
          )
        : check(
            "GH_REPOSITORY_PERMISSION_DENIED",
            "fail",
            "Repository contents are not readable.",
            "Grant repository contents read permission to the GitHub App or token.",
          ),
    );
    checks.push(
      inspection.ref
        ? check(
            "GH_REF_RESOLVED",
            "pass",
            "The deployment ref resolves to an immutable commit.",
            undefined,
            { ref: resolvedRef, commit: inspection.ref.sha.slice(0, 12) },
          )
        : check(
            "GH_REF_NOT_FOUND",
            "fail",
            "The requested branch, tag, or commit could not be resolved.",
            "Select an existing ref and retry diagnostics.",
            { ref: resolvedRef },
          ),
    );
    checks.push(
      inspection.repository.cloneProtocol === "https" &&
        inspection.repository.permissions.pull
        ? check(
            "GH_CLONE_AUTH_VALID",
            "pass",
            "The repository exposes an authenticated HTTPS clone path.",
          )
        : check(
            "GH_CLONE_AUTH_UNSUPPORTED",
            "fail",
            "An authenticated HTTPS clone path is not available.",
            "Enable repository contents access and use the HTTPS clone URL.",
          ),
    );
    checks.push(
      inspection.webhook?.configured && inspection.webhook.active
        ? check(
            "GH_WEBHOOK_REACHABLE",
            "pass",
            "The configured GitHub webhook is active.",
            undefined,
            inspection.webhook.host
              ? { host: inspection.webhook.host }
              : undefined,
          )
        : check(
            "GH_WEBHOOK_UNVERIFIED",
            "warn",
            "GitHub did not expose an active webhook configuration to this identity.",
            "Verify the GitHub App webhook URL and send a test delivery before cutover.",
          ),
    );
    checks.push(
      optionalGitProviderString(config, "githubWebhookSecret")
        ? check(
            "GH_WEBHOOK_SIGNATURE_CONFIGURED",
            "pass",
            "Webhook signature verification is configured.",
          )
        : check(
            "GH_WEBHOOK_SIGNATURE_MISSING",
            "fail",
            "Webhook signature verification is not configured.",
            "Reconnect the GitHub App to provision a webhook secret.",
          ),
    );
    checks.push(
      (await this.replayProtectionReady())
        ? check(
            "GH_WEBHOOK_REPLAY_PROTECTION_READY",
            "pass",
            "The durable webhook replay store is reachable.",
          )
        : check(
            "GH_WEBHOOK_REPLAY_STORE_UNAVAILABLE",
            "fail",
            "Webhook replay protection is unavailable.",
            "Restore Redis before accepting GitHub deliveries.",
          ),
    );
    const remaining = inspection.rateLimit.remaining;
    checks.push(
      remaining === null || remaining > 100
        ? check(
            "GH_RATE_LIMIT_HEALTHY",
            "pass",
            "GitHub API rate-limit capacity is healthy.",
            undefined,
            { remaining, resetAt: inspection.rateLimit.resetAt },
          )
        : check(
            "GH_RATE_LIMIT_LOW",
            remaining === 0 ? "fail" : "warn",
            "GitHub API rate-limit capacity is low.",
            "Wait for the reset or reduce diagnostic/deployment request volume.",
            { remaining, resetAt: inspection.rateLimit.resetAt },
          ),
    );
    checks.push(await this.deploymentMatchCheck(parsed, resolvedRef));

    return {
      repository: inspection.repository.fullName,
      ref: resolvedRef,
      ready: checks.every((item) => item.status !== "fail"),
      checks,
    };
  }

  private async deploymentMatchCheck(
    input: RunGitHubDiagnosticsInput,
    resolvedRef: string,
  ): Promise<GitHubDiagnosticCheck> {
    if (!input.resourceId) {
      return check(
        "GH_DEPLOYMENT_MATCH_UNSCOPED",
        "warn",
        "No resource was supplied for deployment matching.",
        "Run diagnostics with --resource-id to validate the saved repository and ref.",
      );
    }
    const resource = await this.uow.resourceRepository.findById(
      input.resourceId,
    );
    if (!resource) {
      return check(
        "GH_DEPLOYMENT_RESOURCE_NOT_FOUND",
        "fail",
        "The deployment resource was not found.",
      );
    }
    const environment = await this.uow.environmentRepository.findById(
      resource.environmentId,
    );
    const project = environment
      ? await this.uow.projectRepository.findById(environment.projectId)
      : null;
    if (!project || project.organizationId !== input.organizationId) {
      return check(
        "GH_DEPLOYMENT_RESOURCE_NOT_FOUND",
        "fail",
        "The deployment resource was not found.",
      );
    }
    const credentials = parseResourceCredentials(resource.credentials);
    const repositoryUrl = String(credentials.repositoryUrl ?? "");
    const configuredRef = String(credentials.branch ?? "");
    const expectedSuffix = `/${input.repository}.git`;
    const repositoryMatches =
      repositoryUrl.endsWith(expectedSuffix) ||
      repositoryUrl.endsWith(expectedSuffix.slice(0, -4));
    const refMatches = !configuredRef || configuredRef === resolvedRef;
    return repositoryMatches && refMatches
      ? check(
          "GH_DEPLOYMENT_MATCH_VALID",
          "pass",
          "The resource repository and ref match this diagnostic target.",
        )
      : check(
          "GH_DEPLOYMENT_MATCH_MISMATCH",
          "fail",
          "The resource repository or ref does not match this diagnostic target.",
          "Update the resource source configuration before deploying.",
        );
  }
}
