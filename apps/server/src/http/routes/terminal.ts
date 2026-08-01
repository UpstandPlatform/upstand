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
    let privateKey: string | undefined;
    let password: string | undefined;
    let hostKeyFingerprint: string;

    if (body.serverId) {
      const server = await uow.serverRepository.findById(body.serverId);
      if (!server || server.organizationId !== body.organizationId) {
        return c.json({ error: "Server not found in this organization" }, 404);
      }
      if (!server.sshHostKeyFingerprint) {
        return c.json({ error: "Trust the server SSH host key first" }, 409);
      }
      const isPasswordAuth =
        server.authType === "password" ||
        (!server.sshKeyId && Boolean(server.passwordCiphertext));
      if (isPasswordAuth) {
        if (
          !server.passwordCiphertext ||
          !server.passwordIv ||
          !server.passwordAuthTag ||
          server.passwordVersion == null
        ) {
          return c.json(
            { error: "Server password credentials are missing" },
            409,
          );
        }
        password = decryptSecret({
          ciphertext: server.passwordCiphertext,
          iv: server.passwordIv,
          authTag: server.passwordAuthTag,
          keyVersion: server.passwordVersion,
        });
      } else {
        if (!server.sshKeyId) {
          return c.json(
            { error: "Server does not have an SSH key configured" },
            409,
          );
        }
        const key = await uow.sshKeyRepository.findById(server.sshKeyId);
        if (!key) {
          return c.json({ error: "Configured SSH key not found" }, 404);
        }
        privateKey = decryptSecret({
          ciphertext: key.privateKeyCiphertext,
          iv: key.privateKeyIv,
          authTag: key.privateKeyAuthTag,
          keyVersion: key.privateKeyVersion,
        });
      }
      host = server.ipAddress;
      port = server.port;
      username = server.username;
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
      port =
        typeof body.port === "number" &&
        Number.isInteger(body.port) &&
        body.port >= 1 &&
        body.port <= 65_535
          ? body.port
          : 22;
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
      isLocal: false,
      host,
      port,
      username,
      privateKey,
      password,
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
      cols?: number;
      rows?: number;
    } | null;
    if (!body?.organizationId || !body.resourceId || !body.containerId) {
      return c.json(
        {
          error: "Organization, resource, and container are required",
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
    const authorizedContainerId = (selectedContainer as { id: string }).id;

    if (targetServerId === "local") {
      const token = terminalBroker.create({
        userId: session.user.id,
        sessionId: session.session.id,
        twoFactorEnabled: session.user.twoFactorEnabled === true,
        isLocal: true,
        containerId: authorizedContainerId,
        initialCols:
          typeof body.cols === "number" && body.cols > 0
            ? body.cols
            : undefined,
        initialRows:
          typeof body.rows === "number" && body.rows > 0
            ? body.rows
            : undefined,
      });
      return c.json({ token, expiresIn: 60 });
    }

    const server = await uow.serverRepository.findById(targetServerId);
    if (!server || server.organizationId !== body.organizationId) {
      return c.json({ error: "Deployment server not found" }, 404);
    }
    if (!server.sshHostKeyFingerprint) {
      return c.json(
        { error: "Trust the deployment server SSH host key first" },
        409,
      );
    }
    let privateKey: string | undefined;
    let password: string | undefined;

    const isPasswordAuth =
      server.authType === "password" ||
      (!server.sshKeyId && Boolean(server.passwordCiphertext));

    if (isPasswordAuth) {
      if (
        !server.passwordCiphertext ||
        !server.passwordIv ||
        !server.passwordAuthTag ||
        server.passwordVersion == null
      ) {
        return c.json(
          { error: "Deployment server password credentials missing" },
          409,
        );
      }
      password = decryptSecret({
        ciphertext: server.passwordCiphertext,
        iv: server.passwordIv,
        authTag: server.passwordAuthTag,
        keyVersion: server.passwordVersion,
      });
    } else {
      if (!server.sshKeyId) {
        return c.json({ error: "Deployment server has no SSH key" }, 409);
      }
      const key = await uow.sshKeyRepository.findById(server.sshKeyId);
      if (!key)
        return c.json(
          { error: "Deployment server SSH key was not found" },
          404,
        );
      privateKey = decryptSecret({
        ciphertext: key.privateKeyCiphertext,
        iv: key.privateKeyIv,
        authTag: key.privateKeyAuthTag,
        keyVersion: key.privateKeyVersion,
      });
    }

    const safeContainerId = authorizedContainerId.replace(
      /[^a-zA-Z0-9_.-]/g,
      "",
    );

    const token = terminalBroker.create({
      userId: session.user.id,
      sessionId: session.session.id,
      twoFactorEnabled: session.user.twoFactorEnabled === true,
      isLocal: false,
      host: server.ipAddress,
      port: server.port,
      username: server.username,
      privateKey,
      password,
      hostKeyFingerprint: server.sshHostKeyFingerprint,
      command: `docker exec -it ${safeContainerId} /bin/sh -c "exec /bin/bash 2>/dev/null || exec /bin/sh"`,
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
      cols?: number;
      rows?: number;
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

    const containers = await scope
      .resolve(GetDockerInventoryUseCaseToken)
      .execute({
        organizationId: body.organizationId,
        serverId: targetServerId,
        kind: "containers",
        tail: 150,
      });
    const selectedContainer = Array.isArray(containers)
      ? containers.find(
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
      : undefined;
    if (!selectedContainer) {
      return c.json(
        { error: "Container was not found on the selected Docker target" },
        404,
      );
    }
    const authorizedContainerId = (selectedContainer as { id: string }).id;

    if (targetServerId === "local") {
      const token = terminalBroker.create({
        userId: session.user.id,
        sessionId: session.session.id,
        twoFactorEnabled: session.user.twoFactorEnabled === true,
        isLocal: true,
        containerId: authorizedContainerId,
        initialCols:
          typeof body.cols === "number" && body.cols > 0
            ? body.cols
            : undefined,
        initialRows:
          typeof body.rows === "number" && body.rows > 0
            ? body.rows
            : undefined,
      });
      return c.json({ token, expiresIn: 60 });
    }

    const server = await uow.serverRepository.findById(targetServerId);
    if (!server || server.organizationId !== body.organizationId) {
      return c.json(
        { error: "Docker server is not part of this organization" },
        403,
      );
    }
    if (!server.sshHostKeyFingerprint) {
      return c.json(
        { error: "Trust the Docker server SSH host key first" },
        409,
      );
    }
    let privateKey: string | undefined;
    let password: string | undefined;

    const isPasswordAuth =
      server.authType === "password" ||
      (!server.sshKeyId && Boolean(server.passwordCiphertext));

    if (isPasswordAuth) {
      if (
        !server.passwordCiphertext ||
        !server.passwordIv ||
        !server.passwordAuthTag ||
        server.passwordVersion == null
      ) {
        return c.json(
          { error: "Docker server password credentials missing" },
          409,
        );
      }
      password = decryptSecret({
        ciphertext: server.passwordCiphertext,
        iv: server.passwordIv,
        authTag: server.passwordAuthTag,
        keyVersion: server.passwordVersion,
      });
    } else {
      if (!server.sshKeyId) {
        return c.json(
          { error: "Docker server has no SSH key configured" },
          409,
        );
      }
      const key = await uow.sshKeyRepository.findById(server.sshKeyId);
      if (!key)
        return c.json({ error: "Docker server SSH key was not found" }, 404);
      privateKey = decryptSecret({
        ciphertext: key.privateKeyCiphertext,
        iv: key.privateKeyIv,
        authTag: key.privateKeyAuthTag,
        keyVersion: key.privateKeyVersion,
      });
    }

    const safeContainerId = authorizedContainerId.replace(
      /[^a-zA-Z0-9_.-]/g,
      "",
    );

    const token = terminalBroker.create({
      userId: session.user.id,
      sessionId: session.session.id,
      twoFactorEnabled: session.user.twoFactorEnabled === true,
      isLocal: false,
      host: server.ipAddress,
      port: server.port,
      username: server.username,
      privateKey,
      password,
      hostKeyFingerprint: server.sshHostKeyFingerprint,
      command: `docker exec -it ${safeContainerId} /bin/sh`,
    });
    return c.json({ token, expiresIn: 60 });
  });

  app.get(
    "/api/terminal/connect",
    upgradeWebSocket((c) => {
      let token: string | null = null;
      const requestedToken = c.req.query("token");
      let socketOpen = true;
      let wsRef: {
        send(data: string | ArrayBuffer): void;
        close(code?: number, reason?: string): void;
      } | null = null;
      const closeSocket = (code: number, reason: string) => {
        if (!socketOpen) return;
        socketOpen = false;
        try {
          wsRef?.close(code, reason.slice(0, 120));
        } catch {
          // The WebSocket may already have been closed by the client.
        }
      };
      const sendSocket = (data: string | ArrayBuffer): boolean => {
        if (!socketOpen || !wsRef) return false;
        try {
          wsRef.send(data);
          return true;
        } catch {
          closeSocket(1011, "Terminal socket is no longer available");
          return false;
        }
      };
      return {
        onOpen: async (_event, ws) => {
          wsRef = ws;
          try {
            const currentSession = await auth.api.getSession({
              headers: c.req.raw.headers,
            });
            if (!currentSession) {
              closeSocket(1008, "Authentication required");
              return;
            }
            token = await terminalBroker.connectForSession(
              currentSession.user.id,
              currentSession.session.id,
              (data) =>
                sendSocket(
                  data.buffer.slice(
                    data.byteOffset,
                    data.byteOffset + data.byteLength,
                  ) as ArrayBuffer,
                ),
              (message) => closeSocket(1000, message),
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
              requestedToken,
            );
            sendSocket(JSON.stringify({ type: "terminal.ready" }));
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Terminal connection failed";
            if (socketOpen) {
              sendSocket(JSON.stringify({ type: "terminal.error", message }));
              closeSocket(1011, "Terminal connection failed");
            }
          }
        },
        onMessage: (event) => {
          if (!socketOpen || !token) return;
          let input: string | Uint8Array | null = null;
          if (typeof event.data === "string") {
            try {
              const parsed = JSON.parse(event.data) as {
                type?: string;
                cols?: number;
                rows?: number;
              };
              if (
                parsed &&
                parsed.type === "resize" &&
                typeof parsed.cols === "number" &&
                typeof parsed.rows === "number"
              ) {
                terminalBroker.resize(token, parsed.cols, parsed.rows);
                return;
              }
            } catch {
              // Not JSON, treat as raw terminal input string
            }
            input = event.data;
          } else if (event.data instanceof ArrayBuffer) {
            input = new Uint8Array(event.data);
          } else if (event.data instanceof Uint8Array) {
            input = event.data;
          } else if (Buffer.isBuffer(event.data)) {
            input = event.data;
          }

          if (input !== null) {
            terminalBroker.write(token, input);
          }
        },
        onClose: () => {
          socketOpen = false;
          if (token) terminalBroker.close(token);
        },
      };
    }),
  );
}
