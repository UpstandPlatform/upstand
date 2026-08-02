import { expect, test } from "bun:test";
import type {
  IUnitOfWork,
  NotificationChannel,
  NotificationConfiguration,
} from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { UpdateNotificationChannelUseCase } from "./update-notification-channel.usecase";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

function createChannel(
  configuration: NotificationConfiguration,
): NotificationChannel {
  process.env.ENCRYPTION_KEY_V1 = TEST_KEY;
  return {
    id: "channel-1",
    organizationId: "org-1",
    name: "Production alerts",
    provider: configuration.type,
    events: ["deployment_failed"],
    encryptedConfiguration: JSON.stringify(
      encryptSecret(JSON.stringify(configuration)),
    ),
    configurationSummary: {
      chatId: "1234",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test("updates notification metadata without exposing or replacing stored secrets", async () => {
  const channel = createChannel({
    type: "telegram",
    botToken: "secret-token",
    chatId: "1234",
  });
  const repository = {
    findById: async () => channel,
    updateById: async (_id: string, patch: Record<string, unknown>) => ({
      ...channel,
      ...patch,
    }),
  };
  const uow = {
    notificationChannelRepository: repository,
  } as unknown as IUnitOfWork;

  const result = await new UpdateNotificationChannelUseCase(uow).execute({
    id: channel.id,
    organizationId: channel.organizationId,
    name: "Production deployments",
    events: ["deployment_succeeded", "deployment_failed"],
  });

  expect(result.name).toBe("Production deployments");
  expect(result.events).toEqual(["deployment_succeeded", "deployment_failed"]);
  expect("encryptedConfiguration" in result).toBe(false);
});

test("rejects notification updates from another organization", async () => {
  const channel = createChannel({
    type: "telegram",
    botToken: "secret-token",
    chatId: "1234",
  });
  const uow = {
    notificationChannelRepository: {
      findById: async () => channel,
      updateById: async () => channel,
    },
  } as unknown as IUnitOfWork;

  await expect(
    new UpdateNotificationChannelUseCase(uow).execute({
      id: channel.id,
      organizationId: "org-attacker",
      name: "Should not update",
    }),
  ).rejects.toThrow("Notification channel not found");
});
