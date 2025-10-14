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

