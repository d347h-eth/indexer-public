import { Kafka, Producer, Consumer, logLevel } from "kafkajs";

import { config } from "@/config/index";
import { TopicHandlers } from "@/jobs/cdc/topics";
import { logger } from "@/common/logger";

let kafka: Kafka | undefined;
let producer: Producer | undefined;
let consumer: Consumer | undefined;

function getKafka(): Kafka {
  if (!kafka) {
    kafka = new Kafka({
      clientId: config.kafkaClientId,
      brokers: config.kafkaBrokers,
      logLevel: logLevel.ERROR,
    });
  }
  return kafka;
}

export async function startKafkaProducer(): Promise<void> {
  const k = getKafka();
  producer = k.producer();
  logger.info(`kafka-producer`, "Starting Kafka producer");
  const p = producer!;
  await p.connect();

  try {
    await new Promise((resolve, reject) => {
      p.on("producer.connect", async () => {
        logger.info(`kafka-producer`, "Producer connected");
        resolve(true);
      });

      setTimeout(() => {
        reject("Producer connection timeout");
      }, 60000);
    });
  } catch (e) {
    logger.error(`kafka-producer`, `Error connecting to producer, error=${e}`);
    await startKafkaProducer();
    return;
  }

  p.on("producer.disconnect", async (error) => {
    logger.error(`kafka-producer`, `Producer disconnected, error=${error}`);
    await restartKafkaProducer();
  });
}

export async function startKafkaConsumer(): Promise<void> {
  logger.info(`kafka-consumer`, "Starting Kafka consumer");
  const k = getKafka();
  consumer = k.consumer({
    groupId: config.kafkaConsumerGroupId,
    maxBytesPerPartition: config.kafkaMaxBytesPerPartition || 1048576,
    allowAutoTopicCreation: false,
  });
  const c = consumer!;
  await c.connect();

  const topicsToSubscribe = TopicHandlers.map((topicHandler) => {
    return topicHandler.getTopics();
  }).flat();

  logger.info(`kafka-consumer`, `Subscribing to topics=${JSON.stringify(topicsToSubscribe)}`);

  // Do this one at a time, as sometimes the consumer will re-create a topic that already exists if we use the method to subscribe to all
  // topics at once and one of the topics do not exist.
  await Promise.all(
    topicsToSubscribe.map(async (topic) => {
      await c.subscribe({ topic });
    })
  );

  await c.run({
    partitionsConsumedConcurrently: config.kafkaPartitionsConsumedConcurrently,

    eachBatchAutoResolve: true,

    eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
      const messagePromises = batch.messages.map(async (message) => {
        try {
          if (!message?.value) {
            return;
          }

          const event = JSON.parse(message.value!.toString());

          if (batch.topic.endsWith("-dead-letter")) {
            logger.info(
              `kafka-consumer`,
              `Dead letter topic=${batch.topic}, message=${JSON.stringify(event)}`
            );
            return;
          }

          for (const handler of TopicHandlers) {
            if (handler.getTopics().includes(batch.topic)) {
              if (!event.retryCount) {
                event.retryCount = 0;
              }

              await handler.handle(event, message.offset);
              break;
            }
          }

          await resolveOffset(message.offset);
        } catch (error) {
          try {
            logger.error(
              `kafka-consumer`,
              `Error handling topic=${batch.topic}, error=${error}, payload=${JSON.stringify(
                message
              )}`
            );
          } catch (error) {
            logger.error(
              `kafka-consumer`,
              `Error sending to dead letter topic=${batch.topic}, error=${error}}`
            );
          }
        }
      });

      await Promise.all(messagePromises);
      await heartbeat();
    },
  });

  c.on(c.events.CRASH, async (event) => {
    logger.info(
      `kafka-consumer`,
      JSON.stringify({
        message: "Consumer crashed",
        event,
      })
    );
    await restartKafkaConsumer();
  });

  c.on(c.events.DISCONNECT, async (event) => {
    logger.info(
      `kafka-consumer`,
      JSON.stringify({
        message: "Consumer disconnected",
        event,
      })
    );
    await restartKafkaConsumer();
  });

  c.on(c.events.STOP, async (event) => {
    logger.info(
      `kafka-consumer`,
      JSON.stringify({
        message: "Consumer stopped",
        event,
      })
    );
  });

  c.on(c.events.CONNECT, async (event) => {
    logger.info(
      `kafka-consumer`,
      JSON.stringify({
        message: "Consumer connected",
        event,
      })
    );
  });
}

// This can be used to restart the Kafka consumer, for example if the consumer is disconnected, or if we need to subscribe to new topics as
// we cannot subscribe to new topics while the consumer is running.
export async function restartKafkaConsumer(): Promise<void> {
  try {
    if (consumer) {
      await consumer.disconnect();
    }
  } catch (error) {
    logger.error(`kafka-consumer`, `Error disconnecting consumer, error=${error}`);
  }
  await startKafkaConsumer();
}

export async function restartKafkaProducer(): Promise<void> {
  try {
    if (producer) {
      await producer.disconnect();
    }
  } catch (error) {
    logger.error(`kafka-producer`, `Error disconnecting producer, error=${error}`);
  }
  await startKafkaProducer();
}
