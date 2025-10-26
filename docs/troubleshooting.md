# Troubleshooting Cheatsheet

This document captures fixes applied and common issues encountered while bringing up the project locally.

## RabbitMQ image platform mismatch

Symptom:

- Docker logs: image platform `linux/arm64/v8` vs host `linux/amd64`.

Fix applied:

- Updated `packages/indexer/docker-compose.yaml` to use the official multi‑arch image and pin amd64:
  - `image: rabbitmq:3.12-management`
  - `platform: linux/amd64`
- Added plugin mount for delayed exchange support:
  - `packages/indexer/docker/rabbitmq/enabled_plugins` contains:
    - `[rabbitmq_management, rabbitmq_delayed_message_exchange].`

## Delayed exchange plugin is required

Evidence in code:

- Asserting delayed exchange: `packages/indexer/src/common/rabbit-mq.ts:329`
- Binding queues to delayed exchange: `packages/indexer/src/common/rabbit-mq.ts:364`, `packages/indexer/src/common/rabbit-mq.ts:371`
- Publishing with `x-delay` header: `packages/indexer/src/common/rabbit-mq.ts:170`

If the plugin isn’t enabled, assertion/publish will fail.

## Rabbit publish errors: `sendToQueue` of undefined

Symptom:

- Logs like `rabbit-publish-error ... Cannot read properties of undefined (reading 'sendToQueue')` for queue `events-sync-realtime`.

Cause:

- Producers were active (CATCHUP/WS) but the app hadn’t connected to RabbitMQ (previous LOCAL_TESTING logic skipped connection).

Fix applied:

- `packages/indexer/src/index.ts` now always connects to RabbitMQ and asserts queues/exchanges before importing `setup`.

Workarounds:

- To avoid any publishing, disable producers:
  - `CATCHUP=0`, `MASTER=0`, `ENABLE_WEB_SOCKET=0`.
- To process messages, enable consumers:
  - `DO_BACKGROUND_WORK=1` or `FORCE_ENABLE_RABBIT_JOBS_CONSUMER=1`.

## KafkaJS `Consumer groupId must be a non-empty string`

Symptom:

- Crash on startup despite `DO_KAFKA_WORK=0`.

Cause:

- The CDC module constructs a consumer at import time.

Mitigations:

- Set a dummy `KAFKA_CONSUMER_GROUP_ID` (eg. `test`) or refactor to lazy‑initialize the consumer only when `DO_KAFKA_WORK=1`.
  - Code: `packages/indexer/src/jobs/cdc/index.ts`

## Yarn workspaces: `Workspace not found` / lockfile issues

Symptoms:

- `@reservoir0x/mint-interface@npm:*: Package not found` (package exists locally).
- `Workspace not found (@reservoir0x/mint-interface@workspace:*)`.
- Turbo build: `This package doesn't seem to be present in your lockfile`.

Fixes applied:

- Use workspace protocol with actual versions:
  - `packages/indexer/package.json`: `@reservoir0x/mint-interface: "workspace:^0.0.1"`, `@reservoir0x/sdk: "workspace:^0.0.372"`.
  - `packages/contracts/package.json`: `@reservoir0x/sdk: "workspace:^0.0.372"`.
- Anchor Yarn and configure node‑modules linker:
  - `package.json`: `"packageManager": "yarn@4.9.4"`.
  - `.yarnrc.yml`: `nodeLinker: node-modules`, `enableImmutableInstalls: false`, `progressBarStyle: default`.
- Always run `yarn install` at repo root, not inside subpackages.

## Hapi plugin TypeScript errors

Symptom:

- Overload/type errors on `server.register(...)` with `@hapi/basic`, `@hapi/inert`, `@hapi/vision`, `hapi-swagger`, `hapi-pulse`.

Fix applied:

- Cast plugin registrations to `Hapi.Plugin<any>` / `Hapi.ServerRegisterPluginObject<any>` to satisfy the v20 type signatures.
  - File: `packages/indexer/src/api/index.ts`

## Running the stack

1) Install/build:
   - `yarn install`
   - `yarn build`
2) Infra (optional, for full stack):
   - `docker compose -f packages/indexer/docker-compose.yaml up -d`
3) Start:
   - `yarn start`

## RPC rate limits and USD price lookups

Symptoms:

- Logs show `429 Too Many Requests` when fetching USD prices from CoinGecko during backfill.

Options:

- Provide a `COINGECKO_API_KEY` to use the pro API fallback.
- Or completely disable upstream USD price lookups:
  - Set `DISABLE_USD_PRICE_LOOKUPS=1` in `packages/indexer/.env`.
  - Native-only pricing still works when the currency equals the native token; USD conversions are omitted unless already cached in DB.

## ECONNRESET / socket hangups from local RPC

Symptoms:

- Backfill fails intermittently with `missing response` or `socket hang up` on `eth_getTransactionByHash`/logs.

Mitigations:

