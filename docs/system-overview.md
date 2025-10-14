# Indexer System Overview (Production Mode)

This document explains the runtime flow and how the indexer components interact when everything is enabled and running in a production‑like configuration.

## High‑Level Flow

- Detect new blocks via JSON‑RPC polling and WebSocket.
- Enqueue a realtime sync job per block to RabbitMQ.
- Consumers pull jobs, fetch logs/transactions, parse events, and write to Postgres.
- Redis provides locks and deduplication for idempotency and scheduling gates.
- Follow‑up jobs are scheduled for retries, write buffers, order/mint pipelines, and reorg checks.
- Optional: stream events to Kafka and index into Elasticsearch.

## Producers (new block detection)

- Polling cron: periodically checks the latest block and enqueues realtime jobs when `CATCHUP=1`.
  - File: `packages/indexer/src/jobs/events-sync/index.ts`
  - Key logic: schedules and adds to `events-sync-realtime`.

- WebSocket listener: when `ENABLE_WEB_SOCKET=1` and `MASTER=1`, listens for `block` events and enqueues realtime jobs (often with a small delay).
  - File: `packages/indexer/src/jobs/events-sync/index.ts`

- Realtime job enqueue helper:
  - File: `packages/indexer/src/jobs/events-sync/events-sync-realtime-job.ts`
  - Queue: `events-sync-realtime`

## RabbitMQ

- Vhost per chain: vhost name equals `CHAIN_NAME`.
- Delayed exchange is asserted at startup (requires the `rabbitmq_delayed_message_exchange` plugin):
  - File: `packages/indexer/src/common/rabbit-mq.ts`
  - Asserts exchange `x-delayed-message`; binds queues; uses `x-delay` header on publish when a delay is requested.
- Publishing:
  - With delay: publish to the delayed exchange with `x-delay` header.
  - Without delay: direct `sendToQueue` to the queue.
- Dead letters and policies: a dead letter queue is created per job; optional policies control max length and consumer timeouts.

## Consumers (workers)

- Startup connects to RabbitMQ and subscribes to all registered job queues (unless disabled).
  - File: `packages/indexer/src/jobs/index.ts`
- Concurrency, timeouts, single‑active‑consumer, and queue types are controlled per job via `AbstractRabbitMqJobHandler`.
  - File: `packages/indexer/src/jobs/abstract-rabbit-mq-job-handler.ts`
- Retry/backoff: failed jobs retry based on each job’s strategy and then move to dead‑letter queues when retries are exhausted.

## Realtime Event Processing (per‑block)

Consumer of `events-sync-realtime`:

- Updates a Redis marker for latest realtime block.
- Calls `syncEvents` for the specific block (fromBlock=toBlock=N).
- Schedules `traceSyncJob` post‑processing.
- File: `packages/indexer/src/jobs/events-sync/events-sync-realtime-job.ts`

`syncEvents` pipeline:

- Fetch block headers (with base/archive/backfill providers depending on options).
- Fetch logs for the topics of interest; fetch transactions for those logs.
- Parse logs into typed events and process in batches.
- Persist to Postgres (contentious tables use write‑buffer queues to avoid deadlocks).
- Schedule additional checks (eg. block gap checks, no‑transfer resyncs) and per‑block bookkeeping.
- File: `packages/indexer/src/sync/events/index.ts`

What a fresh block typically triggers (high‑level):

- Order lifecycle: `order-updates-by-id`, `order-updates-by-maker`, `permit-updates`, and storing on‑chain orders (`orderbook-orders-queue`).
- Token/collection updates: `transfer-updates`, `token-updates-mint-queue` (and `mints-process`), `recalc-owner-count-queue`.
- Activities for analytics/feeds (if enabled): `process-activity-event-queue` for fills and transfers.
- Follow‑ups: `fill-updates`, `fill-post-process`, `save-redis-transactions` (single‑block), `events-sync-block-check` (reorg/orphan detection).

## Deadlock Avoidance (write buffers)

- Single‑threaded write buffers reduce Postgres deadlocks for ft/nft transfers.
- FT/NFT write‑buffer jobs are regular RabbitMQ queues handled by workers.

## Reorg Handling

- Gap detection: backfills any missing blocks in the sequence.
- Orphan detection: detects mismatched block hashes, removes old data, and re‑enqueues the canonical block.
- File: `packages/indexer/src/sync/events/index.ts`

## Backfill

- Admin API triggers queued backfills for a block range (auto‑split into batches):
  - Endpoint: `POST /admin/sync-events`
  - Files: `packages/indexer/src/api/endpoints/admin/post-sync-events.ts`,
    `packages/indexer/src/jobs/events-sync/events-sync-backfill-job.ts`

## Optional Integrations

- Kafka (CDC / streaming):
  - File: `packages/indexer/src/jobs/cdc/index.ts`
  - Controlled by env flags (`DO_KAFKA_WORK`, `KAFKA_*`).

- Elasticsearch: Activities, tokens, asks, collections, currencies indexing via dedicated jobs.
  - Controlled by env flags (`DO_ELASTICSEARCH_WORK`, `ENABLE_ELASTICSEARCH_*`).

- Marketplace websockets (eg. OpenSea):
  - File: `packages/indexer/src/websockets/opensea/index.ts`
  - Controlled by `DO_WEBSOCKET_WORK` and API keys.

## API and Admin

- Hapi server exposes public APIs and admin endpoints (eg. `/admin/sync-events`).
- BullMQ UI is mounted with basic auth; most background compute is via RabbitMQ queues.
- File: `packages/indexer/src/api/index.ts`
