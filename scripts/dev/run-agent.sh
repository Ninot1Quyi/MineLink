#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

scenario="${1:-mine_tree}"
case "$scenario" in
  mine_tree | create_smoke | craft_smoke)
    export MINELINK_SCENARIO="$scenario"
    exec python3 examples/agents/codex_rpc_json_runner.py --scenario "$scenario"
    ;;
  *)
    echo "Unknown agent scenario: $scenario" >&2
    exit 2
    ;;
esac
