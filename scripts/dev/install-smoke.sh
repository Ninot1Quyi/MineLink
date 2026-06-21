#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

repo_root="$(pwd -P)"
source_ref="HEAD"
verify_scope="fast"
keep_checkout=false
allow_dirty=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)
      source_ref="${2:-}"
      shift 2
      ;;
    --scope)
      verify_scope="${2:-}"
      shift 2
      ;;
    --keep)
      keep_checkout=true
      shift
      ;;
    --allow-dirty)
      allow_dirty=true
      shift
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: bash scripts/dev/install-smoke.sh [--ref ref] [--scope docs|fast] [--keep] [--allow-dirty]

Proves that a committed MineLink checkout can be cloned fresh, install Node
dependencies with npm ci, and pass the selected verification scope.

The script intentionally fails on a dirty source worktree. It validates the
committed ref, not uncommitted local edits. --allow-dirty is only for local
script debugging and marks the report as non-acceptance evidence.
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

case "$verify_scope" in
  docs|fast)
    ;;
  *)
    echo "--scope must be docs or fast" >&2
    exit 2
    ;;
esac

source_sha="$(git rev-parse "$source_ref")"
source_remote_raw="$(git remote get-url origin 2>/dev/null || true)"
if [[ -z "$source_remote_raw" ]]; then
  source_remote_raw="none"
fi
if [[ "$source_remote_raw" =~ ^(https?://)[^/@]+@(.+)$ ]]; then
  source_remote="${BASH_REMATCH[1]}<redacted>@${BASH_REMATCH[2]}"
else
  source_remote="$source_remote_raw"
fi

report_root="$repo_root/.minelink-dev/install-smoke"
checkout_parent="$report_root/work"
checkout_dir="$checkout_parent/minelink"
log_path="$report_root/install-smoke.log"
report_path="$report_root/install-smoke-report.md"
summary_copy="$report_root/agent-task-summary.md"

rm -rf "$checkout_parent"
mkdir -p "$report_root" "$checkout_parent"

node_version="$(node --version 2>/dev/null || echo unavailable)"
npm_version="$(npm --version 2>/dev/null || echo unavailable)"
git_version="$(git --version 2>/dev/null || echo unavailable)"
java_version="$(java -version 2>&1 | head -n 1 || echo unavailable)"
os_version="$(uname -a 2>/dev/null || echo unavailable)"
source_dirty="false"
evidence_class="fresh-clone-bootstrap"
command_results=()

record_command() {
  local status="$1"
  shift
  local command_text
  printf -v command_text "%q " "$@"
  command_results+=("${command_text% }|$status")
}

run_step() {
  echo "+ $*"
  set +e
  "$@"
  local status=$?
  set -e
  record_command "$status" "$@"
  if [[ "$status" -ne 0 ]]; then
    return "$status"
  fi
}

finish() {
  local exit_code=$?
  set +e

  local result="passed"
  if [[ $exit_code -ne 0 ]]; then
    result="failed"
  fi
  if [[ "$source_dirty" == "true" && "$allow_dirty" == "true" ]]; then
    evidence_class="dirty-local-non-acceptance"
  elif [[ "$source_dirty" == "true" ]]; then
    evidence_class="dirty-source-rejected"
  fi

  if [[ -f "$checkout_dir/.minelink-dev/reports/agent-task-summary.md" ]]; then
    cp "$checkout_dir/.minelink-dev/reports/agent-task-summary.md" "$summary_copy"
  fi

  {
    echo "# MineLink Fresh Install Smoke"
    echo
    echo "- Result: \`$result\`"
    echo "- Evidence class: \`$evidence_class\`"
    echo "- Source remote: \`$source_remote\`"
    echo "- Source ref: \`$source_ref\`"
    echo "- Source commit: \`$source_sha\`"
    echo "- Source dirty: \`$source_dirty\`"
    echo "- Verification scope: \`$verify_scope\`"
    echo "- Node: \`$node_version\`"
    echo "- npm: \`$npm_version\`"
    echo "- Git: \`$git_version\`"
    echo "- Java: \`$java_version\`"
    echo "- OS: \`$os_version\`"
    echo "- Log: \`.minelink-dev/install-smoke/install-smoke.log\`"
    if [[ -f "$summary_copy" ]]; then
      echo "- Agent task summary: \`.minelink-dev/install-smoke/agent-task-summary.md\`"
    fi
    if [[ "$keep_checkout" == "true" ]]; then
      echo "- Checkout: \`$checkout_dir\`"
    else
      echo "- Checkout: removed after run"
    fi
    echo
    echo "## Commands"
    echo
    if [[ ${#command_results[@]} -eq 0 ]]; then
      echo "- none"
    else
      for command_result in "${command_results[@]}"; do
        local command_text="${command_result%|*}"
        local status="${command_result##*|}"
        echo "- exit \`$status\`: \`$command_text\`"
      done
    fi
  } > "$report_path"

  if [[ "$keep_checkout" != "true" ]]; then
    rm -rf "$checkout_parent"
  fi

  echo "Wrote $report_path"
  exit "$exit_code"
}
trap finish EXIT

exec > >(tee "$log_path") 2>&1

echo "Running MineLink fresh install smoke"
echo "Source: $repo_root"
echo "Remote: $source_remote"
echo "Commit: $source_sha"
echo "Checkout: $checkout_dir"

if [[ -n "$(git status --porcelain)" ]]; then
  source_dirty="true"
  echo "Source worktree is dirty."
  echo "This check proves a fresh clone of a committed ref, not uncommitted edits."
  if [[ "$allow_dirty" != "true" ]]; then
    exit 1
  fi
  echo "Continuing only because --allow-dirty was set; this report is not acceptance evidence."
fi

run_step git clone --no-hardlinks "$repo_root" "$checkout_dir"
pushd "$checkout_dir" >/dev/null
run_step git checkout --detach "$source_sha"
run_step npm ci
run_step bash scripts/dev/verify-agent-task.sh --scope "$verify_scope" --base HEAD
popd >/dev/null
