import cron from "node-cron";

import { idb } from "@/common/db";
import { redis, redlock } from "@/common/redis";
import { config } from "@/config/index";
import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import { logger } from "@/common/logger";

export default class DeleteExpiredBidEventsJob extends AbstractRabbitMqJobHandler {
  queueName = "delete-expired-bid-events";
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
        "Focus mode not enabled - skipping expired bid event deletion (wide mode keeps history)"
      );
      return;
    }

    // Delete bid events that expired more than 7 days ago
    // Keep: active, filled, cancelled (recent activity), recently expired
    // Delete: expired events older than 7 days
    const retentionDays = 7;

    const result = await idb.result(
      `
        DELETE FROM bid_events
        WHERE status = 'expired'
          AND upper(order_valid_between) < now() - interval '${retentionDays} days'
      `,
      [],
      (r) => r.rowCount
    );

    if (result) {
      logger.info(
        this.queueName,
        JSON.stringify({
          message: `Deleted ${result} expired bid events (older than ${retentionDays} days)`,
          deletedCount: result,
          retentionDays,
        })
      );
    }
  }

  public async addToQueue() {
    await this.send();
  }
}

export const deleteExpiredBidEventsJob = new DeleteExpiredBidEventsJob();

// Run daily at 3:15 AM (stagger slightly after orders cleanup)
if (config.doBackgroundWork && config.focusCollectionAddress) {
  cron.schedule("15 3 * * *", async () =>
    redlock
      .acquire(["delete-expired-bid-events-lock"], 60 * 60 * 1000) // 1 hour lock
      .then(async (lock) => {
        try {
          await deleteExpiredBidEventsJob.addToQueue();
        } finally {
          await lock.release();
        }
      })
      .catch(() => {
        // Skip if lock is already held
      })
  );
}
