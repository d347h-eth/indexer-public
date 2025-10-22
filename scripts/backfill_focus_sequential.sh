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

# Progress tracking
declare -i TOTAL_BLOCKS=0
declare -i PROCESSED=0

# UTC timestamped logger with progress prefix
log() {
  local pct=0
  if (( TOTAL_BLOCKS > 0 )); then
    pct=$(( (PROCESSED * 100) / TOTAL_BLOCKS ))
  fi
  printf '%s [%d%%] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$pct" "$*"
}

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

# Initialize progress
TOTAL_BLOCKS=$(( END - START + 1 ))
PROCESSED=0

# Minimal URL encoding for vhost ("/" -> "%2F"). For typical names (e.g., "mainnet") raw is fine.
VHOST_ENC="${VHOST////%2F}"

get_queue_counts() {
  # Args: queue_name; Echos: ready unack total; returns 0 on success, 1 if not found
  local q="$1"
  local json
  if ! json=$(curl -fsS -u "$RMQ_USER:$RMQ_PASS" "$RMQ_BASE/api/queues/$VHOST_ENC/$q" 2>/dev/null); then
    return 1
  fi
  # Try jq if present
  if command -v jq >/dev/null 2>&1; then
    local ready unack total
    ready=$(echo "$json" | jq -r '.messages_ready // 0')
    unack=$(echo "$json" | jq -r '.messages_unacknowledged // 0')
    total=$(echo "$json" | jq -r '.messages // 0')
    echo "$ready $unack $total"
    return 0
  fi
  # Fallback to sed parsing
  local ready unack total
  ready=$(echo "$json" | sed -n 's/.*"messages_ready"[[:space:]]*:[[:space:]]*\([0-9]\+\).*/\1/p' | head -n1)
  unack=$(echo "$json" | sed -n 's/.*"messages_unacknowledged"[[:space:]]*:[[:space:]]*\([0-9]\+\).*/\1/p' | head -n1)
  total=$(echo "$json" | sed -n 's/.*"messages"[[:space:]]*:[[:space:]]*\([0-9]\+\).*/\1/p' | head -n1)
  echo "${ready:-0} ${unack:-0} ${total:-0}"
}

wait_until_enqueued() {
  # Wait until we observe at least 1 message in the queue (or timeout)
  local q="$1"; local timeout="${2:-15}"; local t=0
  while (( t < timeout )); do
    if counts=$(get_queue_counts "$q"); then
      set -- $counts; local ready="$1"; local unack="$2"; local total="$3"
      if (( ready + unack > 0 )); then
        log "$q first enqueue observed: ready=$ready unack=$unack total=$total"
        return 0
      fi
    fi
    sleep 1; t=$((t+1))
  done
  return 0
}

wait_queue_empty() {
  local q="$1"
  # Per-queue last status cache (avoid duplicate logs)
  declare -gA LAST_QUEUE_STATUS
  while :; do
    if ! counts=$(get_queue_counts "$q"); then
      log "Queue $q not found (treat as empty)"
      return 0
    fi
    set -- $counts; local ready="$1"; local unack="$2"; local total="$3"
    if (( ready == 0 && unack == 0 )); then
      break
    fi
    local payload="ready=$ready unack=$unack total=$total"
    if [[ "${LAST_QUEUE_STATUS[$q]:-}" != "$payload" ]]; then
      log "$q pending: $payload"
      LAST_QUEUE_STATUS[$q]="$payload"
    fi
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

  # Absolute progress before submitting this window
  local passed=$(( from - START ))
  if (( passed < 0 )); then passed=0; fi
  if (( passed > TOTAL_BLOCKS )); then passed=$TOTAL_BLOCKS; fi
  local window_blocks=$(( to - from + 1 ))
  log "Submit backfill $from..$to (window=$window_blocks batch=$BATCH) [$passed/$TOTAL_BLOCKS]"
  curl -fsS -X POST "$API_BASE/admin/sync-events" \
    -H "x-admin-api-key: $ADMIN_KEY" \
    -H "content-type: application/json" \
    -d "$body" >/dev/null
}

for ((FROM=$START; FROM<=END; FROM+=WINDOW)); do
  TO=$(( FROM + WINDOW - 1 ))
  if (( TO > END )); then TO=$END; fi

  submit_window "$FROM" "$TO"

  # Ensure the backfill job has actually enqueued work before we start waiting for drain
  log "Waiting for enqueue on events-sync-backfill"
  wait_until_enqueued events-sync-backfill 20 || true

  # Wait for core backfill queues to drain before advancing
  for Q in \
    events-sync-backfill \
    events-sync-nft-transfers-write \
    events-sync-ft-transfers-write; do
    wait_queue_empty "$Q"
  done

  # Update completed progress after this window
  PROCESSED=$(( TO - START + 1 ))
  if (( PROCESSED > TOTAL_BLOCKS )); then PROCESSED=$TOTAL_BLOCKS; fi
  # Mirror submit payload shape: range + (window=... batch=...) + [processed/total]
  window_blocks=$(( TO - FROM + 1 ))
  log "Completed $FROM..$TO (window=$window_blocks batch=$BATCH) [$PROCESSED/$TOTAL_BLOCKS]"
done

log "All windows completed."
