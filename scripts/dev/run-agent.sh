#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

scenario="${1:-mine_tree}"
case "$scenario" in
  mine_tree | create_smoke | craft_smoke | furnace_smoke | craft_negative | guard_boundaries | perception_shapes | portal_coop)
    export MINELINK_SCENARIO="$scenario"
    if [ "$scenario" = "portal_coop" ] || [ "$scenario" = "craft_negative" ]; then
      export MINELINK_AGENT_MAX_TURNS="${MINELINK_AGENT_MAX_TURNS:-64}"
    fi
    exec python3 examples/agents/codex_rpc_json_runner.py --scenario "$scenario"
    ;;
  *)
    echo "Unknown agent scenario: $scenario" >&2
    exit 2
    ;;
esac
