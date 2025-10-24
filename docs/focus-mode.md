# Focus Mode (Single‑Collection Scope)

## Purpose

Focus mode makes the indexer behave exactly as in wide mode, but only persist data that relates to a single ERC‑721 collection (the “focus” collection). It is not an optimization feature; it is a scoping feature. Pipelines, validations, and side effects remain unchanged. The only change is that non‑focus rows are not written.

## Enable

- Set in `packages/indexer/.env` (or env):
  - `FOCUS_COLLECTION_ADDRESS=0x...` (lower/normal checks handle case)
- Build and start as usual (`yarn build`, `yarn start`).
- No other toggles required. Live and backfill behave identically under focus.

## How It Works

- Capture remains wide: provider log filters are unchanged for realtime. For backfill, even if an address‑filter is requested, it is ignored when focus is set to avoid missing marketplace/payment logs.
- Gating happens after decode, inside the event → on‑chain‑data phase, before any writes/queues:
  - Keep explicit NFT signals for the focus contract (ERC‑721 transfers/approvals, fills/mints for that contract).
  - Include companion signals from the same transaction (eg. FT transfers used for payments, swaps traced in the same tx).
  - Then persist as usual and enqueue the same downstream jobs.

## Always Pass (Unfiltered in Focus Mode)

These operations only mutate existing rows. In a focus database, only focus rows exist, so letting them flow unfiltered keeps behavior identical to wide mode without extra logic:

- Order cancels
  - `cancelEvents` (per‑order), `bulkCancelEvents`, `nonceCancelEvents`.
  - Refinement (focus only): cancel_events rows are inserted only when they affect existing orders (so no irrelevant cancel rows). Wide mode is unchanged.
- Permit invalidations
  - EIP‑2612 permit invalidation logic runs unfiltered; it only touches existing orders/permits.
- Order/maker updates
  - `orderInfos` and `makerInfos` pass; they revalidate/update existing orders (buy- and sell‑side), unchanged from wide mode.
- Reorg/orphan cleanup
  - Block checks and unsync operations remove/fix only existing rows; no focus logic applied.

## Gated (Row‑Creating Inputs)

- NFT contract logs for the focus collection
  - ERC‑721 transfers/approvals; mints; fills recorded for the focus contract.
- “Same transaction” companions
  - FT transfers/payments and swaps are included only if they’re in the same transaction as focus signals.

## Marketplace & Internal Calls

- Marketplace/payment events emitted by exchange contracts are processed because capture is wide and gating looks at decoded content and transaction context.
- Transfers emitted via internal calls on the focus ERC‑721 contract are captured (eth_getLogs includes internal‑call logs from the emitting address).

## Backfill

- `/admin/sync-events` works identically to live under focus mode.
- If a request specifies `syncDetails.method = "address"`, the address filter is ignored when `FOCUS_COLLECTION_ADDRESS` is set (to avoid missing marketplace/payment logs). Decode‑time gating applies instead.

## Orderbook Ingestion (External)

- OpenSea websocket ingestion is gated under focus:
  - The WS client subscribes to a single collection slug when possible.
  - Set `FOCUS_COLLECTION_SLUG=<opensea-slug>` to force a slug subscription; otherwise the client will attempt to resolve the slug from `collections.slug` for `FOCUS_COLLECTION_ADDRESS` and fall back to `*` if not found.
  - A contract gate drops any incoming OS order whose `contract` != `FOCUS_COLLECTION_ADDRESS` (logs with `topic=focus-gate`).
- REST/other ingestion remains wide unless an explicit guard is added; in practice most orders include the target contract. For guaranteed focus‑only writes in other feeds, add a simple contract filter before enqueueing `orderbook-orders-queue`.

## Runtime Ownership Fallback (No‑Backfill Aid)

When starting fresh (no recent backfill), `nft_balances` might not yet reflect true ownership for the focus collection, causing fresh single‑token listings to be marked `no-balance` incorrectly.

