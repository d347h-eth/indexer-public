import cron from "node-cron";

import { idb } from "@/common/db";
import { redis, redlock } from "@/common/redis";
import { config } from "@/config/index";
import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import { logger } from "@/common/logger";

export default class DeleteOldAskEventsJob extends AbstractRabbitMqJobHandler {
  queueName = "delete-old-ask-events";
  maxRetries = 3;
  concurrency = 1;
  singleActiveConsumer = true;
  useSharedChannel = true;
  backoff = {
    type: "exponential",
    delay: 10000,
  } as BackoffStrategy;

  public async process() {
    // Only run in focus mode - in wide mode, keep all events for historical purposes
    if (!config.focusCollectionAddress) {
      logger.info(
        this.queueName,
        "Focus mode not enabled - skipping old ask event deletion (wide mode keeps history)"
      );
      return;
    }

    // Delete old ask events (token_floor_sell_events, collection_floor_sell_events)
    // Keep recent events (7 days) for debugging/analytics
    // Delete: expiry, sale, cancel events older than 7 days
    const retentionDays = 7;

    // Clean token_floor_sell_events
    const tokenFloorResult = await idb.result(
      `
        DELETE FROM token_floor_sell_events
        WHERE kind IN ('expiry', 'sale', 'cancel')
          AND created_at < now() - interval '${retentionDays} days'
      `,
      [],
      (r) => r.rowCount
    );

    // Clean collection_floor_sell_events
    const collectionFloorResult = await idb.result(
      `
        DELETE FROM collection_floor_sell_events
        WHERE kind IN ('expiry', 'sale', 'cancel')
          AND created_at < now() - interval '${retentionDays} days'
      `,
      [],
      (r) => r.rowCount
    );

    const totalDeleted = (tokenFloorResult || 0) + (collectionFloorResult || 0);

    if (totalDeleted > 0) {
      logger.info(
        this.queueName,
        JSON.stringify({
          message: `Deleted ${totalDeleted} old ask events (older than ${retentionDays} days)`,
          tokenFloorEvents: tokenFloorResult || 0,
          collectionFloorEvents: collectionFloorResult || 0,
          retentionDays,
        })
      );
    }
  }

  public async addToQueue() {
    await this.send();
  }
}

export const deleteOldAskEventsJob = new DeleteOldAskEventsJob();

// Run daily at 3:30 AM (after orders and bid events cleanup)
if (config.doBackgroundWork && config.focusCollectionAddress) {
  cron.schedule("30 3 * * *", async () =>
    redlock
      .acquire(["delete-old-ask-events-lock"], 60 * 60 * 1000) // 1 hour lock
      .then(async (lock) => {
        try {
          await deleteOldAskEventsJob.addToQueue();
        } finally {
          await lock.release();
        }
      })
      .catch(() => {
        // Skip if lock is already held
      })
  );
}
