#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

base_ref="${MINELINK_ARCH_GUARD_BASE:-origin/main}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      base_ref="${2:-}"
      shift 2
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: bash scripts/dev/check-architecture-guard.sh [--base ref]

Checks that MineLink's repository-level agent context and architecture map stay
maintained when architecture-sensitive files change.
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

summary_dir=".minelink-dev/reports"
summary_path="$summary_dir/architecture-guard.md"
mkdir -p "$summary_dir"

changed_files() {
  local files=()
  if [[ -n "$base_ref" ]] && git rev-parse --verify "$base_ref" >/dev/null 2>&1; then
    while IFS= read -r file; do files+=("$file"); done < <(git diff --name-only "$base_ref"...HEAD)
  elif git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
    while IFS= read -r file; do files+=("$file"); done < <(git diff --name-only HEAD~1..HEAD)
  fi
  while IFS= read -r file; do files+=("$file"); done < <(git diff --name-only)
  while IFS= read -r file; do files+=("$file"); done < <(git diff --cached --name-only)
  while IFS= read -r file; do files+=("$file"); done < <(git ls-files --others --exclude-standard)
  if [[ ${#files[@]} -eq 0 ]]; then
    return 0
  fi
  printf "%s\n" "${files[@]}" | awk 'NF && !seen[$0]++'
}

require_text() {
  local file="$1"
  local text="$2"
  if [[ ! -f "$file" ]]; then
    failures+=("Missing required architecture context file: $file")
    return
  fi
  if ! grep -Fq -- "$text" "$file"; then
    failures+=("$file must contain: $text")
  fi
}

changed=()
while IFS= read -r file; do
  changed+=("$file")
done < <(changed_files)

architecture_changed=false
sensitive_changed=false
sensitive_files=()

if [[ ${#changed[@]} -gt 0 ]]; then
  for file in "${changed[@]}"; do
    if [[ "$file" == "ARCHITECTURE.md" ]]; then
      architecture_changed=true
    fi
    case "$file" in
      mod/neoforge/*|packages/protocol/*|packages/host/*|packages/sdk/*|packages/mock-runtime/*|examples/agents/*|examples/codex-rpc/*|scripts/dev/*|.github/workflows/*|package.json|package-lock.json|tsconfig.json)
        sensitive_changed=true
        sensitive_files+=("$file")
        ;;
    esac
  done
fi

failures=()

require_text "AGENTS.md" "ARCHITECTURE.md"
require_text "AGENTS.md" "docs/minelink-acceptance.md"
require_text "AGENTS.md" "Architecture Maintenance Guard"
require_text "ARCHITECTURE.md" "Authority Boundaries"
require_text "ARCHITECTURE.md" "Repository Map"
require_text "ARCHITECTURE.md" "Conditional Verification"
require_text "ARCHITECTURE.md" "Architecture Maintenance Guard"
require_text "ARCHITECTURE.md" "Current Product State"

if [[ "$sensitive_changed" == "true" && "$architecture_changed" != "true" && "${MINELINK_ARCH_GUARD_ALLOW_NO_UPDATE:-}" != "1" ]]; then
  failures+=("Architecture-sensitive files changed without updating ARCHITECTURE.md. Update ARCHITECTURE.md in the same branch, or set MINELINK_ARCH_GUARD_ALLOW_NO_UPDATE=1 only for a reviewed false positive.")
fi

{
  echo "# MineLink Architecture Guard"
  echo
  echo "- Base: \`$base_ref\`"
  echo "- Architecture changed: \`$architecture_changed\`"
  echo "- Architecture-sensitive changed files: \`${#sensitive_files[@]}\`"
  echo
  if [[ ${#sensitive_files[@]} -gt 0 ]]; then
    echo "## Sensitive Files"
    echo
    for file in "${sensitive_files[@]}"; do
      echo "- \`$file\`"
    done
    echo
  fi
  echo "## Changed Files"
  echo
  if [[ ${#changed[@]} -eq 0 ]]; then
    echo "- none"
  else
    for file in "${changed[@]}"; do
      echo "- \`$file\`"
    done
  fi
  echo
  echo "## Result"
  echo
  if [[ ${#failures[@]} -eq 0 ]]; then
    echo "- passed"
  else
    for failure in "${failures[@]}"; do
      echo "- failed: $failure"
    done
  fi
} > "$summary_path"

if [[ ${#failures[@]} -gt 0 ]]; then
  cat "$summary_path" >&2
  exit 1
fi

echo "Architecture guard passed; wrote $summary_path"
