import { describe, expect, test } from "bun:test";
import { OUTBOX_COMMAND_TYPES } from "@upstand/usecases";
import {
  DeliverNotificationUseCaseToken,
  ExecuteBackupRunUseCaseToken,
} from "@upstand/usecases/tokens";
import {
  type DesktopOutboxCommandScope,
  executeDesktopOutboxCommand,
} from "./desktop-outbox-runner";

function createScope(handlers: Map<unknown, unknown>) {
  return {
    resolve: (token: unknown) => {
      const handler = handlers.get(token);
      if (!handler) throw new Error("Unexpected token resolution");
      return handler;
    },
  } as unknown as DesktopOutboxCommandScope;
}

describe("desktop outbox command dispatch", () => {
  test("delivers notifications that have no Redis-backed worker on desktop", async () => {
    const delivered: string[] = [];
    const scope = createScope(
      new Map<unknown, unknown>([
        [
          DeliverNotificationUseCaseToken,
          {
            execute: async (deliveryId: string) => {
              delivered.push(deliveryId);
            },
          },
        ],
      ]),
    );

    await executeDesktopOutboxCommand(
      scope,
      OUTBOX_COMMAND_TYPES.notificationDelivery,
      { deliveryId: "delivery-1" },
    );

    expect(delivered).toEqual(["delivery-1"]);
  });

  test("executes backup runs queued by the desktop control plane", async () => {
    const executed: string[] = [];
    const scope = createScope(
      new Map<unknown, unknown>([
        [
          ExecuteBackupRunUseCaseToken,
          {
            execute: async (runId: string) => {
              executed.push(runId);
            },
          },
        ],
      ]),
    );

    await executeDesktopOutboxCommand(scope, OUTBOX_COMMAND_TYPES.backupRun, {
      runId: "run-1",
    });

    expect(executed).toEqual(["run-1"]);
  });

  test("fails loudly instead of silently dropping an unknown or malformed command", async () => {
    const scope = createScope(new Map());

    await expect(
      executeDesktopOutboxCommand(scope, "resource.unknown", {}),
    ).rejects.toThrow("Unsupported desktop outbox command type");
    await expect(
      executeDesktopOutboxCommand(
        scope,
        OUTBOX_COMMAND_TYPES.notificationDelivery,
        {},
      ),
    ).rejects.toThrow("missing deliveryId");
    await expect(
      executeDesktopOutboxCommand(scope, OUTBOX_COMMAND_TYPES.backupRun, {}),
    ).rejects.toThrow("missing runId");
    await expect(
      executeDesktopOutboxCommand(scope, OUTBOX_COMMAND_TYPES.migrate, {}),
    ).rejects.toThrow("missing migrationId");
  });
});
