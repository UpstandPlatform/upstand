import { Worker } from "bullmq";
import { ManagedQueueWorker } from "../shared/managed-queue-worker";
import { NOTIFICATION_DELIVERY_QUEUE } from "./publish-notification.usecase";

export type NotificationDeliveryHandler = (deliveryId: string) => Promise<void>;

export class NotificationDeliveryWorker {
  private readonly worker: ManagedQueueWorker;

  constructor(deliverNotification: NotificationDeliveryHandler) {
    this.worker = new ManagedQueueWorker({
      loggerName: "notification-worker",
      failedMessage: "Notification delivery job failed",
      connectionErrorMessage: "Notification worker connection error",
      createWorker: (connection) =>
        new Worker(
          NOTIFICATION_DELIVERY_QUEUE,
          async (job) => {
            const deliveryId = job.data?.deliveryId;
            if (!deliveryId) {
              throw new Error("Notification job is missing deliveryId");
            }

            await deliverNotification(deliveryId);
          },
          {
            connection: connection as never,
            concurrency: 10,
            maxStalledCount: 1,
          },
        ),
      getFailedJobContext: (job) => ({
        deliveryId: job?.data?.deliveryId,
      }),
    });
  }

  start(): Promise<void> {
    return this.worker.start();
  }

  isReady(): boolean {
    return this.worker.isReady();
  }

  stop(): Promise<void> {
    return this.worker.stop();
  }
}
