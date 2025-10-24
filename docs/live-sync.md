Live Sync Setup (Production‑like)

Core env
- `DATABASE_URL=…`
- `REDIS_URL=…`
- `RABBIT_HOSTNAME=…`, `RABBIT_USERNAME=…`, `RABBIT_PASSWORD=…`
- `CHAIN_ID=1`, `CHAIN_NAME=mainnet`
- RPC URLs:
  - `BASE_NETWORK_HTTP_URL=https://…`
  - `BASE_NETWORK_WS_URL=wss://…` (set `ENABLE_WEB_SOCKET=1`)

Enable producers + consumers
- `MASTER=1` — enable producers on this pod
- `CATCHUP=1` — polling producers enabled
- `ENABLE_WEB_SOCKET=1` — WS block enqueue
- `DO_BACKGROUND_WORK=1` — workers (RabbitMQ consumers)
- `RABBIT_DISABLE_QUEUES_CONSUMING=0` — ensure not paused

Focus (single collection)
- `FOCUS_COLLECTION_ADDRESS=0x…`
- `FOCUS_COLLECTION_SLUG=<opensea-slug>` (recommended; narrows OS WS subscription)

OpenSea ingestion
- `DO_WEBSOCKET_WORK=1`
- `OPENSEA_API_KEY=…`
- `OPENSEA_CHAIN_NAME=ethereum`

Optional outputs (disable unless used)
- Kafka: `DO_KAFKA_WORK=0`, `DO_KAFKA_STREAM_WORK=0`
- Elasticsearch: `DO_ELASTICSEARCH_WORK=0`
- WS server emitter: `DO_WEBSOCKET_SERVER_WORK=0`

Trace & gap knobs
- Traces: `DISABLE_SYNC_TRACES=0` (keep on unless your node can’t handle it)
- Gap detection: `ENABLE_BLOCK_GAP_CHECK=1`
- USD lookups: `DISABLE_USD_PRICE_LOOKUPS=1` to avoid upstream calls during dev

Read replica
- In development set: `READ_REPLICA_DATABASE_URL` = `DATABASE_URL` (so APIs read the same DB writes land in).

API keys
- Most read endpoints work without `x-api-key`; requests are rate‑limited by IP.
- Admin routes require `x-admin-api-key=ADMIN_API_KEY`.

Start
- `yarn build && yarn start`

Verification
- OS WS: logs `opensea-websocket` with `topic=subscription` and `topic=focus-gate` for dropped events.
- Orders persisted: `/orders/asks/v5?status=any&sortBy=updatedAt` and `/orders/bids/v6?status=any&sortBy=updatedAt`.
- Conduit warmup: if you see `unsupported-conduit`, a one‑time refresh+retry is done. For hygiene, run a small backfill (25k–50k blocks) with `syncEventsOnly=true`, `skipTransactions=true`.
- Focus fallback: for single‑token listings on the focus collection, if DB hasn’t backfilled balances yet, a short‑lived on‑chain ownership check keeps valid listings from being marked `no-balance` (cached 60s). See `docs/focus-mode.md#runtime-ownership-fallback-no-backfill-aid`.

Focus DB seed (export/import)
- Use the script: `scripts/db/focus-db.sh` (runs both export and import; supports schema‑qualifying table names). This replaces having a separate doc. Common usage:
  - Export: `./scripts/db/focus-db.sh export --source-url <URL> --contract 0xYourContract --out-dir ./dump_focus --schema-out ./dump_focus/schema.sql [--schema public]`
  - Import: `./scripts/db/focus-db.sh import --target-url <URL> --in-dir ./dump_focus --schema-in ./dump_focus/schema.sql [--schema public]`
  - Container‑friendly commands are included as comments in the script header.
