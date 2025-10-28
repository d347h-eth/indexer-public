import { idb, redb } from "@/common/db";
import { fromBuffer, sanitizeText, toBuffer } from "@/common/utils";
import { BackoffStrategy, AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { tryGetCurrencyDetails } from "@/utils/currencies";
import { config } from "@/config/index";
import cron from "node-cron";
import { redlock } from "@/common/redis";
import { PubSub } from "@/pubsub/index";
import { Channel } from "@/pubsub/channels";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface IDetails {
  name?: string;
  symbol: string;
  decimals: number;
  totalSupply?: number;
  metadata: any;
}
export type CurrenciesFetchJobPayload = {
  currency: string;
};

export default class CurrenciesFetchJob extends AbstractRabbitMqJobHandler {
  queueName = "currencies-fetch";
  maxRetries = 10;
  concurrency = 10;
  timeout = 60000;
  backoff = {
    type: "exponential",
    delay: 10000,
  } as BackoffStrategy;

  public async process(payload: CurrenciesFetchJobPayload) {
    // Skip currency fetching in focus mode - we only care about the specific collection
    if (config.focusCollectionSlug) {
      return;
    }

    const { currency } = payload;
    await this.updateCurrency(currency);

    // Update other pods currency was updated
    await PubSub.publish(Channel.CurrencyUpdated, JSON.stringify({ currency }));
  }

  async getDbCurrency(currency: string) {
    return await idb.oneOrNone(
      `
        SELECT metadata FROM currencies 
        WHERE contract = $/contract/
      `,
      {
        contract: toBuffer(currency),
      }
    );
  }

  async updateDetailsForAdminOverrides(currency: string, details: IDetails) {
    const existing = await this.getDbCurrency(currency);
    if (existing?.metadata.adminName) {
      details.name = existing.metadata.adminName;
      details.metadata.adminName = existing.metadata.adminName;
    }
    if (existing?.metadata.adminImage) {
      details.metadata.adminImage = existing.metadata.adminImage;
      details.metadata.image = existing.metadata.adminImage;
    }
    return details;
  }

  async updateCurrency(currency: string) {
    let details = await tryGetCurrencyDetails(currency);
    details = await this.updateDetailsForAdminOverrides(currency, details);
    await idb.none(
      `
        UPDATE currencies SET
          name = $/name/,
          symbol = $/symbol/,
          decimals = $/decimals/,
          total_supply = $/totalSupply/,
          metadata = currencies.metadata || $/metadata:json/,
          updated_at = NOW()
        WHERE contract = $/contract/
      `,
      {
        contract: toBuffer(currency),
        ...details,
        name: sanitizeText(details.name) || null,
        symbol: sanitizeText(details.symbol) || null,
      }
    );
  }

  public async addToQueue(params: CurrenciesFetchJobPayload) {
    await this.send({ payload: params, jobId: params.currency });
  }
}

export const currenciesFetchJob = new CurrenciesFetchJob();

if (config.doBackgroundWork && config.enableUpdateTopCurrencies) {
  cron.schedule(
    config.updateTopCurrenciesSchedule ?? "30 23 * * *",
    async () =>
      await redlock
        .acquire([currenciesFetchJob.getQueue()], 60 * 1000)
        .then(async () => {
          await redb
            .manyOrNone(
              `
                SELECT contract
                FROM currencies
                WHERE EXISTS(SELECT 1 FROM currencies_pricing_provider WHERE currencies_pricing_provider.contract = currencies.contract LIMIT 1)
                ORDER BY all_time_volume_usd DESC LIMIT 500
            `
            )
            .then(async (currencies) =>
              currencies.forEach((currency) =>
                currenciesFetchJob.addToQueue({ currency: fromBuffer(currency.contract) })
              )
            )
            .catch(() => {
              // Skip on any errors
            });
        })
        .catch(() => {
          // Skip any errors
        })
  );
}
