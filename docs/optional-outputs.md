# Optional Outputs: What They Enable

This doc explains what enabling Kafka, Elasticsearch, and Websocket triggers provides feature‑wise.

## Kafka

There are two Kafka integrations:

- CDC consumer (`DO_KAFKA_WORK=1`): consumes database change topics and triggers internal jobs. Useful for ingesting external change streams or cross‑service coordination.
  - Code: `packages/indexer/src/jobs/cdc/index.ts`, `packages/indexer/src/jobs/cdc/topics/*`

- Websocket event streaming (`DO_KAFKA_STREAM_WORK=1`): publishes high‑level domain events (asks, bids, sales, transfers, tokens, collections) to Kafka topics for external consumers.
  - Code: `packages/indexer/src/jobs/websocket-events/utils.ts`, `publishEventToKafkaStreamJob`
  - Topic naming: `ks.<chain>.<entity>s` (e.g., `ks.mainnet.asks`)

Enabling Kafka gives you:

- Near real‑time event bus for downstream services (analytics, notifications, indexing, ML pipelines).
- Durable replay and decoupling from the indexer’s internal queueing.
- A stable, typed stream of changes (create/update with `changed` keys, offsets, tags).

Recommended when:

- You have other services reacting to market activity, transfers, or metadata changes.
- You need durable cross‑service delivery and backpressure handling.

## Elasticsearch

When `DO_ELASTICSEARCH_WORK=1` (and relevant `ENABLE_ELASTICSEARCH_*` flags), the indexer pushes curated views to ES indices (activities, asks, tokens, collections, currencies).

Enabling Elasticsearch gives you:

- Fast, flexible search/filter/sort over large datasets (feeds, listings, token searches, collection browse).
- Efficient aggregations (counts, sums) and sorted queries impractical on hot Postgres tables.
- Backfill/cleanup jobs to keep indices consistent (including reorg handling support by removing orphaned events).

Recommended when:

- You power user‑facing search/feeds or need low‑latency, complex queries across large volumes.

## Websocket Triggers

When `DO_WEBSOCKET_SERVER_WORK=1`, the indexer emits domain events to a Redis pub/sub channel for a websocket gateway (“firehose”) to broadcast to clients.

- Publisher: `packages/indexer/src/common/websocketPublisher.ts` publishes to `<chain>-ws-events`.
- Trigger jobs: `packages/indexer/src/jobs/websocket-events/*` build event payloads and enqueue via RabbitMQ, then publish.
- Router: `packages/indexer/src/jobs/websocket-events/websocket-event-router.ts` maps event kinds to trigger queues.

Event types include:

- Orders: `ask.created/updated`, `bid.created/updated`
- Sales: `sale.created`
- Transfers: `transfer.created`
- Tokens/Collections: token/collection changes (including attribute changes)
- Pending transactions (if enabled)

Event payload shape:

```
{
  published_at: <ms>,
  event: "ask.created" | "ask.updated" | "sale.created" | ...,
  changed?: ["status", "price.gross.amount", ...],
  tags: { contract, source, maker, taker, ... },
  data: { ...domain enriched fields... },
  offset?: <cdc offset>
}
```

Enabling websocket triggers gives you:

- Real‑time push to clients via your websocket gateway (subscribe by tags/event types).
- Decoupled broadcasting (indexer → Redis → gateway), minimizing load on the indexer.

Recommended when:

- You need live updates in apps (orderbooks, sales feeds, token/collection updates) without polling APIs.

## How they relate

- Websocket triggers and Kafka streaming emit similar high‑level events:
  - Websockets target end‑user apps (UI/clients) via Redis pub/sub → gateway.
  - Kafka streams target backend services needing durable, replayable streams.
- Elasticsearch supports query patterns that complement both (fast UI queries, analytics reads).
## USD Price Lookups

- The indexer converts some prices to USD for enrichment using upstream providers (CoinGecko) when cached prices for the day are missing.
- Backfills can easily hit provider rate limits. To completely disable upstream USD lookups and avoid network calls, set:
  - `DISABLE_USD_PRICE_LOOKUPS=1`
- Notes:
  - Native-only pricing still works when the priced currency equals the native token; USD conversions will be omitted unless already cached in DB (usd_prices tables).
