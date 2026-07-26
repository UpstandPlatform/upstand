import {
  type NotificationChannel,
  type NotificationConfiguration,
  NotificationConfigurationSchema,
} from "@upstand/domain";
import {
  decryptSecret,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";

export function encryptNotificationConfiguration(
  configuration: NotificationConfiguration,
): string {
  return JSON.stringify(encryptSecret(JSON.stringify(configuration)));
}

export function decryptNotificationConfiguration(
  channel: NotificationChannel,
): NotificationConfiguration {
  const encrypted = JSON.parse(channel.encryptedConfiguration);
  const configuration = JSON.parse(decryptSecret(encrypted));
  return NotificationConfigurationSchema.parse({
    ...configuration,
    type: channel.provider,
  });
}
