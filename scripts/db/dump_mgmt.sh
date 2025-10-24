#!/usr/bin/env bash
set -euo pipefail

# Focus DB export/import for a single NFT collection.
#
# Usage examples:
#
# Export schema + data for a contract from a local DB:
#   ./scripts/db/dump_mgmt.sh export \
#     --source-url "postgres://user:pass@localhost:5432/indexer" \
#     --contract 0xabcDEF... \
#     --out-dir ./dump_focus \
#     --schema-out ./dump_focus/schema.sql
#
# Import into a fresh DB:
#   ./scripts/db/dump_mgmt.sh import \
#     --target-url "postgres://user:pass@localhost:5432/indexer_focus" \
#     --in-dir ./dump_focus \
#     --schema-in ./dump_focus/schema.sql
#
# Notes:
# - Requires psql; pg_dump only for schema export.
# - Uses decode('<hex>','hex') for BYTEA matching (safer than bytea literals).
# - Exports/imports full rows (SELECT *), so schema must match between source and target.

MODE=""
SRC_URL=""
TGT_URL=""
CONTRACT=""
OUT_DIR="./dump_focus"
IN_DIR="./dump_focus"
SCHEMA_OUT=""
SCHEMA_IN=""
COLLECTIONS_OVERRIDE="" # comma-separated ids, optional
APPLY_SCHEMA_IMPORT=1
SCHEMA="public"

log() { echo "[focus-db] $*"; }
die() { echo "[focus-db][error] $*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

usage() {
  cat <<EOF
Focus DB export/import for a single collection

export:
  ./scripts/db/dump_mgmt.sh export \\
    --source-url <URL> --contract <0xaddr> [--out-dir DIR] [--schema-out FILE] [--collections id1,id2] [--schema SCHEMA]

import:
  ./scripts/db/dump_mgmt.sh import \\
    --target-url <URL> [--in-dir DIR] [--schema-in FILE] [--no-schema] [--schema SCHEMA]

Options:
  --source-url, -s     Source DATABASE_URL (for export)
  --target-url, -t     Target DATABASE_URL (for import)
  --contract, -c       Contract address (0x...)
  --out-dir, -o        Output directory for export (default: ./dump_focus)
  --in-dir, -i         Input directory for import (default: ./dump_focus)
  --schema-out         Path to write schema dump (export)
  --schema-in          Path to read schema SQL (import)
  --no-schema          Do not apply schema on import (default applies if --schema-in provided)
  --collections        Comma-separated collection ids (override discovery)
  --schema             Schema name to read/write (default: public)
EOF
}

parse_args() {
  [[ $# -eq 0 ]] && usage && exit 1
  MODE="$1"; shift || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -s|--source-url) SRC_URL="$2"; shift 2;;
      -t|--target-url) TGT_URL="$2"; shift 2;;
      -c|--contract) CONTRACT="$2"; shift 2;;
      -o|--out-dir) OUT_DIR="$2"; shift 2;;
      -i|--in-dir) IN_DIR="$2"; shift 2;;
      --schema-out) SCHEMA_OUT="$2"; shift 2;;
      --schema-in) SCHEMA_IN="$2"; shift 2;;
      --no-schema) APPLY_SCHEMA_IMPORT=0; shift 1;;
      --collections) COLLECTIONS_OVERRIDE="$2"; shift 2;;
      --schema) SCHEMA="$2"; shift 2;;
      -h|--help) usage; exit 0;;
      *) die "unknown option: $1";;
    esac
  done
}

hex_no0x() {
  local a="$1"; a="${a#0x}"; a="${a#0X}"; echo "$a" | tr 'A-F' 'a-f'
}

discover_collections() {
  local url="$1"; local chex="$2"
  psql "$url" -Atc "SELECT id FROM \"$SCHEMA\".\"collections\" WHERE contract = decode('$chex','hex')" || true
}

quote_csv_list() {
  # convert space/newline separated items to SQL quoted CSV: 'a','b','c'
  awk '{for(i=1;i<=NF;i++){printf("\x27%s\x27", $i); if(i<NF) printf(",")}} END{printf("\n")}'
}

export_schema() {
  [[ -z "$SCHEMA_OUT" ]] && return 0
  need pg_dump
  log "Dumping schema to $SCHEMA_OUT"
  mkdir -p "$(dirname "$SCHEMA_OUT")"
  pg_dump -s "$SRC_URL" > "$SCHEMA_OUT"
}

