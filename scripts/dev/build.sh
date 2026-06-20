#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

mkdir -p .minelink-dev/logs .minelink-dev/reports

if ! command -v node >/dev/null 2>&1; then
  echo "node is required" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
fi

npm run build

java_status="missing"
if command -v java >/dev/null 2>&1; then
  java_version_output="$(java -version 2>&1 | head -n 1)"
  java_major="$(printf '%s\n' "$java_version_output" | sed -E 's/.*version "([0-9]+).*/\1/')"
  if [ "${java_major:-0}" -ge 21 ] 2>/dev/null; then
    java_status="ok:${java_version_output}"
  else
    java_status="too_old:${java_version_output}"
  fi
fi

python3 - "$java_status" <<'PY' > .minelink-dev/reports/build-environment.json
import json
import sys

print(json.dumps({
    "java_status": sys.argv[1],
    "neoforge_target": "minecraft-1.21.1/neoforge-21.1.233",
}, ensure_ascii=False))
PY

if [ "${MINELINK_BUILD_NEOFORGE:-false}" = "true" ]; then
  if [ "$java_status" != "${java_status#ok:}" ]; then
    if [ -x mod/neoforge/gradlew ]; then
      if [ "${MINELINK_ENABLE_CREATE:-0}" = "1" ] || [ "${MINELINK_ENABLE_CREATE:-0}" = "true" ]; then
        (cd mod/neoforge && ./gradlew --no-daemon -PenableCreateAdapter=true build)
      else
        (cd mod/neoforge && ./gradlew --no-daemon build)
      fi
    else
      echo "NeoForge build requested but mod/neoforge/gradlew is not present. Install the Gradle wrapper first." >&2
      exit 1
    fi
  else
    echo "NeoForge build requested but Java 21 is not available: $java_status" >&2
    exit 1
  fi
fi
