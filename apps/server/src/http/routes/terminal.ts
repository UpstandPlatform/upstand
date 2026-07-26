import { auth } from "@upstand/api/auth";
import { checkPermission } from "@upstand/api/permissions";
import { env } from "@upstand/env/server";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import {
  GetDockerInventoryUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import type { Context, Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import {
  containerBelongsToResource,
  isValidContainerIdentifier,
  matchesContainerIdentifier,
} from "../../container-ownership";
import { isStepUpAuthenticationSatisfied } from "../../step-up-auth";
import { matchesTerminalSession, terminalBroker } from "../../terminal-broker";
import type { AppEnv } from "../types";

export function registerTerminalRoutes(app: Hono<AppEnv>): void {
  app.post("/api/terminal/session", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Authentication required" }, 401);
    if (!(await isStepUpAuthenticationSatisfied(session))) {
      return c.json({ error: "2FA verification required" }, 403);
    }

    const body = (await c.req.json().catch(() => null)) as {
      organizationId?: string;
      sshKeyId?: string;
      username?: string;
      port?: number;
      serverId?: string;
    } | null;
    if (!body?.organizationId) {
      return c.json({ error: "Organization is required" }, 400);
    }

    const scope = c.get("scope");
    const uow = scope.resolve(UnitOfWorkToken);
    try {
      await checkPermission(
        session.user.id,
        body.organizationId,
        "server:update",
      );
    } catch {
      return c.json({ error: "Server terminal permission is required" }, 403);
    }

    let host: string;
    let port: number;
    let username: string;
    let privateKey: string;
    let hostKeyFingerprint: string;

    if (body.serverId) {
      const server = await uow.serverRepository.findById(body.serverId);
      if (!server || server.organizationId !== body.organizationId) {
        return c.json({ error: "Server not found in this organization" }, 404);
      }
      if (!server.sshKeyId) {
        return c.json(
          { error: "Server does not have an SSH key configured" },
          409,
        );
      }
      if (!server.sshHostKeyFingerprint) {
        return c.json({ error: "Trust the server SSH host key first" }, 409);
      }
      const key = await uow.sshKeyRepository.findById(server.sshKeyId);
      if (!key) {
        return c.json({ error: "Configured SSH key not found" }, 404);
      }
      host = server.ipAddress;
      port = server.port;
      username = server.username;
      privateKey = decryptSecret({
        ciphertext: key.privateKeyCiphertext,
        iv: key.privateKeyIv,
        authTag: key.privateKeyAuthTag,
        keyVersion: key.privateKeyVersion,
      });
      hostKeyFingerprint = server.sshHostKeyFingerprint;
    } else {
      if (!body.sshKeyId) {
        return c.json(
          { error: "SSH key is required for control-plane terminal" },
          400,
        );
      }
      const [key, settings] = await Promise.all([
        uow.sshKeyRepository.findById(body.sshKeyId),
        uow.webServerSettingsRepository.findGlobal(),
      ]);
      if (!key || key.organizationId !== body.organizationId) {
        return c.json(
          { error: "SSH key was not found in this organization" },
          404,
        );
      }
      if (!settings?.serverIp) {
        return c.json(
          {
            error: "Set the control-plane server IP before opening a terminal",
          },
          409,
        );
      }
      const controlPlaneFingerprint =
        env.UPSTAND_CONTROL_PLANE_SSH_HOST_KEY_FINGERPRINT;
      if (!controlPlaneFingerprint) {
        return c.json(
          {
            error:
              "Configure the trusted control-plane SSH host fingerprint first",
          },
          409,
        );
      }
      host = settings.serverIp;
      port = body.port && Number.isInteger(body.port) ? body.port : 22;
      username = body.username?.trim() || "root";
      privateKey = decryptSecret({
        ciphertext: key.privateKeyCiphertext,
        iv: key.privateKeyIv,
        authTag: key.privateKeyAuthTag,
        keyVersion: key.privateKeyVersion,
      });
      hostKeyFingerprint = controlPlaneFingerprint;
    }

    const token = terminalBroker.create({
      userId: session.user.id,
      sessionId: session.session.id,
      twoFactorEnabled: session.user.twoFactorEnabled === true,
      host,
      port,
      username,
      privateKey,
      hostKeyFingerprint,
    });
    return c.json({ token, expiresIn: 60 });
  });

  async function verifyResourceTerminalAccess(
    c: Context<AppEnv>,
    userId: string,
    organizationId: string,
    resourceId: string,
  ) {
    const scope = c.get("scope");
    const uow = scope.resolve(UnitOfWorkToken);
    const resource = await uow.resourceRepository.findById(resourceId);
    if (!resource)
      return { error: c.json({ error: "Resource not found" }, 404) };
    const environment = await uow.environmentRepository.findById(
      resource.environmentId,
    );
    const project = environment
      ? await uow.projectRepository.findById(environment.projectId)
      : null;
    if (!project || project.organizationId !== organizationId) {
      return {
        error: c.json(
          { error: "Resource is not part of this organization" },
          403,
        ),
      };
    }
    try {
      await checkPermission(userId, organizationId, "resource:update");
    } catch {
      return {
        error: c.json(
          { error: "Resource terminal permission is required" },
          403,
        ),
      };
    }
    return { resource, scope, uow };
  }

  app.post("/api/container-terminal/session", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Authentication required" }, 401);
    if (!(await isStepUpAuthenticationSatisfied(session))) {
      return c.json({ error: "2FA verification required" }, 403);
    }

    const body = (await c.req.json().catch(() => null)) as {
      organizationId?: string;
      resourceId?: string;
      containerId?: string;
      sshKeyId?: string;
    } | null;
    if (!body?.organizationId || !body.resourceId || !body.containerId) {
      return c.json(
        {
          error: "Organization, resource, container, and SSH key are required",
        },
        400,
      );
    }
    const containerId = body.containerId;
    if (!isValidContainerIdentifier(containerId)) {
      return c.json({ error: "Invalid container identifier" }, 400);
    }

    const verified = await verifyResourceTerminalAccess(
      c,
      session.user.id,
      body.organizationId,
      body.resourceId,
    );
    if (verified.error) return verified.error;
    const { resource, scope, uow } = verified;
    const targetServerId =
      resource.serverId && !["local", "manager"].includes(resource.serverId)
        ? resource.serverId
        : "local";
    let containers: unknown;
    try {
      containers = await scope.resolve(GetDockerInventoryUseCaseToken).execute({
        organizationId: body.organizationId,
        serverId: targetServerId,
        kind: "containers",
        tail: 150,
      });
    } catch {
      return c.json(
        {
          error: "Unable to verify the selected container on its Docker target",
        },
        409,
      );
    }
    const selectedContainer = Array.isArray(containers)
      ? containers.find((container) => {
          if (
            typeof container !== "object" ||
            container === null ||
            typeof (container as { id?: unknown }).id !== "string" ||
            !Array.isArray((container as { labels?: unknown }).labels)
          ) {
            return false;
          }
          const candidate = container as { id: string; labels: string[] };
          return (
            matchesContainerIdentifier(containerId, candidate.id) &&
            containerBelongsToResource(candidate, resource)
          );
        })
      : undefined;
    if (!selectedContainer) {
      return c.json({ error: "Container is not part of this resource" }, 404);
    }
    let host = "127.0.0.1";
    let port = 22;
    let username = "root";
    let privateKey: string;
    let hostKeyFingerprint: string;
    if (
      resource.serverId &&
      !["local", "manager"].includes(resource.serverId)
    ) {
      const server = await uow.serverRepository.findById(resource.serverId);
      if (!server || server.organizationId !== body.organizationId) {
        return c.json({ error: "Deployment server not found" }, 404);
      }
      host = server.ipAddress;
      port = server.port;
      username = server.username;
      const key = server.sshKeyId
        ? await uow.sshKeyRepository.findById(server.sshKeyId)
        : null;
      if (!key)
        return c.json({ error: "Deployment server has no SSH key" }, 409);
      if (!server.sshHostKeyFingerprint) {
        return c.json(
          { error: "Trust the deployment server SSH host key first" },
          409,
        );
      }
      privateKey = decryptSecret({
        ciphertext: key.privateKeyCiphertext,
        iv: key.privateKeyIv,
        authTag: key.privateKeyAuthTag,
        keyVersion: key.privateKeyVersion,
      });
      hostKeyFingerprint = server.sshHostKeyFingerprint;
    } else {
      if (!body.sshKeyId) {
        return c.json(
          { error: "An SSH key is required for the control-plane terminal" },
          400,
        );
      }
      const [key, settings] = await Promise.all([
        uow.sshKeyRepository.findById(body.sshKeyId),
        uow.webServerSettingsRepository.findGlobal(),
      ]);
      if (!key || key.organizationId !== body.organizationId) {
        return c.json(
          { error: "SSH key was not found in this organization" },
          404,
        );
      }
      if (!settings?.serverIp) {
        return c.json(
          { error: "Control-plane server IP is not configured" },
          409,
        );
      }
      host = settings.serverIp;
      privateKey = decryptSecret({
        ciphertext: key.privateKeyCiphertext,
        iv: key.privateKeyIv,
        authTag: key.privateKeyAuthTag,
        keyVersion: key.privateKeyVersion,
      });
      hostKeyFingerprint =
        env.UPSTAND_CONTROL_PLANE_SSH_HOST_KEY_FINGERPRINT || "";
      if (!hostKeyFingerprint) {
        return c.json(
          {
            error:
              "Configure the trusted control-plane SSH host fingerprint first",
          },
          409,
        );
      }
    }

    const token = terminalBroker.create({
      userId: session.user.id,
      sessionId: session.session.id,
      twoFactorEnabled: session.user.twoFactorEnabled === true,
      host,
      port,
      username,
      privateKey,
      hostKeyFingerprint,
      command: `docker exec -it ${body.containerId} /bin/sh -lc 'exec /bin/sh || exec /bin/bash'`,
    });
    return c.json({ token, expiresIn: 60 });
  });

  app.post("/api/docker/terminal/session", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Authentication required" }, 401);
    if (!(await isStepUpAuthenticationSatisfied(session))) {
      return c.json({ error: "2FA verification required" }, 403);
    }

    const body = (await c.req.json().catch(() => null)) as {
      organizationId?: string;
      resourceId?: string;
      serverId?: string;
      containerId?: string;
      sshKeyId?: string;
    } | null;
    if (!body?.organizationId || !body.resourceId || !body.containerId) {
      return c.json(
        { error: "Organization, resource, and container are required" },
        400,
      );
    }
    if (!isValidContainerIdentifier(body.containerId)) {
      return c.json({ error: "Invalid container identifier" }, 400);
    }
    const containerId = body.containerId;

    const verified = await verifyResourceTerminalAccess(
      c,
      session.user.id,
      body.organizationId,
      body.resourceId,
    );
    if (verified.error) return verified.error;
    const { resource, scope, uow } = verified;
    const targetServerId =
      resource.serverId && !["local", "manager"].includes(resource.serverId)
        ? resource.serverId
        : "local";
    const requestedServerId =
      body.serverId && !["local", "manager"].includes(body.serverId)
        ? body.serverId
        : "local";
    if (requestedServerId !== targetServerId) {
      return c.json(
        { error: "Resource is not assigned to the selected Docker server" },
        403,
      );
    }
    let host: string;
    let port: number;
    let username: string;
    let privateKey: string;
    let hostKeyFingerprint: string;

    if (targetServerId !== "local") {
      const server = await uow.serverRepository.findById(targetServerId);
      if (!server || server.organizationId !== body.organizationId) {
        return c.json(
          { error: "Docker server is not part of this organization" },
          403,
        );
      }
      if (!server.sshKeyId) {
        return c.json(
          { error: "Docker server has no SSH key configured" },
          409,
        );
      }
      if (!server.sshHostKeyFingerprint) {
        return c.json(
          { error: "Trust the Docker server SSH host key first" },
          409,
        );
      }
      const key = await uow.sshKeyRepository.findById(server.sshKeyId);
      if (!key)
        return c.json({ error: "Docker server SSH key was not found" }, 404);
      host = server.ipAddress;
      port = server.port;
      username = server.username;
      privateKey = decryptSecret({
        ciphertext: key.privateKeyCiphertext,
        iv: key.privateKeyIv,
        authTag: key.privateKeyAuthTag,
        keyVersion: key.privateKeyVersion,
      });
      hostKeyFingerprint = server.sshHostKeyFingerprint;
    } else {
      if (!body.sshKeyId) {
        return c.json(
          { error: "An SSH key is required for local Docker" },
          400,
        );
      }
      const [key, settings] = await Promise.all([
        uow.sshKeyRepository.findById(body.sshKeyId),
        uow.webServerSettingsRepository.findGlobal(),
      ]);
      if (!key || key.organizationId !== body.organizationId) {
        return c.json(
          { error: "SSH key was not found in this organization" },
          404,
        );
      }
      if (!settings?.serverIp) {
        return c.json(
          { error: "Control-plane server IP is not configured" },
          409,
        );
      }
      host = settings.serverIp;
      port = 22;
      username = "root";
      privateKey = decryptSecret({
        ciphertext: key.privateKeyCiphertext,
        iv: key.privateKeyIv,
        authTag: key.privateKeyAuthTag,
        keyVersion: key.privateKeyVersion,
      });
      hostKeyFingerprint =
        env.UPSTAND_CONTROL_PLANE_SSH_HOST_KEY_FINGERPRINT || "";
      if (!hostKeyFingerprint) {
        return c.json(
          {
            error:
              "Configure the trusted control-plane SSH host fingerprint first",
          },
          409,
        );
      }
    }

    const containers = await scope
      .resolve(GetDockerInventoryUseCaseToken)
      .execute({
        organizationId: body.organizationId,
        serverId: targetServerId,
        kind: "containers",
        tail: 150,
      });
    if (
      !Array.isArray(containers) ||
      !containers.some(
        (container) =>
          typeof container === "object" &&
          container !== null &&
          matchesContainerIdentifier(
            containerId,
            (container as { id?: string }).id || "",
          ) &&
          Array.isArray((container as { labels?: unknown }).labels) &&
          containerBelongsToResource(
            container as { id: string; labels: string[] },
            resource,
          ),
      )
    ) {
      return c.json(
        { error: "Container was not found on the selected Docker target" },
        404,
      );
    }

    const token = terminalBroker.create({
      userId: session.user.id,
      sessionId: session.session.id,
      twoFactorEnabled: session.user.twoFactorEnabled === true,
      host,
      port,
      username,
      privateKey,
      hostKeyFingerprint,
      command: `docker exec -it ${containerId} /bin/sh -lc 'exec /bin/sh || exec /bin/bash'`,
    });
    return c.json({ token, expiresIn: 60 });
  });

  app.get(
    "/api/terminal/connect",
    upgradeWebSocket((c) => {
      let token: string | null = null;
      return {
        onOpen: async (_event, ws) => {
          const currentSession = await auth.api.getSession({
            headers: c.req.raw.headers,
          });
          if (!currentSession) {
            ws.close(1008, "Authentication required");
            return;
          }
          try {
            token = await terminalBroker.connectForSession(
              currentSession.user.id,
              currentSession.session.id,
              (data) =>
                ws.send(
                  data.buffer.slice(
                    data.byteOffset,
                    data.byteOffset + data.byteLength,
                  ) as ArrayBuffer,
                ),
              (message) => ws.close(1000, message),
              async (identity) => {
                const refreshedSession = await auth.api.getSession({
                  headers: c.req.raw.headers,
                });
                if (!refreshedSession) return false;
                if (
                  !matchesTerminalSession(identity, {
                    userId: refreshedSession.user.id,
                    sessionId: refreshedSession.session.id,
                    twoFactorEnabled:
                      refreshedSession.user.twoFactorEnabled === true,
                  })
                ) {
                  return false;
                }
                return isStepUpAuthenticationSatisfied(refreshedSession);
              },
            );
            ws.send(JSON.stringify({ type: "terminal.ready" }));
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Terminal connection failed";
            ws.send(JSON.stringify({ type: "terminal.error", message }));
            ws.close(1011, "Terminal connection failed");
          }
        },
        onMessage: (event) => {
          if (token && typeof event.data === "string")
            terminalBroker.write(token, event.data);
        },
        onClose: () => {
          if (token) terminalBroker.close(token);
        },
      };
    }),
  );
}
