#!/usr/bin/env bash
set -euo pipefail

# Deterministic backfill driver for focus mode.
# Submits /admin/sync-events in fixed windows and waits for relevant queues to drain
# before advancing to the next window.

# Required env:
#   ADMIN_KEY   - Admin API key for the indexer
#   RMQ_USER    - RabbitMQ username
#   RMQ_PASS    - RabbitMQ password
# Optional env:
#   VHOST       - RabbitMQ vhost (defaults to "mainnet")
#   API_BASE    - Indexer base URL (defaults to http://localhost:3000)
#   RMQ_BASE    - RabbitMQ mgmt base URL (defaults to http://localhost:15672)
#   USE_BACKFILL_PROVIDER - if set to 1, send useBackfillRpcProvider=true

usage() {
  cat <<EOF
Usage: $0 --start <fromBlock> --end <toBlock> [--window 500] [--batch 50]

Env:
  ADMIN_KEY (required), RMQ_USER (required), RMQ_PASS (required)
  VHOST (default: mainnet), API_BASE (default: http://localhost:3000), RMQ_BASE (default: http://localhost:15672)

Example:
  ADMIN_KEY=MY_KEY \
  RMQ_USER=indexer RMQ_PASS=supersecret VHOST=mainnet \
  API_BASE=http://localhost:3000 RMQ_BASE=http://localhost:15672 \
  $0 --start 13823015 --end 23633792 --window 500 --batch 50
EOF
}

require() { [ -n "${!1:-}" ] || { echo "Missing env: $1" >&2; exit 1; }; }

START=""
END=""
WINDOW=500
BATCH=50
API_BASE="${API_BASE:-http://localhost:3000}"
RMQ_BASE="${RMQ_BASE:-http://localhost:15672}"
VHOST="${VHOST:-mainnet}"
USE_BACKFILL_PROVIDER="${USE_BACKFILL_PROVIDER:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start) START="$2"; shift 2;;
    --end) END="$2"; shift 2;;
    --window) WINDOW="$2"; shift 2;;
    --batch) BATCH="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1;;
  esac
done

[[ -n "$START" && -n "$END" ]] || { echo "--start and --end are required" >&2; usage; exit 1; }
require ADMIN_KEY
require RMQ_USER
require RMQ_PASS

# Minimal URL encoding for vhost ("/" -> "%2F"). For typical names (e.g., "mainnet") raw is fine.
VHOST_ENC="${VHOST//\/%2F}"

wait_queue_empty() {
  local q="$1"
  while :; do
    # Silence curl output; if the queue is missing, treat as empty
    local json
    if ! json=$(curl -fsS -u "$RMQ_USER:$RMQ_PASS" "$RMQ_BASE/api/queues/$VHOST_ENC/$q" 2>/dev/null); then
      echo "Queue $q not found (treat as empty)" >&2
      return 0
    fi
    local ready unack
    ready=$(echo "$json" | sed -n 's/.*"messages_ready":[[:space:]]*\([0-9]*\).*/\1/p' | head -n1)
    unack=$(echo "$json" | sed -n 's/.*"messages_unacknowledged":[[:space:]]*\([0-9]*\).*/\1/p' | head -n1)
    ready=${ready:-0}; unack=${unack:-0}
    if [[ "$ready" == "0" && "$unack" == "0" ]]; then
      break
    fi
    echo "$q pending: ready=$ready unack=$unack"
    sleep 2
  done
}

submit_window() {
  local from="$1"; local to="$2"
  local body
  if [[ "$USE_BACKFILL_PROVIDER" == "1" ]]; then
    body=$(cat <<JSON
{"fromBlock":$from,"toBlock":$to,"blocksPerBatch":$BATCH,"syncEventsOnly":true,"useArchiveRpcProvider":true,"useBackfillRpcProvider":true}
JSON
)
  else
    body=$(cat <<JSON
{"fromBlock":$from,"toBlock":$to,"blocksPerBatch":$BATCH,"syncEventsOnly":true,"useArchiveRpcProvider":true}
JSON
)
  fi

  echo "Submit backfill $from..$to (batch=$BATCH)"
  curl -fsS -X POST "$API_BASE/admin/sync-events" \
    -H "x-admin-api-key: $ADMIN_KEY" \
    -H "content-type: application/json" \
    -d "$body" >/dev/null
}

for ((FROM=$START; FROM<=END; FROM+=WINDOW)); do
  TO=$(( FROM + WINDOW - 1 ))
  if (( TO > END )); then TO=$END; fi

  submit_window "$FROM" "$TO"

  # Wait for core backfill queues to drain before advancing
  for Q in \
    events-sync-backfill \
    events-sync-nft-transfers-write \
    events-sync-ft-transfers-write; do
    wait_queue_empty "$Q"
  done

  echo "Completed $FROM..$TO"
done

echo "All windows completed."

