import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { auth } from "@upstand/api/auth";
import { requireInstanceOwner } from "@upstand/api/instance-access";
import { checkPermission } from "@upstand/api/permissions";
import { redis, withRedisTimeout } from "@upstand/redis";
import {
  hashWebhookToken,
  matchesDockerImageWebhook,
  parseResourceCredentials,
  QueueDeploymentUseCase,
  UploadDockerContainerInputSchema,
  UploadDockerVolumeInputSchema,
} from "@upstand/usecases";
import {
  GetDockerInventoryUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  ApplicationArchiveValidationError,
  extractApplicationArchive,
  validateApplicationArchiveFile,
} from "../../application-archive";
import { isStepUpAuthenticationSatisfied } from "../../step-up-auth";
import { logRequestError } from "../error-logging";
import { createHttpRateLimitMiddleware } from "../rate-limit";
import type { AppEnv } from "../types";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const uploadBodyLimit = bodyLimit({
  maxSize: MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES,
  onError: (c) =>
    c.json({ error: "Archive exceeds the 50 MB upload limit" }, 413),
});

async function validateSafeTarArchive(
  buffer: Buffer,
  uploadTypeName: string,
): Promise<string | null> {
  const tempArchive = path.join(
    process.cwd(),
    ".builds",
    `${uploadTypeName}-upload-${randomUUID()}.tar`,
  );
  fs.mkdirSync(path.dirname(tempArchive), { recursive: true });
  fs.writeFileSync(tempArchive, buffer);
  try {
    await validateApplicationArchiveFile(tempArchive);
    return null;
  } catch (error) {
    if (error instanceof ApplicationArchiveValidationError) {
      return `${uploadTypeName} archive rejected: ${error.message}`;
    }
    return `${uploadTypeName} archive could not be validated`;
  } finally {
    fs.rmSync(tempArchive, { force: true });
  }
}