- Reduce pressure: smaller `blocksPerBatch` (e.g., 32 or 16), smaller windows; keep the sequential backfill script.
- Use a dedicated backfill endpoint: set `BASE_NETWORK_BACKFILL_URL` and request with `useBackfillRpcProvider: true`.
- Tune local reth and OS:
  - reth flags (RPC-only):
    - `--http --http.addr 0.0.0.0 --http.port 8545 --http.api eth,net,web3`
    - `--ipcdisable --http.disable-compression --disable-tx-gossip`
    - `--rpc.max-connections 20000 --rpc.max-request-size 64 --rpc.max-response-size 256`
    - `--rpc.max-logs-per-response 0 --rpc.max-blocks-per-filter 0`
    - `--rpc-cache.max-blocks 20000 --rpc-cache.max-receipts 10000 --rpc-cache.max-headers 10000 --rpc-cache.max-concurrent-db-requests 2048`
    - `--db.max-readers 2048`
  - Docker Compose ulimit for reth:
    - `ulimits: { nofile: { soft: 1048576, hard: 1048576 } }`
  - Host sysctl (`/etc/sysctl.d/99-reth-tuning.conf`):
    - `net.core.somaxconn=65535`
    - `net.core.netdev_max_backlog=262144`
    - `net.ipv4.tcp_max_syn_backlog=262144`
    - `net.ipv4.ip_local_port_range=10240 65535`
    - `net.ipv4.tcp_tw_reuse=1`
    - `net.ipv4.tcp_fin_timeout=15`
    - `net.ipv4.tcp_keepalive_time=60`
    - `net.ipv4.tcp_keepalive_intvl=30`
    - `net.ipv4.tcp_keepalive_probes=5`
    - `fs.file-max=1048576`
  - Recreate only the reth service and verify in the container: `ulimit -Sn; ulimit -Hn`.

## Resetting RabbitMQ queues for backfill

- Purge a specific queue (keeps broker/vhost/users):
  - `DELETE /api/queues/<vhost>/<queue>/contents`
  - Example: `curl -u indexer:supersecret -X DELETE 'http://localhost:15672/api/queues/mainnet/events-sync-backfill/contents'`
- Purge all queues in a vhost:
  - `curl -s -u indexer:supersecret http://localhost:15672/api/queues/mainnet | jq -r '.[].name' | xargs -I{} curl -u indexer:supersecret -X DELETE http://localhost:15672/api/queues/mainnet/{}/contents`
- Full wipe (all queues/messages): reset broker or drop the vhost; the app will re‑assert queues if configured.
# Troubleshooting

## WebSocket provider: wrong TLS version / EPROTO

Error:

```
WebSocket subscription failed: Error: write EPROTO ... ssl3_get_record:wrong version number
```

Cause: `BASE_NETWORK_WS_URL` uses the wrong scheme/port (e.g., `https://` or HTTP port for WS).

Fix:
- Use `ws://` or `wss://` with your node’s WS port (e.g., 8546 locally; provider‑specific for Alchemy/Infura).
- Example: `wss://eth-mainnet.g.alchemy.com/v2/<KEY>` or `wss://mainnet.infura.io/ws/v3/<KEY>`.
- If using a proxy/terminator, ensure it supports WS upgrade and TLS is where you expect it.

## Ethers “duplicate definition – supportsInterface(bytes4)” spam

These come from ethers Interface merging ABIs that contain ERC165 fragments multiple times. They’re benign but noisy.

What we do:
- Filter the specific supportsInterface duplicate warning.
- Set ethers logger level to `ERROR` to suppress warning/info/debug. Code: `packages/indexer/src/config/polyfills.ts`.

## Traces fetch noise or TypeError in getTxTraces

Some RPCs return malformed traces. The trace fetcher now:
- Sanitizes trace entries before persistence.
- Falls back to per‑tx fetch when a batch fails and logs the offending tx hash.

## “unsupported-conduit” on Seaport orders

Meaning: the order’s `conduitKey` has not (yet) whitelisted the Seaport Exchange address as an open channel.

What we do:
- On first failure, derive the conduit address, refresh channels from `ConduitController.getChannels` and retry the check.
- If still unsupported, the order is correctly rejected.

Warm up tip:
- Run a small backfill (25k–50k blocks) with `syncEventsOnly=true`, `skipTransactions=true` to warm `seaport_conduit_open_channels`.

## Orders API empty even though WS events arrive

- APIs default to "active only". Try `status=any&sortBy=updatedAt` while testing:
  - `/orders/asks/v5?status=any&sortBy=updatedAt&limit=50`
  - `/orders/bids/v6?status=any&sortBy=updatedAt&limit=50`
- Confirm the API reads from the same DB as the workers (`READ_REPLICA_DATABASE_URL` unset or = `DATABASE_URL`).
- Check queue consumption: `orderbook-opensea-*-queue` should drain; `DO_BACKGROUND_WORK=1`, `RABBIT_DISABLE_QUEUES_CONSUMING=0`.

## Blur V2 / Blend fills not persisting

**Symptoms:**
- Blur V2 Execution events are captured in logs but no fill appears in `fill_events_2`
- Logs show `topic: "no-executeCallTrace"` for marketplace transactions

**Root cause:**
- Blur V2 Exchange uses a DELEGATECALL pattern where the Exchange contract immediately delegates to an implementation contract
- When traces are cached to DB, only the DELEGATECALL is saved (not the root CALL to the Exchange)
- The trace structure becomes: `{ hash, calls: [{ type: "DELEGATECALL", from: Exchange, to: Delegate, input: "0x70bce2d6..." }] }`
- Original handlers only matched on `to === Exchange`, missing DELEGATECALLs where `from === Exchange`

**Fix applied:**
- Handlers now check both `to` and `from` fields when matching marketplace calls
- DB wrapper format is detected and unwrapped: `calls[0]` is extracted from the array
- Code: `packages/indexer/src/sync/events/handlers/blur-v2.ts`, `blend.ts`

**Verification:**
- Successful processing logs: `{"topic":"found-at-root","matchedVia":"from"}` for DELEGATECALL matches
- Successful processing logs: `{"topic":"found-at-root","matchedVia":"to"}` for regular CALL matches
- Fills persist to `fill_events_2` and appear in APIs
