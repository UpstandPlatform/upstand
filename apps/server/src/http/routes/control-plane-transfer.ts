import { randomUUID } from "node:crypto";
import { stepUp } from "@upstand/api/auth";
import { createContext } from "@upstand/api/context";
import { requireInstanceOwner } from "@upstand/api/instance-access";
import { and, auditLog, db, eq, isNull, organization, user } from "@upstand/db";
import { controlPlaneIdentity } from "@upstand/db/schema/control-plane-transfer";
import { env } from "@upstand/env/server";
import {
  DrizzleControlPlaneExportSource,
  DrizzleControlPlaneImportDestination,
  DrizzlePortableControlPlaneRecordApplier,
  getOrCreateControlPlaneInstanceId,
} from "@upstand/repositories";
import {
  ExportControlPlaneTransferService,
  getConfiguredControlPlaneMode,
  getPlatformCapabilities,
  ImportControlPlaneTransferService,
} from "@upstand/usecases";
import { log } from "evlog";
import type { Hono } from "hono";
import { stream } from "hono/streaming";
import type { AppEnv } from "../types";
import {
  controlPlaneExportRequestSchema,
  controlPlaneOwnerRepairRequestSchema,
  controlPlaneOwnerTransferRequestSchema,
  parseTransferPassphrase,
} from "./control-plane-transfer.validation";

const TRANSFER_CONTENT_TYPE = "application/vnd.upstand.transfer+ndjson";
const MAX_TRANSFER_REQUEST_BYTES = 512 * 1024 * 1024;

async function requireTransferOwner(c: Parameters<Hono<AppEnv>["fetch"]>[0]) {
  const context = await createContext({ context: c as never });
  if (!context.session || !context.actor) {
    return { error: "Authentication required" as const, status: 401 as const };
  }
  if (context.actor.kind !== "session") {
    return {
      error:
        "Control-plane transfer requires an interactive owner session" as const,
      status: 403 as const,
    };
  }
  try {
    await requireInstanceOwner(context.session.user.id, context.actor.kind);
    if (!(await stepUp.isStepUpAuthenticationSatisfied(context.session))) {
      return {
        error: "2FA verification required" as const,
        status: 403 as const,
      };
    }
    return {
      actor: {
        id: context.session.user.id,
        name: context.session.user.name,
        email: context.session.user.email,
      },
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Instance owner required",
      status: 403 as const,
    };
  }
}

async function auditTransfer(input: {
  actor: { id: string; name: string; email: string };
  action: "read" | "import";
  success: boolean;
  mode?: string;
  correlationId: string;
}): Promise<void> {
  const organizations = await db
    .select({ id: organization.id })
    .from(organization);
  if (organizations.length === 0) return;
  await db.insert(auditLog).values(
    organizations.map(({ id }) => ({
      id: randomUUID(),
      organizationId: id,
      actorId: null,
      actorName: input.actor.name,
      actorEmail: input.actor.email,
      actorRole: "instance-owner",
      action: input.action,
      resourceType: "system" as const,
      resourceId: null,
      resourceName: "control-plane-transfer",
      route: `/api/control-plane-transfer/${input.action === "read" ? "export" : "import"}`,
      metadata: {
        success: input.success,
        correlationId: input.correlationId,
        ...(input.mode ? { mode: input.mode } : {}),
      },
      ipAddress: null,
      userAgent: null,
    })),
  );
}

async function auditOwnerTransfer(input: {
  actor: { id: string; name: string; email: string };
  newOwnerUserId: string;
  success: boolean;
  operation: "configure" | "update";
  correlationId: string;
}): Promise<void> {
  const organizations = await db
    .select({ id: organization.id })
    .from(organization);
  if (organizations.length === 0) return;
  await db.insert(auditLog).values(
    organizations.map(({ id }) => ({
      id: randomUUID(),
      organizationId: id,
      actorId: input.actor.id,
      actorName: input.actor.name,
      actorEmail: input.actor.email,
      actorRole: "instance-owner",
      action: input.success ? input.operation : ("failure" as const),
      resourceType: "settings" as const,
      resourceId: input.newOwnerUserId,
      resourceName: "instance-owner",
      route: `/api/control-plane-transfer/${input.operation === "configure" ? "owner/repair" : "owner"}`,
      metadata: {
        success: input.success,
        correlationId: input.correlationId,
        operation: input.operation,
        newOwnerUserId: input.newOwnerUserId,
      },
      ipAddress: null,
      userAgent: null,
    })),
  );
}

