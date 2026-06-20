#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

scenario="${1:-mine_tree}"
port="${MINELINK_PORT:-}"
runtime="${MINELINK_RUNTIME:-mock}"
work_dir="${MINELINK_WORK_DIR:-.minelink-dev/$scenario}"

case "$scenario" in
  mine_tree)
    fixture="vanilla_tree"
    report="$work_dir/reports/mine_tree-result.json"
    default_port="25575"
    ;;
  create_smoke)
    fixture="create_smoke"
    report="$work_dir/reports/create_smoke-result.json"
    default_port="25576"
    ;;
  craft_smoke)
    fixture="craft_smoke"
    report="$work_dir/reports/craft_smoke-result.json"
    default_port="25577"
    ;;
  *)
    echo "Unknown e2e scenario: $scenario" >&2
    exit 2
    ;;
esac
port="${port:-$default_port}"

if [ "$runtime" = "neoforge" ]; then
  minecraft_port="${MINELINK_MINECRAFT_PORT:-}"
  if [ -z "$minecraft_port" ]; then
    case "$port" in
      ''|*[!0-9]*)
        echo "MINELINK_PORT must be numeric when deriving a NeoForge server port: $port" >&2
        exit 2
        ;;
    esac
    minecraft_port=$((port + 1000))
  fi
  export MINELINK_MINECRAFT_PORT="$minecraft_port"
fi

rm -rf "$work_dir"
mkdir -p "$work_dir/logs" "$work_dir/replays" "$work_dir/reports"

scripts/dev/build.sh

export MINELINK_FIXTURE="$fixture"
export MINELINK_PORT="$port"
if [ "$runtime" = "neoforge" ]; then
  export MINELINK_ENDPOINT="http://127.0.0.1:$port/minelink"
else
  export MINELINK_ENDPOINT="ws://127.0.0.1:$port"
fi
export MINELINK_REPORT="$report"
export MINELINK_LOG_DIR="$work_dir/logs"
export MINELINK_TRACE="$work_dir/replays/latest-action-trace.jsonl"

server_pid=""
kill_tree() {
  pid="$1"
  if command -v pgrep >/dev/null 2>&1; then
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do
      kill_tree "$child"
    done
  fi
  kill "$pid" >/dev/null 2>&1 || true
}

cleanup() {
  if [ -n "$server_pid" ] && kill -0 "$server_pid" >/dev/null 2>&1; then
    kill_tree "$server_pid"
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ "$runtime" = "neoforge" ]; then
  start_timeout="${MINELINK_SERVER_START_TIMEOUT:-240}"
else
  start_timeout="${MINELINK_SERVER_START_TIMEOUT:-25}"
fi

MINELINK_RUNTIME="$runtime" bash scripts/dev/start-server.sh > "$work_dir/logs/server.stdout.log" 2> "$work_dir/logs/server.stderr.log" &
server_pid="$!"

scripts/dev/wait-for-port.py 127.0.0.1 "$port" "$start_timeout"

scripts/dev/run-agent.sh "$scenario" > "$work_dir/logs/agent.log" 2>&1

python3 - "$report" <<'PY'
import json
import sys
from pathlib import Path

report = Path(sys.argv[1])
payload = json.loads(report.read_text(encoding="utf-8"))
if not payload.get("passed"):
    raise SystemExit(f"scenario failed: {payload}")
print(json.dumps({"scenario": payload.get("scenario"), "passed": True, "report": str(report)}, ensure_ascii=False))
PY