To prevent that in focus mode, the Seaport off‑chain validation includes a focus‑guarded on‑chain recheck:

- Conditions
  - Focus is enabled (`FOCUS_COLLECTION_ADDRESS`) and the listing targets that contract.
  - The order is single‑token (has a specific `tokenId`).
  - DB check indicates insufficient maker balance.

- What happens
  - ERC‑721: call `ownerOf(tokenId)` and compare to maker.
  - ERC‑1155: call `balanceOf(maker, tokenId)` and compare to required quantity.
  - If confirmed, treat as having balance for this validation (do not write DB). Approvals are still checked as usual.

- Caching and logs
  - Result is cached in Redis for 60s: `focus-own:<chainId>:<contract>:<tokenId>:<maker>:<kind>[:<quantity>]`.
  - Logs: component `focus-onchain-balance`, topic `focus-onchain-balance-fallback`, include `{ orderId, contract, tokenId, maker, result, cached }`.

Rationale: this keeps live‑only focus runs from incorrectly rejecting valid listings, without polluting `nft_balances` or `nft_transfer_events`. A later backfill or realtime transfers will align DB state.

## Invariants

- Pipelines and validations are unchanged. The same downstream queues and DB updates run; the inputs are scoped.
- “Mass effect” maker actions (bulk/nonce cancels) behave exactly as wide mode; only focus orders exist, so only they are cancelled. In focus, cancel_events persistence is also scoped to existing orders.
- Fills always drive the correct buyer/seller updates; buy‑side ERC‑20 transfers in the same tx still trigger revalidation of remaining buy orders.

## Operational Notes

- Use standard runtime flags as needed (eg. `CATCHUP`, `MASTER`, `ENABLE_WEB_SOCKET`, `DO_BACKGROUND_WORK`). Focus mode does not require changes to them.
- For OpenSea WS, prefer setting both `FOCUS_COLLECTION_ADDRESS` and `FOCUS_COLLECTION_SLUG` so the client subscribes to `collection:<slug>` instead of wildcard.
- Optional: if you want a very quiet local run, disable optional subsystems (`DO_KAFKA_WORK=0`, `DO_KAFKA_STREAM_WORK=0`, `DO_ELASTICSEARCH_WORK=0`), but it’s not required for focus.
- Transactions persistence under focus:
  - Realtime (single-block jobs): transactions are cached to Redis for attribution/perf, but not written to DB.
  - Backfill (multi-block jobs): transactions are not written to DB.
  - If you need DB rows only for focus‑relevant transactions, enable `FOCUS_PERSIST_RELEVANT_TX=1`. The indexer will post‑gating insert only transactions that belong to focus events’ transactions.

## NFTX Pools (Focus Behavior)

- To prevent unrelated data growth, focus mode suppresses persistence of NFTX pool metadata:
  - `nftx_nft_pools`, `nftx_ft_pools`, and their v3 counterparts are not written unless the NFT pool’s underlying `nft` equals the focus collection. FT pools are not persisted at all under focus.
  - Decoding still reads pool details in-memory for pricing/attribution as needed; only the table writes are skipped.

## File Touchpoints (for reference)

- Focus config: `packages/indexer/src/config/index.ts` (`focusCollectionAddress`)
- Decode‑time gating: `packages/indexer/src/sync/events/handlers/utils/index.ts`
- Address‑mode backfill behavior: `packages/indexer/src/sync/events/index.ts`
- Cancel events scoping (focus only):
  - `packages/indexer/src/sync/events/storage/cancel-events/common.ts`
  - `packages/indexer/src/sync/events/storage/cancel-events/on-chain.ts`

## Known Follow‑Ups

- Add a focus guard for GenericOrderInfo before enqueuing `orderbook-orders-queue` to ensure externally ingested orders cannot write non‑focus rows.
- (Optional) Expose a runtime flag for including swap traces not in the same tx as explicit focus signals, if you need broader context for analytics.
