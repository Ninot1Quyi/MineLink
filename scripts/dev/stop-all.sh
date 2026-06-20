#!/usr/bin/env bash
set -euo pipefail

patterns=(
  "packages/mock-runtime/dist/index.js"
  "minelink-mock-runtime"
  "packages/host/dist/index.js mcp"
  "minelink-host mcp"
)

for pattern in "${patterns[@]}"; do
  while read -r pid; do
    [ -z "$pid" ] && continue
    kill "$pid" >/dev/null 2>&1 || true
  done < <(pgrep -f "$pattern" || true)
done
