#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
exec node packages/host/dist/index.js mcp
