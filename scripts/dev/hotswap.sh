#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

class_name="${1:-}"
mkdir -p .minelink-dev/reports .minelink-dev/replays

if [ -z "$class_name" ]; then
  echo "Usage: scripts/dev/hotswap.sh <class>" >&2
  exit 2
fi

report=".minelink-dev/reports/hotswap-report.json"
python3 - "$class_name" <<'PY' > "$report"
import json
import sys

print(json.dumps({
    "engine": "hotswap_agent",
    "class": sys.argv[1],
    "status": "not_run",
    "reason": "NeoForge dev server hotswap requires Java 21 plus a running dev JVM with HotswapAgent enabled.",
}, ensure_ascii=False, indent=2))
PY

printf '%s\n' "$report"
