#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

bash scripts/dev/build.sh
npm run typecheck
npm test
npm_config_registry=https://registry.npmjs.org npm audit --audit-level=moderate
MINELINK_SKIP_BUILD=1 bash scripts/dev/e2e.sh mine_tree
MINELINK_SKIP_BUILD=1 MINELINK_MCP_TRANSPORT=http MINELINK_WORK_DIR=.minelink-dev/http-mine_tree bash scripts/dev/e2e.sh mine_tree
MINELINK_SKIP_BUILD=1 bash scripts/dev/e2e.sh create_smoke
MINELINK_SKIP_BUILD=1 bash scripts/dev/e2e.sh craft_smoke
MINELINK_SKIP_BUILD=1 bash scripts/dev/e2e.sh craft_negative
MINELINK_SKIP_BUILD=1 bash scripts/dev/e2e.sh guard_boundaries
MINELINK_SKIP_BUILD=1 bash scripts/dev/e2e.sh perception_shapes
MINELINK_SKIP_BUILD=1 bash scripts/dev/e2e.sh portal_coop
MINELINK_SKIP_BUILD=1 bash scripts/dev/soak.sh --runtime mock --iterations 1 --scenarios mine_tree,craft_negative,guard_boundaries,perception_shapes,portal_coop
