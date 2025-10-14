# Local Operations & Profiles

This guide explains how to run the indexer locally and which environment flags control producers/consumers and optional systems.

## Profiles

### API‑Only (no queues, no producers)

Use this to boot the API without RabbitMQ/Kafka side effects:

- In `packages/indexer/.env` set:
  - `CATCHUP=0`
  - `MASTER=0`
  - `ENABLE_WEB_SOCKET=0`
  - `DO_BACKGROUND_WORK=0`
  - `DO_EVENTS_SYNC_BACKFILL=0`
  - `DO_KAFKA_WORK=0`

Start from repo root:

- `yarn install`
- `yarn build`
- `yarn start`

### Full Local Stack (producers + consumers)

Bring up infra (Postgres/Redis/RabbitMQ/Elasticsearch):

- `docker compose -f packages/indexer/docker-compose.yaml up -d`

In `packages/indexer/.env`:

- Core
  - `CATCHUP=1` (poll for new blocks)
  - `MASTER=1` (single master for websocket/poll producers)
  - `ENABLE_WEB_SOCKET=1` (ethers WebSocket block events)
  - `DO_BACKGROUND_WORK=1` (enable Rabbit consumers)
- Optional
  - `DO_KAFKA_WORK=0` unless you’ve configured Kafka
  - `DO_ELASTICSEARCH_WORK=0` unless you run ES and want indexing

Start from repo root:

- `yarn install`
- `yarn build`
- `yarn start`

Backfill (manual):

- Fresh boots only follow new blocks. To ingest history, call the admin API:
  - `POST /admin/sync-events` with a block range and optional filters (see docs/backfill-and-control.md).
  - Run in batches and monitor queue/DB load.

## RabbitMQ Notes

- Compose uses `rabbitmq:3.12-management` with the delayed‑message plugin enabled.
- Management UI at `http://localhost:15672` (default `guest`/`guest`).
- Vhost equals `CHAIN_NAME` and is asserted on startup.
- Delayed exchange `${CHAIN_NAME}.delayed` is asserted; queues bind to it and publish via `x-delay` headers when needed.

## Kafka Notes

- Kafka is optional. The code constructs a consumer in the CDC module; set `DO_KAFKA_WORK=0` to avoid starting it.
- Some installs still require `KAFKA_CONSUMER_GROUP_ID` to be set because of eager construction; if needed, set a dummy value (eg. `test`).
- For a strict opt‑in, consider lazy initializing the consumer only when `DO_KAFKA_WORK=1`.

## Environment Flags (Key)

- Producers
  - `CATCHUP` (polling cron)
  - `ENABLE_WEB_SOCKET` + `MASTER` (WebSocket producer)
- Consumers
  - `DO_BACKGROUND_WORK` (enable Rabbit consumers)
  - `RABBIT_DISABLE_QUEUES_CONSUMING` (permanently disable consuming; not recommended for full stack)
- Optional Systems
  - `DO_KAFKA_WORK`, `KAFKA_*`
  - `DO_ELASTICSEARCH_WORK`, `ELASTICSEARCH_*`
  - `DO_WEBSOCKET_WORK` + marketplace API keys
