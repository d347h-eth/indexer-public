import cron from "node-cron";

import { idb } from "@/common/db";
import { redis, redlock } from "@/common/redis";
import { config } from "@/config/index";
import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import { logger } from "@/common/logger";

export default class DeleteExpiredOrdersJob extends AbstractRabbitMqJobHandler {
  queueName = "delete-expired-orders";
  maxRetries = 3;
  concurrency = 1;
  singleActiveConsumer = true;
  useSharedChannel = true;
  backoff = {
    type: "exponential",
    delay: 10000,
  } as BackoffStrategy;

  public async process() {
    // Only run in focus mode - in wide mode, keep all orders for historical purposes
    if (!config.focusCollectionAddress) {
      logger.info(
        this.queueName,
        "Focus mode not enabled - skipping expired order deletion (wide mode keeps history)"
      );
      return;
    }

    // Delete orders that have been expired for more than 7 days
    // This gives time for any pending jobs to process before deletion
    const retentionDays = 7;

    const result = await idb.result(
      `
        DELETE FROM orders
        WHERE fillability_status = 'expired'
          AND expiration < now() - interval '${retentionDays} days'
      `,
      [],
      (r) => r.rowCount
    );

    if (result) {
      logger.info(
        this.queueName,
        JSON.stringify({
          message: `Deleted ${result} expired orders (older than ${retentionDays} days)`,
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

export const deleteExpiredOrdersJob = new DeleteExpiredOrdersJob();

// Run daily at 3 AM (low-traffic time)
if (config.doBackgroundWork && config.focusCollectionAddress) {
  cron.schedule("0 3 * * *", async () =>
    redlock
      .acquire(["delete-expired-orders-lock"], 60 * 60 * 1000) // 1 hour lock
      .then(async (lock) => {
        try {
          await deleteExpiredOrdersJob.addToQueue();
        } finally {
          await lock.release();
        }
      })
      .catch(() => {
        // Skip if lock is already held
      })
  );
}
