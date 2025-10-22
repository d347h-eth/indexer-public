# Reservoir Indexer — Focus Extensions

This is a fork of Reservoir’s open‑sourced indexer. By default it behaves exactly like upstream (wide, multi‑collection indexing). In addition, this fork introduces an optional “focus mode” that you can enable via env to persist data only for a single ERC‑721 collection. We use this to keep a custom, collection‑specific frontend online after Reservoir’s infra sunset without indexing the entire chain.

**What’s in this fork (high level)**

- Focus mode (single collection)
  - `FOCUS_COLLECTION_ADDRESS=0x...` gates writes to the target collection while keeping pipelines intact. Optional `FOCUS_PERSIST_RELEVANT_TX=1` persists only transactions tied to focus events.
- Lean transaction writes
  - Backfill: no block‑transaction DB writes; Realtime: transactions cached to Redis (not DB) in focus mode.
- NFTX pool suppression
  - Prevents unrelated growth by skipping persistence of `nftx_*_pools` (and v3) unless the pool’s NFT matches the focus collection; decoding still works in‑memory.
- USD pricing toggle
  - `DISABLE_USD_PRICE_LOOKUPS=1` disables CoinGecko lookups (useful for backfills on free tier); native‑only pricing still works when applicable.
- Deterministic backfill
  - `scripts/backfill_focus_sequential.sh` submits windows and waits for queue drain; UTC timestamped logs with integer progress and window/batch info.
- Infra compatibility
  - RabbitMQ delayed exchange plugin (compose + management access documented), Kafka lazy init for local testing, Yarn 4 workspaces, admin OpenAPI.

## Quick Start (Focus)

- Bring up infra (Postgres, Redis, RabbitMQ, optional ES):
  - `docker compose -f packages/indexer/docker-compose.yaml up -d`
- Configure `packages/indexer/.env` (minimal):
  - Core: `ADMIN_API_KEY=...`, `CHAIN_ID=1`, `CHAIN_NAME=mainnet`, `PORT=3000`, `CIPHER_SECRET=...`, `IMAGE_TAG=dev`
  - RPC/DB/Redis: `BASE_NETWORK_HTTP_URL=...`, `DATABASE_URL=...`, `REDIS_URL=...`
  - Rabbit: `RABBIT_HOSTNAME=127.0.0.1`, `RABBIT_USERNAME=...`, `RABBIT_PASSWORD=...`, `ASSERT_RABBIT_VHOST=1`
  - Focus: `FOCUS_COLLECTION_ADDRESS=0xYourErc721` (required)
  - Optional: `FOCUS_PERSIST_RELEVANT_TX=1`, `DISABLE_USD_PRICE_LOOKUPS=1`
  - Runtime: `LOCAL_TESTING=0`, `DO_BACKGROUND_WORK=1`, `CATCHUP=0`, `MASTER=0`
- Install & start:
  - `yarn install`
  - `yarn build`
  - `yarn start`
- Backfill (sequential windows):
  - `ADMIN_KEY=... RMQ_USER=... RMQ_PASS=... VHOST=mainnet API_BASE=http://localhost:3000 RMQ_BASE=http://localhost:15672 ./scripts/backfill_focus_sequential.sh --start <from> --end <to> --window 500 --batch 50`

## Recommended Local RPC Tuning

- Prefer a backfill‑capable RPC or set `BASE_NETWORK_BACKFILL_URL` and use `useBackfillRpcProvider: true`.
- If running a local reth node for high‑parallel RPC, see “Local Node & OS Tuning” in `docs/troubleshooting.md` for flags, container ulimit, and host sysctls.

## Docs

- Focus mode details: `docs/focus-mode.md`
- Backfill & control (script, queues): `docs/backfill-and-control.md`
- RabbitMQ setup & reset: `docs/rabbitmq.md`
- Optional outputs (Kafka/ES/USD pricing toggle): `docs/optional-outputs.md`
- Troubleshooting (RPC, USD, tuning): `docs/troubleshooting.md`
