# RabbitMQ Setup & Conventions

## Image & Plugins

- Compose uses `bitnamilegacy/rabbitmq:3.12` and pins `platform: linux/amd64` for x86 hosts.
- The delayed exchange plugin binary is not bundled by default; download and enable via env:
  - `RABBITMQ_COMMUNITY_PLUGINS` — space‑ or comma‑separated URLs to plugin `.ez` files.
    - Example: `https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/releases/download/v3.12.0/rabbitmq_delayed_message_exchange-3.12.0.ez`
  - `RABBITMQ_PLUGINS` — space‑separated list of plugins to enable.
    - Example: `rabbitmq_management rabbitmq_delayed_message_exchange`
  - Note: The plugin version must match the RabbitMQ minor version (3.12.x).

## Vhost & Credentials

- Vhost per chain: vhost name equals `CHAIN_NAME`.
- Credentials from env: `RABBIT_USERNAME` / `RABBIT_PASSWORD` (the app reads these; the compose sets the server with matching `RABBITMQ_USERNAME` / `RABBITMQ_PASSWORD`).
- Management URL is derived from env: `http://USER:PASS@HOST:15672`.
- For local development, enable remote Management UI/API access with:
  - `RABBITMQ_MANAGEMENT_ALLOW_WEB_ACCESS=true`
  - This is sufficient on Bitnami/bitnamilegacy images; no config mounts required.

## Exchanges & Queues

- Delayed exchange asserted on startup by the app (no manual setup required):
  - Name: `${CHAIN_NAME}.delayed`
  - Type: `x-delayed-message` with `x-delayed-type=direct`
- Each queue is asserted and bound to the delayed exchange with its own routing key.
- Dead‑letter queue is asserted for every job; optional per‑queue policies are created when needed.

Queue assertion timing
- On startup, a single instance (coordinated by `IMAGE_TAG` stored in Redis) asserts all queues/exchanges for the current code build.
- If you add new jobs (queues) at runtime and see `NOT_FOUND - no queue ...`:
  - Change `IMAGE_TAG` to a new unique value and restart the app; or
  - Delete Redis keys `rabbit_assert_queues_exchanges_hash` and the current `IMAGE_TAG` value, then restart the app.
- Restarting RabbitMQ alone does not create queues; the app assertion step does.

## Publishing Semantics

- With delay (ms): publish to delayed exchange with header `x-delay`.
- Without delay: publish directly to the queue (`sendToQueue`).
- Messages can include `jobId` for deduplication; a Redis lock prevents duplicates.

## Consumers

- Workers may use shared channels for low‑priority queues.
- Per‑job concurrency, backoff strategies, and timeouts are defined in each job class.
- `RABBIT_DISABLE_QUEUES_CONSUMING=1` disables consuming while still allowing producers to publish.
- Verify plugin availability (inside the container):
  - `docker exec rabbitmq rabbitmq-plugins list -e | grep delayed`
  - Should list `rabbitmq_delayed_message_exchange`.

## Resetting Queues Quickly

- Purge a single queue without dropping the broker:
  - `curl -u <user>:<pass> -X DELETE 'http://localhost:15672/api/queues/<vhost>/<queue>/contents'`
- Purge all queues in a vhost (requires `jq`):
  - `curl -s -u <user>:<pass> http://localhost:15672/api/queues/<vhost> | jq -r '.[].name' | xargs -I{} curl -u <user>:<pass> -X DELETE http://localhost:15672/api/queues/<vhost>/{}/contents`
- Full wipe: reset broker or drop/recreate the vhost; the indexer will re‑assert queues on boot if configured.