async function* requestContent(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  const reader = body.getReader();
  let totalBytes = 0;
  try {
    while (true) {
      const value = await reader.read();
      if (value.done) return;
      if (value.value.byteLength === 0) continue;
      totalBytes += value.value.byteLength;
      if (totalBytes > MAX_TRANSFER_REQUEST_BYTES) {
        throw new Error("Control-plane transfer exceeds the 512 MiB limit");
      }
      yield value.value;
    }
  } finally {
    reader.releaseLock();
  }
}

export function registerControlPlaneTransferRoutes(app: Hono<AppEnv>): void {
  app.post("/api/control-plane-transfer/owner/repair", async (c) => {
    const authorization = await requireTransferOwner(c as never);
    if ("error" in authorization) {
      return c.json({ error: authorization.error }, authorization.status);
    }
    if (
      !env.UPSTAND_INSTANCE_OWNER_USER_ID?.trim() &&
      !env.UPSTAND_INSTANCE_OWNER_EMAIL?.trim()
    ) {
      return c.json(
        {
          error:
            "Owner repair is available only while an explicit legacy owner override is configured",
        },
        409,
      );
    }

    const actor = authorization.actor;
    const correlationId = c.get("correlationId");
    const parsedInput = controlPlaneOwnerRepairRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsedInput.success) {
      return c.json({ error: "Invalid owner repair request" }, 400);
    }
    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(controlPlaneIdentity)
          .values({ id: "global", instanceId: randomUUID() })
          .onConflictDoNothing({ target: controlPlaneIdentity.id });
        const [updated] = await tx
          .update(controlPlaneIdentity)
          .set({ ownerUserId: actor.id })
          .where(
            and(
              eq(controlPlaneIdentity.id, "global"),
              isNull(controlPlaneIdentity.ownerUserId),
            ),
          )
          .returning({ ownerUserId: controlPlaneIdentity.ownerUserId });
        if (!updated) {
          throw new Error(
            "The persisted owner already exists; clear the override before transferring ownership",
          );
        }
      });
      await auditOwnerTransfer({
        actor,
        newOwnerUserId: actor.id,
        success: true,
        operation: "configure",
        correlationId,
      });
      return c.json({ ownerUserId: actor.id });
    } catch (error) {
      await auditOwnerTransfer({
        actor,
        newOwnerUserId: actor.id,
        success: false,
        operation: "configure",
        correlationId,
      }).catch(() => undefined);
      log.error({
        message: "Control-plane owner repair failed",
        actorId: actor.id,
        err: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Control-plane owner repair failed" }, 409);
    }
  });

  app.post("/api/control-plane-transfer/owner", async (c) => {
    const authorization = await requireTransferOwner(c as never);
    if ("error" in authorization) {
      return c.json({ error: authorization.error }, authorization.status);
    }
    if (
      env.UPSTAND_INSTANCE_OWNER_USER_ID?.trim() ||
      env.UPSTAND_INSTANCE_OWNER_EMAIL?.trim()
    ) {
      return c.json(
        {
          error:
            "Clear the configured instance-owner override before using the persisted owner transfer workflow",
        },
        409,
      );
    }
    const actor = authorization.actor;
    const correlationId = c.get("correlationId");
    const parsedInput = controlPlaneOwnerTransferRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsedInput.success) {
      return c.json({ error: "Invalid owner transfer request" }, 400);
    }
    const newOwnerUserId = parsedInput.data.newOwnerUserId;

    try {
      await db.transaction(async (tx) => {
        const [target] = await tx
          .select({ id: user.id, banned: user.banned })
          .from(user)
          .where(eq(user.id, newOwnerUserId))
          .limit(1);
        if (!target || target.banned === true) {
          throw new Error("The target owner does not exist or is banned");
        }

        const [updated] = await tx
          .update(controlPlaneIdentity)
          .set({ ownerUserId: newOwnerUserId })
          .where(
            and(
              eq(controlPlaneIdentity.id, "global"),
              eq(controlPlaneIdentity.ownerUserId, actor.id),
            ),
          )
          .returning({ ownerUserId: controlPlaneIdentity.ownerUserId });
        if (!updated) {
          throw new Error(
            "The persisted owner changed or the control-plane identity is unavailable",
          );
        }
      });
      await auditOwnerTransfer({
        actor,
        newOwnerUserId,
        success: true,
        operation: "update",
        correlationId,
      });
      return c.json({ ownerUserId: newOwnerUserId });
    } catch (error) {
      await auditOwnerTransfer({
        actor,
        newOwnerUserId,
        success: false,
        operation: "update",
        correlationId,
      }).catch(() => undefined);
      log.error({
        message: "Control-plane owner transfer failed",
        actorId: actor.id,
        err: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Control-plane owner transfer failed" }, 409);
    }
  });

  app.post("/api/control-plane-transfer/export", async (c) => {
    if (
      !getPlatformCapabilities(getConfiguredControlPlaneMode())
        .controlPlaneTransfer
    ) {
      return c.json(
        {
          error:
            "Cloud-owned data must use the cloud gateway bring-home operation",
        },
        409,
      );
    }
    const authorization = await requireTransferOwner(c as never);
    if ("error" in authorization) {
      return c.json({ error: authorization.error }, authorization.status);
    }
    const actor = authorization.actor;
    const correlationId = c.get("correlationId");
    const parsedInput = controlPlaneExportRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsedInput.success) {
      return c.json({ error: "Invalid transfer export request" }, 400);
    }
    const input = parsedInput.data;
    if (input.includeSecrets && !input.passphrase) {
      return c.json(
        { error: "A passphrase is required when exporting secrets" },
        400,
      );
    }
    try {
      const source = new DrizzleControlPlaneExportSource(db, {
        sourceEngine:
          getConfiguredControlPlaneMode() === "desktop"
            ? "pglite"
            : "postgresql",
        sourceInstanceId: await getOrCreateControlPlaneInstanceId(db),
      });
      const content = await new ExportControlPlaneTransferService(
        source,
      ).execute({
        includeSecrets: input.includeSecrets,
        passphrase: input.passphrase,
      });
      c.header("Content-Type", TRANSFER_CONTENT_TYPE);
      c.header(
        "Content-Disposition",
        `attachment; filename="upstand-control-plane-${new Date().toISOString().slice(0, 10)}.ndjson"`,
      );
      return stream(c, async (output) => {
        try {
          for await (const chunk of content) await output.write(chunk);
          await auditTransfer({
            actor,
            action: "read",
            success: true,
            correlationId,
          });
        } catch (error) {
          await auditTransfer({
            actor,
            action: "read",
            success: false,
            correlationId,
          }).catch(() => undefined);
          log.error({
            message: "Control-plane export stream failed",
            actorId: actor.id,
            err: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      });
    } catch (error) {
      await auditTransfer({
        actor,
        action: "read",
        success: false,
        correlationId,
      }).catch(() => undefined);
      log.error({
        message: "Control-plane export failed",
        actorId: actor.id,
        err: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Control-plane export failed" }, 500);
    }
  });

  app.post("/api/control-plane-transfer/import", async (c) => {
    if (
      !getPlatformCapabilities(getConfiguredControlPlaneMode())
        .controlPlaneTransfer
    ) {
      return c.json(
        {
          error:
            "Cloud-owned data must use the cloud gateway promote operation",
        },
        409,
      );
    }
    const authorization = await requireTransferOwner(c as never);
    if ("error" in authorization) {
      return c.json({ error: authorization.error }, authorization.status);
    }
    const actor = authorization.actor;
    const correlationId = c.get("correlationId");
    const mode = c.req.header("x-upstand-transfer-mode") ?? "merge";
    if (mode !== "merge" && mode !== "replace") {
      return c.json({ error: "Transfer mode must be merge or replace" }, 400);
    }
    if (!c.req.raw.body)
      return c.json({ error: "Transfer body is required" }, 400);
    const parsedPassphrase = parseTransferPassphrase(
      c.req.header("x-upstand-transfer-passphrase"),
    );
    if (!parsedPassphrase.success) {
      return c.json({ error: "Invalid transfer passphrase" }, 400);
    }
    const passphrase = parsedPassphrase.data;
    const resumeSessionId = c.req.header("x-upstand-transfer-session")?.trim();
    try {
      const destination = new DrizzleControlPlaneImportDestination(
        db,
        actor.id,
        new DrizzlePortableControlPlaneRecordApplier(),
        resumeSessionId || undefined,
      );
      const result = await new ImportControlPlaneTransferService(
        destination,
      ).execute({
        content: requestContent(c.req.raw.body),
        mode,
        passphrase,
      });
      await auditTransfer({
        actor,
        action: "import",
        success: true,
        mode,
        correlationId,
      });
      return c.json(result);
    } catch (error) {
      await auditTransfer({
        actor,
        action: "import",
        success: false,
        mode,
        correlationId,
      }).catch(() => undefined);
      log.error({
        message: "Control-plane import failed",
        actorId: actor.id,
        mode,
        err: error instanceof Error ? error.message : String(error),
      });
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Control-plane import failed",
        },
        400,
      );
    }
  });
}
