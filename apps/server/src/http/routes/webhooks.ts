import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parseDomainMappings } from "@upstand/domain";
import { CaddyService, getDockerInstance } from "@upstand/infrastructure";
import {
  ProcessSourceWebhookUseCase,
  parseResourceCredentials,
  QueueDeploymentUseCase,
} from "@upstand/usecases";
import type { CaddyResource } from "@upstand/usecases/ports/caddy";
import { UnitOfWorkToken } from "@upstand/usecases/tokens";
import type { Context, Hono } from "hono";
import { createHttpRateLimitMiddleware } from "../rate-limit";
import type { AppEnv } from "../types";

export function registerWebhookRoutes(app: Hono<AppEnv>): void {
  app.use(
    "/api/webhooks/*",
    createHttpRateLimitMiddleware({
      path: "webhooks",
      profile: "webhooks",
      onRejected: (c, message) => c.json({ error: message }, 429),
    }),
  );

  app.post("/api/webhooks/github/:providerId", async (c) => {
    const providerId = c.req.param("providerId");
    const scope = c.get("scope");
    const uow = scope.resolve(UnitOfWorkToken);

    const provider = await uow.gitProviderRepository.findById(providerId);
    if (!provider) return c.json({ error: "Git provider not found" }, 404);

    const config = JSON.parse(provider.config);
    const webhookSecret = config.githubWebhookSecret;

    const bodyText = await c.req.text();
    const signature = c.req.header("x-hub-signature-256");

    if (!webhookSecret || !signature) {
      return c.json({ error: "Webhook signature is not configured" }, 401);
    }
    if (webhookSecret && signature) {
      const hmac = createHmac("sha256", webhookSecret);
      const digest = `sha256=${hmac.update(bodyText).digest("hex")}`;
      const trusted = Buffer.from(digest, "ascii");
      const received = Buffer.from(signature, "ascii");
      if (
        trusted.length !== received.length ||
        !timingSafeEqual(trusted, received)
      ) {
        return c.json({ error: "Invalid signature" }, 401);
      }
    }

    const event = c.req.header("x-github-event");
    if (event !== "pull_request") {
      try {
        const result = await new ProcessSourceWebhookUseCase(uow).execute({
          providerId,
          provider: "github",
          bodyText,
          headers: {
            "x-github-event": event,
            "x-hub-signature-256": signature,
          },
        });
        return c.json(result, 202);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "Invalid webhook signature") {
          return c.json({ error: message }, 401);
        }
        c.get("log").error(error instanceof Error ? error : String(error), {
          message: "GitHub webhook processing failed",
        });
        return c.json({ error: "Unable to process webhook" }, 400);
      }
    }

    const payload = JSON.parse(bodyText);
    const action = payload.action;
    const prNumber = payload.number;
    const branchName = payload.pull_request?.head?.ref;
    const repoFullName = payload.repository?.full_name;

    if (!branchName || !repoFullName || !prNumber) {
      return c.json({ error: "Invalid pull request payload" }, 400);
    }

    const allResources = await uow.resourceRepository.findMany();
    const matchedResources = [];
    for (const resource of allResources) {
      if (resource.provider !== "github") continue;
      try {
        const creds = parseResourceCredentials(resource.credentials);
        if (
          creds.repository !== repoFullName ||
          (resource.isPreviewDeploymentsActive !== true &&
            creds.enablePrPreviews !== true) ||
          creds.githubAccount !== providerId
        ) {
          continue;
        }
        const environment = await uow.environmentRepository.findById(
          resource.environmentId,
        );
        const project = environment
          ? await uow.projectRepository.findById(environment.projectId)
          : null;
        if (project?.organizationId === provider.organizationId) {
          matchedResources.push(resource);
        }
      } catch {
        // Ignore malformed resource metadata rather than failing the webhook.
      }
    }

    for (const resource of matchedResources) {
      if (action === "opened" || action === "synchronize") {
        let preview = await uow.previewDeploymentRepository.findByPullRequestId(
          resource.id,
          prNumber,
        );
        let appName = preview?.appName;
        let domain = preview?.domain;

        if (!preview) {
          const existingPreviews =
            await uow.previewDeploymentRepository.findByResourceId(resource.id);
          const previewLimit = resource.previewLimit ?? 3;
          if (
            existingPreviews.filter(
              (candidate) => candidate.status !== "failed",
            ).length >= previewLimit
          ) {
            c.get("log").warn("Preview deployment limit reached", {
              resourceId: resource.id,
              previewLimit,
            });
            continue;
          }
          const hash = randomBytes(3).toString("hex");
          appName = `pr-${prNumber}-${resource.name}-${hash}`
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "-");

          domain = `${appName}.${resource.previewWildcard || "sslip.io"}`;

          preview = await uow.previewDeploymentRepository.create({
            resourceId: resource.id,
            pullRequestId: prNumber,
            branchName,
            appName,
            status: "idle",
            domain,
          });
        } else {
          await uow.previewDeploymentRepository.updateById(preview.id, {
            status: "idle",
            branchName,
          });
        }

        await new QueueDeploymentUseCase(uow).execute({
          resourceId: resource.id,
          title: `PR #${prNumber} preview deployment (${action})`,
          previewDeploymentId: preview.id,
        });
      } else if (action === "closed") {
        const preview =
          await uow.previewDeploymentRepository.findByPullRequestId(
            resource.id,
            prNumber,
          );
        if (preview) {
          c.get("log").info(
            `Cleaning up preview deployment ${preview.appName} on PR close...`,
          );

          try {
            const docker = getDockerInstance();
            const service = docker.getService(preview.appName);
            await service.remove();
          } catch (err) {
            c.get("log").error(err instanceof Error ? err : String(err), {
              message: `Failed to remove Swarm service for preview ${preview.appName}`,
            });
          }

          await uow.previewDeploymentRepository.deleteById(preview.id);

          try {
            const [resources, settings, allPreviews] = await Promise.all([
              uow.resourceRepository.findMany(),
              uow.webServerSettingsRepository.findGlobal(),
              uow.previewDeploymentRepository.findMany(),
            ]);
            const docker = getDockerInstance();
            const caddyService = new CaddyService(docker);

            const routingResources = resources.filter(
              (candidate) =>
                !candidate.serverId ||
                candidate.serverId === "local" ||
                candidate.serverId === "manager",
            );

            const activePreviews = allPreviews.filter(
              (p) => p.status === "success",
            );
            const routingPreviews: CaddyResource[] = [];
            for (const prev of activePreviews) {
              const parent = resources.find((r) => r.id === prev.resourceId);
              if (parent) {
                const parentDomains = parseDomainMappings(parent.domains);
                const parentPort =
                  parent.previewPort || parentDomains[0]?.port || 80;
                const parentHttps =
                  parent.previewHttps || (parentDomains[0]?.https ?? false);
                const parentCert =
                  parentDomains[0]?.certificateType ?? "letsencrypt";
                const parentCertId = parentDomains[0]?.certificateId;
                const parentMiddlewares = parentDomains[0]?.middlewares ?? [];

                routingPreviews.push({
                  id: prev.id,
                  name: prev.appName,
                  type: "application",
                  appName: prev.appName,
                  domains: JSON.stringify([
                    {
                      host: prev.domain,
                      path: "/",
                      port: parentPort,
                      https: parentHttps,
                      certificateType: parentCert,
                      ...(parentCertId !== undefined && {
                        certificateId: parentCertId,
                      }),
                      middlewares: parentMiddlewares,
                    },
                  ]),
                  composeType: parent.composeType,
                  advancedConfig: parent.advancedConfig,
                });
              }
            }

            const certificates =
              (await uow.certificateRepository.findAll?.()) ?? [];
            await caddyService.syncResourceConfigs(
              [...routingResources, ...routingPreviews],
              settings || {},
              certificates,
            );
          } catch (err) {
            c.get("log").error(err instanceof Error ? err : String(err), {
              message: "Failed to sync Caddy on preview cleanup",
            });
          }
        }
      }
    }

    return c.json({ accepted: true }, 200);
  });

  async function processNonGithubWebhook(
    c: Context<AppEnv>,
    provider: "gitlab" | "gitea" | "bitbucket" | "dockerhub",
  ) {
    const providerId = c.req.param("providerId");
    if (!providerId) return c.json({ error: "Provider ID is required" }, 400);
    const bodyText = await c.req.text();
    const scope = c.get("scope");
    const uow = scope.resolve(UnitOfWorkToken);
    const headers = {
      "x-gitlab-token": c.req.header("x-gitlab-token"),
      "x-hub-signature": c.req.header("x-hub-signature"),
      "x-gitea-signature": c.req.header("x-gitea-signature"),
    };
    try {
      const result = await new ProcessSourceWebhookUseCase(uow).execute({
        providerId,
        provider,
        bodyText,
        headers,
      });
      return c.json(result, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Invalid webhook signature") {
        return c.json({ error: message }, 401);
      }
      if (message === "Git provider not found") {
        return c.json({ error: message }, 404);
      }
      c.get("log").error(error instanceof Error ? error : String(error), {
        message: `${provider} webhook processing failed`,
      });
      return c.json({ error: "Unable to process webhook" }, 400);
    }
  }

  app.post("/api/webhooks/gitlab/:providerId", (c) =>
    processNonGithubWebhook(c, "gitlab"),
  );
  app.post("/api/webhooks/gitea/:providerId", (c) =>
    processNonGithubWebhook(c, "gitea"),
  );
  app.post("/api/webhooks/bitbucket/:providerId", (c) =>
    processNonGithubWebhook(c, "bitbucket"),
  );
  app.post("/api/webhooks/dockerhub/:providerId", (c) =>
    processNonGithubWebhook(c, "dockerhub"),
  );
}
