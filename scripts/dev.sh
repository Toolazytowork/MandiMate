#!/usr/bin/env bash
# Kept for backwards compatibility — the real orchestrator is ./dev.sh in the project root.
# SEED=1 (wipe and reseed) and SEED=0 (skip demo data) are still honoured.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
args=()
case "${SEED:-auto}" in
  1) args+=(--reset) ;;
  0) args+=(--no-seed) ;;
esac
exec "$ROOT_DIR/dev.sh" ${args[@]+"${args[@]}"} "$@"
