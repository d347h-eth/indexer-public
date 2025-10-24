OpenSea Ingestion (Focus + Realtime)

Summary
- The indexer ingests OpenSea events via the Stream client and writes Seaport orders into `orders`.
- In focus mode, OS WS ingestion is narrowed by slug and gated by contract so only the focus collection creates rows.
- The Seaport save path now refreshes conduit “open channels” on demand to avoid first‑order rejections.

Config
- Required: `DO_WEBSOCKET_WORK=1`, `OPENSEA_API_KEY=…`, `OPENSEA_CHAIN_NAME=ethereum` (or your chain).
- Focus: `FOCUS_COLLECTION_ADDRESS=0x…`, strongly recommended `FOCUS_COLLECTION_SLUG=<opensea-slug>`.

Subscription behavior
- If `FOCUS_COLLECTION_SLUG` is set: subscribe to `collection:<slug>`.
- Else if only `FOCUS_COLLECTION_ADDRESS` is set: auto‑resolve `collections.slug` for the contract, subscribe if found; otherwise fall back to `collection:*`.
- Log: component `opensea-websocket`, topic `subscription`, field `subscribe` shows the topic.
- Guard: when focus is set, drop any WS event whose `contract` != `FOCUS_COLLECTION_ADDRESS` (log `topic=focus-gate`).

WS → Order save
- parseProtocolData(payload) must contain `protocol_data` and a known Seaport `protocol_address` (v1.1/v1.4/v1.5/v1.6). Unknown protocol logs `topic=unknown-protocol`.
- Listings → `orderbook-opensea-listings-queue`; Bids/offers → `orderbook-opensea-bids-queue`.
- Save path (Seaport v1.4/v1.5/v1.6):
  - Validates signature/expiry/orderType/prices/payment token.
  - Checks conduit “open channel” (conduitKey, Exchange address). If unsupported, does a one‑time `refresh(conduit)` from ConduitController and retries before returning `unsupported-conduit`.
  - Inserts into `orders` and enqueues `order-updates-by-id`.

Troubleshooting
- No rows in `orders` but WS events are flowing:
  - Use `/orders/asks/v5?status=any&sortBy=updatedAt` (and equivalent for bids) to bypass “active only”. Active = `fillable` + `approved`.
  - Ensure API reads same DB as workers: set `READ_REPLICA_DATABASE_URL` = `DATABASE_URL` in dev.
  - Check logs for `parseProtocolData missing` or `unknown-protocol` (WS payload lacks sufficient info) and for `unsupported-conduit` (see below).

Conduit channels and small backfill
- Conduit “open channels” are cached in `seaport_conduit_open_channels` from on‑chain `seaport-channel-updated` events.
- In focus mode these infra events are still decoded and applied; if you started mid‑stream, run a small backfill (e.g., last 25k–50k blocks) with `syncEventsOnly=true`, `skipTransactions=true` to warm caches.
- Gap detection (`ENABLE_BLOCK_GAP_CHECK=1`) is safe and only backfills missing recent blocks.

