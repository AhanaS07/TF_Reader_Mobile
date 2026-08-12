#!/usr/bin/env bash
#
# Runs the offline-sync verification against a live Mongo backend.
#
#   ./tools/verify/run.sh                       # localhost:9000
#   API=http://192.168.1.20:9000 ./tools/verify/run.sh
#
# Uses its own user id so it never touches the app's data, and hard-deletes
# everything it wrote before it exits.
set -euo pipefail

cd "$(dirname "$0")/../.."

export EXPO_PUBLIC_API_URL="${API:-http://localhost:9000}"
export EXPO_PUBLIC_USER_ID="${VERIFY_USER:-user-verify}"
export EXPO_PUBLIC_BOOK_ID="${VERIFY_BOOK:-book-001}"

NODE_FLAGS=(--experimental-transform-types --no-warnings)

VERIFY_DB_PATH="${TMPDIR:-/tmp}/verify-a.db" \
  node "${NODE_FLAGS[@]}" tools/verify/scenario-a.mjs

# Two separate processes over one database file: the force-quit-and-reopen case.
VERIFY_DB_PATH="${TMPDIR:-/tmp}/verify-b.db" \
  node "${NODE_FLAGS[@]}" tools/verify/scenario-b-phase1.mjs
VERIFY_DB_PATH="${TMPDIR:-/tmp}/verify-b.db" \
  node "${NODE_FLAGS[@]}" tools/verify/scenario-b-phase2.mjs

VERIFY_DB_PATH="${TMPDIR:-/tmp}/verify-c.db" \
  node "${NODE_FLAGS[@]}" tools/verify/scenario-c-migration.mjs

echo
echo "All scenarios passed."