export_data() {
  need psql
  [[ -z "$SRC_URL" ]] && die "--source-url is required for export"
  [[ -z "$CONTRACT" ]] && die "--contract is required for export"
  local chex; chex=$(hex_no0x "$CONTRACT")
  mkdir -p "$OUT_DIR"

  # Collections list
  local col_ids
  if [[ -n "$COLLECTIONS_OVERRIDE" ]]; then
    col_ids=$(echo "$COLLECTIONS_OVERRIDE" | tr ',' ' ')
  else
    log "Discovering collection ids for contract $CONTRACT"
    col_ids=$(discover_collections "$SRC_URL" "$chex")
  fi
  [[ -z "$col_ids" ]] && die "No collections found for contract $CONTRACT. You can override with --collections id1,id2"
  local cid_clause
  cid_clause=$(echo "$col_ids" | xargs | quote_csv_list)

  log "Exporting contracts row"
  psql "$SRC_URL" -q -c "\\copy (SELECT * FROM \"$SCHEMA\".\"contracts\" WHERE address = decode('$chex','hex')) TO STDOUT CSV" > "$OUT_DIR/contracts.csv"

  log "Exporting collections ($cid_clause)"
  psql "$SRC_URL" -q -c "\\copy (SELECT * FROM \"$SCHEMA\".\"collections\" WHERE id IN ($cid_clause)) TO STDOUT CSV" > "$OUT_DIR/collections.csv"

  log "Exporting tokens for contract $CONTRACT"
  psql "$SRC_URL" -q -c "\\copy (SELECT * FROM \"$SCHEMA\".\"tokens\" WHERE contract = decode('$chex','hex')) TO STDOUT CSV" > "$OUT_DIR/tokens.csv"

  log "Exporting attribute_keys/attributes/token_attributes for collections"
  psql "$SRC_URL" -q -c "\\copy (SELECT * FROM \"$SCHEMA\".\"attribute_keys\" WHERE collection_id IN ($cid_clause)) TO STDOUT CSV" > "$OUT_DIR/attribute_keys.csv"
  psql "$SRC_URL" -q -c "\\copy (SELECT * FROM \"$SCHEMA\".\"attributes\" WHERE collection_id IN ($cid_clause)) TO STDOUT CSV" > "$OUT_DIR/attributes.csv"
  psql "$SRC_URL" -q -c "\\copy (SELECT * FROM \"$SCHEMA\".\"token_attributes\" WHERE collection_id IN ($cid_clause)) TO STDOUT CSV" > "$OUT_DIR/token_attributes.csv"

  log "Exporting canonical currencies (ETH zero, WETH, USDC, USDT, DAI)"
  psql "$SRC_URL" -q -c "\\copy (SELECT * FROM \"$SCHEMA\".\"currencies\" c WHERE c.contract IN (decode('0000000000000000000000000000000000000000','hex'), decode('C02AAA39B223FE8D0A0E5C4F27EAD9083C756CC2','hex'), decode('A0B86991C6218B36C1D19D4A2E9EB0CE3606EB48','hex'), decode('DAC17F958D2EE523A2206206994597C13D831EC7','hex'), decode('6B175474E89094C44DA98B954EEDEAC495271D0F','hex'))) TO STDOUT CSV" > "$OUT_DIR/currencies.csv"

  log "Export complete in $OUT_DIR"
}

import_schema() {
  [[ $APPLY_SCHEMA_IMPORT -eq 0 ]] && return 0
  [[ -z "$SCHEMA_IN" ]] && return 0
  need psql
  [[ -z "$TGT_URL" ]] && die "--target-url is required for import"
  log "Applying schema from $SCHEMA_IN"
  psql "$TGT_URL" -f "$SCHEMA_IN"
}

copy_if_exists() {
  local url="$1" table="$2" file="$3"
  if [[ -s "$file" ]]; then
    log "Importing $table from $file"
    psql "$url" -q -c "COPY $table FROM STDIN CSV" < "$file"
  else
    log "Skipping $table (file missing or empty)"
  fi
}

import_data() {
  need psql
  [[ -z "$TGT_URL" ]] && die "--target-url is required for import"
  log "Importing data into target DB"
  copy_if_exists "$TGT_URL" "\"$SCHEMA\".\"contracts\""        "$IN_DIR/contracts.csv"
  copy_if_exists "$TGT_URL" "\"$SCHEMA\".\"collections\""      "$IN_DIR/collections.csv"
  copy_if_exists "$TGT_URL" "\"$SCHEMA\".\"attribute_keys\""   "$IN_DIR/attribute_keys.csv"
  copy_if_exists "$TGT_URL" "\"$SCHEMA\".\"attributes\""       "$IN_DIR/attributes.csv"
  copy_if_exists "$TGT_URL" "\"$SCHEMA\".\"tokens\""           "$IN_DIR/tokens.csv"
  copy_if_exists "$TGT_URL" "\"$SCHEMA\".\"token_attributes\"" "$IN_DIR/token_attributes.csv"
  copy_if_exists "$TGT_URL" "\"$SCHEMA\".\"currencies\""       "$IN_DIR/currencies.csv"
  # Optional extras (uncomment if exported)
  # copy_if_exists "$TGT_URL" token_sets "$IN_DIR/token_sets.csv"
  log "Import complete"
}

main() {
  parse_args "$@"
  case "$MODE" in
    export)
      export_schema
      export_data
      ;;
    import)
      import_schema
      import_data
      ;;
    *) usage; die "MODE must be 'export' or 'import'";;
  esac
}

main "$@"
