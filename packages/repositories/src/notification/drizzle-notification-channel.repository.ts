import { notificationChannel } from "@upstand/db";
import type {
  INotificationChannelRepository,
  NotificationChannel,
  NotificationEventType,
} from "@upstand/domain";
import { and, arrayContains, desc, eq } from "drizzle-orm";
import type { Executor } from "../shared/types";

export class DrizzleNotificationChannelRepository
  implements INotificationChannelRepository
{
  constructor(private readonly executor: Executor) {}

  async findById(id: string): Promise<NotificationChannel | null> {
    const [channel] = await this.executor
      .select()
      .from(notificationChannel)
      .where(eq(notificationChannel.id, id))
      .limit(1);
    return (channel as NotificationChannel | undefined) ?? null;
  }

  async findByOrganizationId(
    organizationId: string,
  ): Promise<NotificationChannel[]> {
    return (await this.executor
      .select()
      .from(notificationChannel)
      .where(eq(notificationChannel.organizationId, organizationId))
      .orderBy(desc(notificationChannel.createdAt))) as NotificationChannel[];
  }

  async findByEvent(
    event: NotificationEventType,
    organizationId?: string,
  ): Promise<NotificationChannel[]> {
    const where = organizationId
      ? and(
          eq(notificationChannel.organizationId, organizationId),
          arrayContains(notificationChannel.events, [event]),
        )
      : arrayContains(notificationChannel.events, [event]);

    return (await this.executor
      .select()
      .from(notificationChannel)
      .where(where)
      .orderBy(desc(notificationChannel.createdAt))) as NotificationChannel[];
  }

  async create(
    data: Parameters<INotificationChannelRepository["create"]>[0],
  ): Promise<NotificationChannel> {
    const [channel] = await this.executor
      .insert(notificationChannel)
      .values(data)
      .returning();
    if (!channel)
      throw new Error("create: insert returned no notification channel");
    return channel as NotificationChannel;
  }

  async updateById(
    id: string,
    patch: Parameters<INotificationChannelRepository["updateById"]>[1],
  ): Promise<NotificationChannel | null> {
    const [channel] = await this.executor
      .update(notificationChannel)
      .set(patch)
      .where(eq(notificationChannel.id, id))
      .returning();
    return (channel as NotificationChannel | undefined) ?? null;
  }

  async deleteById(id: string): Promise<boolean> {
    const deleted = await this.executor
      .delete(notificationChannel)
      .where(eq(notificationChannel.id, id))
      .returning({ id: notificationChannel.id });
    return deleted.length > 0;
  }
}
