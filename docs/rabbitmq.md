# RabbitMQ Setup & Conventions

## Image & Plugins

- Compose uses `rabbitmq:3.12-management` and pins `platform: linux/amd64` for x86 hosts.
- The `rabbitmq_delayed_message_exchange` plugin is enabled via:
  - `packages/indexer/docker/rabbitmq/enabled_plugins`
  - Mount path in compose: `/etc/rabbitmq/enabled_plugins`

## Vhost & Credentials

- Vhost per chain: vhost name equals `CHAIN_NAME`.
- Credentials from env: `RABBIT_USERNAME` / `RABBIT_PASSWORD`.
- Management URL is derived from env: `http://USER:PASS@HOST:15672`.

## Exchanges & Queues

- Delayed exchange asserted on startup:
  - Name: `${CHAIN_NAME}.delayed`
  - Type: `x-delayed-message` with `x-delayed-type=direct`
- Each queue is asserted and bound to the delayed exchange with its own routing key.
- Dead‑letter queue is asserted for every job; optional per‑queue policies are created when needed.

## Publishing Semantics

- With delay (ms): publish to delayed exchange with header `x-delay`.
- Without delay: publish directly to the queue (`sendToQueue`).
- Messages can include `jobId` for deduplication; a Redis lock prevents duplicates.

## Consumers

- Workers may use shared channels for low‑priority queues.
- Per‑job concurrency, backoff strategies, and timeouts are defined in each job class.
- `RABBIT_DISABLE_QUEUES_CONSUMING=1` disables consuming while still allowing producers to publish.

