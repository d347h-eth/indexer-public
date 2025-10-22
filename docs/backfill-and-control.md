# Backfill and Granular Control

This guide explains how to trigger backfills, what you can filter on, and how to control which jobs run.

## Realtime vs Backfill

- Realtime (default): on startup the indexer follows the head of the chain (polling and/or WebSocket) and processes only new blocks.
- Backfill: historical ranges must be triggered manually via the admin endpoint. There is no automatic historical backfill on a fresh start.
- Reorg safety: orphan/mismatch checks may schedule small corrective backfills around detected orphaned blocks.

## Triggering Backfill via Admin API

Endpoint: `POST /admin/sync-events` (requires `X-Admin-Api-Key`).

Payload fields (key ones):

- `fromBlock` (number, required)
- `toBlock` (number, required)
- `blocksPerBatch` (number, default 32): backfill job auto-splits large ranges into chunks
- `syncEventsOnly` (boolean, default true): restricts to event syncing path (skip extras)
- `useArchiveRpcProvider` (boolean, default true): helpful for older ranges
- `useBackfillRpcProvider` (boolean): alternative provider for backfill
- `syncDetails` (optional):
  - Method `"events"` + `events: [subkind...]` to restrict to particular event subkinds
  - Method `"address"` + `address: <0x...>` to restrict to a single contract address

Examples:

- Backfill a block range (all supported events):
```
{
  "fromBlock": 19000000,
  "toBlock": 19001023,
  "blocksPerBatch": 32,
  "syncEventsOnly": true,
  "useArchiveRpcProvider": true
}
```

- Backfill a single ERC-721 contract over a range:
```
{
  "fromBlock": 19000000,
  "toBlock": 19005000,
  "syncEventsOnly": true,
  "useArchiveRpcProvider": true,
  "syncDetails": {
    "method": "address",
    "address": "0xabcDEF..."
  }
}
```

- Backfill specific event subkinds only:
```
{
  "fromBlock": 19000000,
  "toBlock": 19002000,
  "syncEventsOnly": true,
  "syncDetails": {
    "method": "events",
    "events": ["seaport-v1.5-orders-matched", "erc721-transfer"]
  }
}
```

Notes:

- Filtering by address sets `eventFilter.address` and fetches all supported topics for that address.
- Filtering by `events` limits topics to provided subkinds. Internally subkinds map to topics/handlers.
- `eventsType` can further limit which processed on-chain lists are kept (eg. `ftTransferEvents`). It’s optional and advanced.

## Recommended Backfill Strategy

- Start with recent ranges and work backwards in batches (eg. 20–50k blocks per request, or smaller if needed).
- Keep `syncEventsOnly=true` for throughput unless you explicitly need the full path.
- Use archive RPC for older ranges.
- Monitor queue lag and DB pressure; pause non-essential queues during heavy backfills if desired (see below).

## Granular Control Over Jobs

Coarse runtime toggles:

- Producers: `CATCHUP`, `ENABLE_WEB_SOCKET`, `MASTER`
- Consumers: `DO_BACKGROUND_WORK`
- Optional systems: `DO_WEBSOCKET_SERVER_WORK`, `DO_ELASTICSEARCH_WORK`, `DO_KAFKA_WORK`, `DO_KAFKA_STREAM_WORK`

Surgical (by queue):

- Pause a queue: `POST /admin/pause-rabbit-queue` with `{ "queueName": "<name>" }`
- Resume a queue: `POST /admin/resume-rabbit-queue` with `{ "queueName": "<name>" }`
- Find queue names in code: search for `queueName = "..."` under `packages/indexer/src/jobs`

Common queues by feature:

- Orders and orderbook: `order-updates-by-id`, `order-updates-by-maker`, `permit-updates`, `orderbook-orders-queue`
- Transfers/mints: `transfer-updates`, `token-updates-mint-queue`, `mints-process`, `fill-updates`, `fill-post-process`
- Ownership and activities: `recalc-owner-count-queue`, `process-activity-event-queue`
- Realtime block health: `events-sync-block-check`

## Fresh Start Behavior

- On a fresh database, the indexer follows the current head (realtime only); it does not automatically backfill historical data.
- You’re expected to trigger backfills manually via `/admin/sync-events`, iterating in reasonable batches.
- Some small corrective backfills can happen automatically if a realtime orphan block is detected (to fix data for that specific block range).

## Sequential Backfill Script (Focus Mode)

- Script: `scripts/backfill_focus_sequential.sh`
- Purpose: Submit fixed-size windows and wait for relevant queues to drain before advancing; emits UTC timestamped logs with integer progress.
- Usage example:
```
ADMIN_KEY=MY_KEY \
RMQ_USER=indexer RMQ_PASS=supersecret VHOST=mainnet \
API_BASE=http://localhost:3000 RMQ_BASE=http://localhost:15672 \
./scripts/backfill_focus_sequential.sh --start 13823015 --end 23633792 --window 500 --batch 50
```
- Behavior:
  - Submits `/admin/sync-events` with `{ blocksPerBatch, syncEventsOnly: true }` and waits until:
    - `events-sync-backfill` has enqueued messages for this window
    - `events-sync-backfill`, `events-sync-nft-transfers-write`, `events-sync-ft-transfers-write` are all drained (ready=0, unack=0)
  - Logs:
    - Submit: `Submit backfill start..end (window=N batch=B) [passed/total]`
    - Completed: identical payload shape
    - Queue status lines are printed only when counts change (no duplicates)