const DeploymentWebhookPayloadSchema = z
  .object({
    ref: z.string().optional(),
    branch: z.string().optional(),
    repository: z
      .object({
        repo_name: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    push_data: z.object({ tag: z.string().optional() }).optional(),
  })
  .passthrough();

export function registerDeploymentRoutes(app: Hono<AppEnv>): void {
  app.use(
    "/api/deploy/*",
    createHttpRateLimitMiddleware({
      path: "deployment-webhook",
      profile: "webhooks",
      onRejected: (c, message) => c.json({ error: message }, 429),
    }),
  );
  app.use(
    "/api/deploy/*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json({ error: "Webhook payload is too large" }, 413),
    }),
  );

  // Public, tokenized deployment hook used by GitHub Actions and external CI.
  // Only a SHA-256 digest is persisted; the URL token is never recoverable from
  // the database and must be rotated if it is lost.
  app.post("/api/deploy/:token", async (c) => {
    const requestLog = c.get("log");
    const token = c.req.param("token");
    if (!token?.startsWith("upw_") || token.length < 12) {
      return c.json({ error: "Invalid deployment webhook" }, 404);
    }
    const scope = c.get("scope");
    const uow = scope.resolve(UnitOfWorkToken);
    const resource = await uow.resourceRepository.findByWebhookTokenHash(
      hashWebhookToken(token),
    );
    if (!resource) return c.json({ error: "Resource not found" }, 404);
    const resourceId = resource.id;

    let autoDeploy = false;
    try {
      const credentials = parseResourceCredentials(resource.credentials);
      autoDeploy = credentials?.autoDeploy !== false;
    } catch {
      autoDeploy = false;
    }
    if (!autoDeploy) {
      return c.json({ error: "Automatic deployment is disabled" }, 403);
    }

    const rawBody = await c.req.text();
    let payload: z.infer<typeof DeploymentWebhookPayloadSchema> = {};
    if (rawBody) {
      let body: unknown = {};
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        return c.json({ error: "Invalid deployment webhook payload" }, 400);
      }
      const parsed = DeploymentWebhookPayloadSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "Invalid deployment webhook payload" }, 400);
      }
      payload = parsed.data;
    }

    const deliveryId =
      c.req.header("x-webhook-delivery") ||
      c.req.header("idempotency-key") ||
      createHash("sha256").update(`${resource.id}:${rawBody}`).digest("hex");
    let acceptedDelivery: string | null = null;
    try {
      acceptedDelivery = await withRedisTimeout(
        redis.set(
          `deployment-webhook:${resource.id}:${deliveryId}`,
          "1",
          "EX",
          300,
          "NX",
        ),
      );
    } catch (error) {
      logRequestError(c.get("log"), error, {
        message: "Deployment webhook replay store unavailable",
        resourceId,
      });
      return c.json(
        { error: "Deployment webhook temporarily unavailable" },
        503,
      );
    }
    if (acceptedDelivery !== "OK") {
      return c.json({ accepted: true, duplicate: true }, 202);
    }
    if (resource.provider === "docker-registry") {
      const repository =
        typeof payload?.repository?.repo_name === "string"
          ? payload.repository.repo_name
          : typeof payload?.repository?.name === "string"
            ? payload.repository.name
            : undefined;
      const tag =
        typeof payload?.push_data?.tag === "string"
          ? payload.push_data.tag
          : undefined;
      if (
        repository &&
        !matchesDockerImageWebhook(resource.dockerImage || "", repository, tag)
      ) {
        return c.json(
          { error: "Docker image does not match this resource" },
          409,
        );
      }
    }
    const branch =
      typeof payload?.ref === "string" ? payload.ref : payload?.branch;
    const title = branch
      ? `Webhook deployment (${String(branch).slice(0, 120)})`
      : "Webhook deployment";
    const deploymentId = `dep-${randomUUID()}`;
    try {
      const queued = await new QueueDeploymentUseCase(uow).execute({
        resourceId,
        correlationId: c.get("correlationId"),
        title,
        deploymentId,
      });
      return c.json(
        {
          accepted: true,
          resourceId,
          status: queued.status,
          deploymentId,
        },
        202,
      );
    } catch (error) {
      logRequestError(requestLog, error, {
        message: "Failed to queue deployment webhook",
        resourceId,
      });
      return c.json({ error: "Unable to queue deployment" }, 500);
    }
  });

  app.post("/api/resources/:resourceId/upload", uploadBodyLimit, async (c) => {
    const requestLog = c.get("log");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Authentication required" }, 401);
    if (!(await isStepUpAuthenticationSatisfied(session))) {
      return c.json({ error: "2FA verification required" }, 403);
    }

    const resourceId = c.req.param("resourceId");
    const scope = c.get("scope");
    const uow = scope.resolve(UnitOfWorkToken);

    const resourceRecord = await uow.resourceRepository.findById(resourceId);
    if (!resourceRecord) return c.json({ error: "Resource not found" }, 404);

    const environment = await uow.environmentRepository.findById(
      resourceRecord.environmentId,
    );
    if (!environment) return c.json({ error: "Environment not found" }, 404);

    const project = await uow.projectRepository.findById(environment.projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);

    await checkPermission(
      session.user.id,
      project.organizationId,
      "resource:update",
    );

    const body = await c.req.parseBody();
    const file = body.file;
    if (!file || typeof file === "string") {
      return c.json({ error: "Upload payload ('file') is required" }, 400);
    }

    const filename = file.name.toLowerCase();
    if (
      !filename.endsWith(".tar") &&
      !filename.endsWith(".tar.gz") &&
      !filename.endsWith(".tgz")
    ) {
      return c.json(
        { error: "Only .tar, .tar.gz, and .tgz archives are supported" },
        400,
      );
    }

    const tempDir = path.join(process.cwd(), ".builds", "temp");
    fs.mkdirSync(tempDir, { recursive: true });
    const archivePath = path.join(
      tempDir,
      `upload-${resourceRecord.id}-${randomUUID()}.archive`,
    );

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      return c.json({ error: "Archive exceeds the 50MB upload limit" }, 413);
    }
    fs.writeFileSync(archivePath, buffer);
    const dropsDir = path.join(
      process.cwd(),
      ".builds",
      "drops",
      resourceRecord.id,
    );

    try {
      await extractApplicationArchive(archivePath, dropsDir);
    } catch (error) {
      const status =
        error instanceof ApplicationArchiveValidationError ? 400 : 500;
      logRequestError(requestLog, error, {
        message: "Application archive extraction failed",
        resourceId,
        status,
      });
      return c.json(
        {
          error:
            error instanceof ApplicationArchiveValidationError
              ? error.message
              : "Archive extraction failed",
        },
        status,
      );
    } finally {
      fs.rmSync(archivePath, { force: true });
    }

    await uow.resourceRepository.updateById(resourceId, {
      provider: "drop",
    });

    const deploymentId = `dep-${randomUUID()}`;
    try {
      const queued = await new QueueDeploymentUseCase(uow).execute({
        resourceId,
        correlationId: c.get("correlationId"),
        title: "Archive upload deployment",
        deploymentId,
      });
      return c.json(
        {
          accepted: true,
          resourceId,
          status: queued.status,
          deploymentId,
        },
        202,
      );
    } catch (error) {
      logRequestError(requestLog, error, {
        message: "Failed to trigger deployment queue after archive upload",
        resourceId,
      });
      return c.json({ error: "Failed to trigger deployment queue" }, 500);
    }
  });

  app.post(
    "/api/docker/volumes/:volumeName/upload",
    uploadBodyLimit,
    async (c) => {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session) return c.json({ error: "Authentication required" }, 401);

      const organizationId = c.req.query("organizationId");
      if (!organizationId) {
        return c.json({ error: "organizationId is required" }, 400);
      }
      try {
        await checkPermission(session.user.id, organizationId, "server:update");
      } catch {
        return c.json({ error: "Docker volume upload is not permitted" }, 403);
      }
      if (!(await isStepUpAuthenticationSatisfied(session))) {
        return c.json({ error: "2FA verification required" }, 403);
      }
      const serverId = c.req.query("serverId") || undefined;
      if (!serverId || serverId === "local" || serverId === "manager") {
        try {
          await requireInstanceOwner(session.user.id, "session");
        } catch {
          return c.json(
            { error: "Local Docker volume upload requires instance ownership" },
            403,
          );
        }
      }

      const body = await c.req.parseBody();
      const file = body.file;
      if (!file || typeof file === "string") {
        return c.json({ error: "Upload payload ('file') is required" }, 400);
      }
      if (!file.name.toLowerCase().endsWith(".tar")) {
        return c.json(
          { error: "Only uncompressed .tar archives are supported" },
          400,
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.byteLength > MAX_UPLOAD_BYTES) {
        return c.json({ error: "Volume archives must not exceed 50 MB" }, 413);
      }

      const archiveError = await validateSafeTarArchive(buffer, "volume");
      if (archiveError) return c.json({ error: archiveError }, 400);

      const parsed = UploadDockerVolumeInputSchema.parse({
        organizationId,
        serverId,
        volumeName: c.req.param("volumeName"),
        destination: c.req.query("destination") || "/",
      });
      const result = await c
        .get("scope")
        .resolve(GetDockerInventoryUseCaseToken)
        .uploadVolume(parsed, buffer);
      return c.json(result, 201);
    },
  );

  app.post(
    "/api/resources/:resourceId/containers/:containerId/upload",
    uploadBodyLimit,
    async (c) => {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session) return c.json({ error: "Authentication required" }, 401);
      if (!(await isStepUpAuthenticationSatisfied(session))) {
        return c.json({ error: "2FA verification required" }, 403);
      }

      const organizationId = c.req.query("organizationId");
      if (!organizationId) {
        return c.json({ error: "Organization ID is required" }, 400);
      }
      const resourceId = c.req.param("resourceId");

      const scope = c.get("scope");
      const uow = scope.resolve(UnitOfWorkToken);
      const resource = await uow.resourceRepository.findById(resourceId);
      if (!resource) return c.json({ error: "Resource not found" }, 404);
      const environment = await uow.environmentRepository.findById(
        resource.environmentId,
      );
      const project = environment
        ? await uow.projectRepository.findById(environment.projectId)
        : null;
      if (!project || project.organizationId !== organizationId) {
        return c.json(
          { error: "Resource is not part of this organization" },
          403,
        );
      }

      try {
        await checkPermission(
          session.user.id,
          organizationId,
          "resource:update",
        );
      } catch {
        return c.json({ error: "Resource update permission is required" }, 403);
      }

      const formData = await c.req.formData().catch(() => null);
      const file = formData?.get("file");
      if (!(file instanceof File)) {
        return c.json({ error: "Archive file is required" }, 400);
      }
      if (!file.name.endsWith(".tar")) {
        return c.json(
          { error: "Only uncompressed .tar archives are supported" },
          400,
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.byteLength > MAX_UPLOAD_BYTES) {
        return c.json(
          { error: "Container archives must not exceed 50 MB" },
          413,
        );
      }

      const containerArchiveError = await validateSafeTarArchive(
        buffer,
        "container",
      );
      if (containerArchiveError)
        return c.json({ error: containerArchiveError }, 400);

      const parsed = UploadDockerContainerInputSchema.parse({
        organizationId,
        resourceId,
        serverId: c.req.query("serverId") || undefined,
        containerId: c.req.param("containerId"),
        destination: c.req.query("destination") || "/",
      });
      const result = await c
        .get("scope")
        .resolve(GetDockerInventoryUseCaseToken)
        .uploadContainer(parsed, buffer);
      return c.json(result, 201);
    },
  );
}
