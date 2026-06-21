#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

scope="auto"
scenarios=""
base_ref="${MINELINK_VERIFY_BASE:-origin/main}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope)
      scope="${2:-}"
      shift 2
      ;;
    --scenarios)
      scenarios="${2:-}"
      shift 2
      ;;
    --base)
      base_ref="${2:-}"
      shift 2
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: bash scripts/dev/verify-agent-task.sh [--scope auto|docs|fast|runtime|neoforge|all] [--scenarios a,b] [--base ref]

Conditional verification entry point for Ona/Codex worktree tasks.

Scopes:
  docs      whitespace plus shell syntax checks only
  fast      build, typecheck, unit tests
  runtime   fast plus selected mock e2e scenarios
  neoforge  selected real NeoForge e2e scenarios
  all       fast, selected mock e2e, and selected real NeoForge e2e
  auto      classify the current diff and choose docs, fast, runtime, or neoforge
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$scope" ]]; then
  echo "--scope cannot be empty" >&2
  exit 2
fi

summary_dir=".minelink-dev/reports"
summary_path="$summary_dir/agent-task-summary.md"
mkdir -p "$summary_dir"

changed_files() {
  local files=()
  if git rev-parse --verify "$base_ref" >/dev/null 2>&1; then
    while IFS= read -r file; do files+=("$file"); done < <(git diff --name-only "$base_ref"...HEAD)
  fi
  while IFS= read -r file; do files+=("$file"); done < <(git diff --name-only)
  while IFS= read -r file; do files+=("$file"); done < <(git diff --cached --name-only)
  while IFS= read -r file; do files+=("$file"); done < <(git ls-files --others --exclude-standard)
  if [[ ${#files[@]} -eq 0 ]]; then
    return 0
  fi
  printf "%s\n" "${files[@]}" | awk 'NF && !seen[$0]++'
}

changed=()
while IFS= read -r file; do
  changed+=("$file")
done < <(changed_files)

is_docs_only=true
needs_fast=false
needs_runtime=false
needs_neoforge=false

for file in "${changed[@]}"; do
  case "$file" in
    AGENTS.md|ARCHITECTURE.md|README.md|SECURITY.md|docs/*.md|docs/**/*.md|.devcontainer/*|.github/ISSUE_TEMPLATE/*)
      ;;
    .github/workflows/*|scripts/dev/*)
      is_docs_only=false
      needs_fast=true
      needs_runtime=true
      ;;
    mod/neoforge/*|mod/neoforge/**)
      is_docs_only=false
      needs_fast=true
      needs_runtime=true
      needs_neoforge=true
      ;;
    packages/*/src/*|packages/*/src/**|examples/agents/*|examples/codex-rpc/*|package.json|package-lock.json|tsconfig.json)
      is_docs_only=false
      needs_fast=true
      needs_runtime=true
      ;;
    *)
      is_docs_only=false
      needs_fast=true
      ;;
  esac
done

if [[ "$scope" == "auto" ]]; then
  if [[ ${#changed[@]} -eq 0 || "$is_docs_only" == "true" ]]; then
    scope="docs"
  elif [[ "$needs_neoforge" == "true" ]]; then
    scope="neoforge"
  elif [[ "$needs_runtime" == "true" ]]; then
    scope="runtime"
  elif [[ "$needs_fast" == "true" ]]; then
    scope="fast"
  else
    scope="docs"
  fi
fi

if [[ -z "$scenarios" ]]; then
  if [[ "$scope" == "neoforge" || "$scope" == "all" ]]; then
    scenarios="${MINELINK_VERIFY_SCENARIOS:-mine_tree,craft_smoke,craft_negative,guard_boundaries}"
  elif [[ "$scope" == "runtime" ]]; then
    scenarios="${MINELINK_VERIFY_SCENARIOS:-mine_tree,craft_smoke,craft_negative,guard_boundaries,perception_shapes,portal_coop}"
  else
    scenarios="${MINELINK_VERIFY_SCENARIOS:-}"
  fi
fi

commands_run=()

run_cmd() {
  echo "+ $*"
  commands_run+=("$*")
  "$@"
}

run_shell() {
  echo "+ $*"
  commands_run+=("$*")
  bash -lc "$*"
}

run_docs_checks() {
  run_cmd git diff --check
  run_cmd bash scripts/dev/check-architecture-guard.sh --base "$base_ref"
  if [[ -d scripts/dev ]]; then
    run_shell "bash -n scripts/dev/*.sh"
  fi
}

run_fast_checks() {
  run_docs_checks
  run_cmd npm run build
  run_cmd npm run typecheck
  run_cmd npm test
}

run_mock_scenarios() {
  local scenario_list="$1"
  if [[ -z "$scenario_list" ]]; then
    return
  fi
  IFS=',' read -r -a scenario_array <<< "$scenario_list"
  for scenario in "${scenario_array[@]}"; do
    scenario="${scenario// /}"
    [[ -z "$scenario" ]] && continue
    run_shell "MINELINK_SKIP_BUILD=1 bash scripts/dev/e2e.sh $scenario"
  done
}

run_neoforge_scenarios() {
  local scenario_list="$1"
  if [[ -z "$scenario_list" ]]; then
    return
  fi
  export MINELINK_ACCEPT_EULA="${MINELINK_ACCEPT_EULA:-1}"
  export MINELINK_RUNTIME=neoforge
  IFS=',' read -r -a scenario_array <<< "$scenario_list"
  for scenario in "${scenario_array[@]}"; do
    scenario="${scenario// /}"
    [[ -z "$scenario" ]] && continue
    local enable_create=""
    if [[ "$scenario" == "create_smoke" ]]; then
      enable_create="MINELINK_ENABLE_CREATE=1 "
    fi
    run_shell "${enable_create}MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=$MINELINK_ACCEPT_EULA MINELINK_SKIP_BUILD=1 bash scripts/dev/e2e.sh $scenario"
  done
}

case "$scope" in
  docs)
    run_docs_checks
    ;;
  fast)
    run_fast_checks
    ;;
  runtime)
    run_fast_checks
    run_mock_scenarios "$scenarios"
    ;;
  neoforge)
    run_fast_checks
    run_neoforge_scenarios "$scenarios"
    ;;
  all)
    run_fast_checks
    run_mock_scenarios "$scenarios"
    run_neoforge_scenarios "$scenarios"
    ;;
  *)
    echo "Unsupported scope: $scope" >&2
    exit 2
    ;;
esac

{
  echo "# MineLink Agent Task Verification"
  echo
  echo "- Scope: \`$scope\`"
  echo "- Base: \`$base_ref\`"
  echo "- Scenarios: \`${scenarios:-none}\`"
  echo "- Timestamp: \`$(date -u +"%Y-%m-%dT%H:%M:%SZ")\`"
  echo
  echo "## Changed Files"
  if [[ ${#changed[@]} -eq 0 ]]; then
    echo
    echo "- none"
  else
    echo
    for file in "${changed[@]}"; do
      echo "- \`$file\`"
    done
  fi
  echo
  echo "## Commands"
  echo
  for command in "${commands_run[@]}"; do
    echo "- \`$command\`"
  done
  echo
  echo "## Evidence Paths"
  echo
  echo "- \`.minelink-dev/reports/agent-task-summary.md\`"
  echo "- \`.minelink-dev/<scenario>/reports/<scenario>-result.json\` when e2e scenarios ran"
  echo "- \`.minelink-dev/soak/<runtime>/soak-report.json\` when soak scenarios ran"
} > "$summary_path"

echo "Wrote $summary_path"
