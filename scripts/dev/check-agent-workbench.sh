#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

summary_dir=".minelink-dev/reports"
summary_path="$summary_dir/agent-workbench-guard.md"
mkdir -p "$summary_dir"

failures=()

require_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    failures+=("Missing required agent workbench file: $file")
  fi
}

require_text() {
  local file="$1"
  local text="$2"
  if [[ ! -f "$file" ]]; then
    failures+=("Missing file for text check: $file")
    return
  fi
  if ! grep -Fq "$text" "$file"; then
    failures+=("$file must contain: $text")
  fi
}

require_file "AGENTS.md"
require_file "ARCHITECTURE.md"
require_file "docs/agent-workbench.md"
require_file "docs/ona-migration.md"
require_file "docs/agent-task-queue.md"
require_file "docs/github-labels.md"
require_file ".devcontainer/devcontainer.json"
require_file ".github/ISSUE_TEMPLATE/agent-task.yml"
require_file ".github/pull_request_template.md"
require_file "scripts/dev/verify-agent-task.sh"

require_text "AGENTS.md" "docs/agent-workbench.md"
require_text "AGENTS.md" "Architecture Maintenance Guard"
require_text "AGENTS.md" "Product Completion Rule"
require_text "ARCHITECTURE.md" "Parallel Development Model"
require_text "ARCHITECTURE.md" "Architecture Maintenance Guard"
require_text "docs/agent-workbench.md" "one environment = one task = one branch = one PR"
require_text "docs/agent-workbench.md" "docs/agent-task-queue.md"
require_text "docs/ona-migration.md" "Ona Environment Contract"
require_text "docs/ona-migration.md" "Secrets Policy"
require_text "docs/ona-migration.md" "Validation Matrix"
require_text "docs/agent-task-queue.md" "Ready Tasks"
require_text "docs/github-labels.md" "agent-ready"
require_text "docs/github-labels.md" "needs-acceptance-evidence"
require_text "docs/github-labels.md" "mock-only"
require_text "docs/github-labels.md" "smoke-only"
require_text "docs/github-labels.md" "real-partial"
require_text "docs/github-labels.md" "product-accepted"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "agent-ready"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "needs-acceptance-evidence"
require_text ".github/pull_request_template.md" "Acceptance Gate"
require_text ".github/pull_request_template.md" "Mock/Smoke Assumption Reduced"
require_text ".github/pull_request_template.md" "Validation"
require_text ".github/pull_request_template.md" "Evidence Paths"
require_text ".github/pull_request_template.md" "Remaining Product Gaps"
require_text ".devcontainer/devcontainer.json" "postCreateCommand"
require_text ".devcontainer/devcontainer.json" "postAttachCommand"

python3 - <<'PY' || failures+=("docs/agent-task-queue.md has an agent-ready task missing Scope, Forbidden, Validation, Evidence, or Remaining gaps.")
from pathlib import Path
import re
import sys

text = Path("docs/agent-task-queue.md").read_text()
headings = list(re.finditer(r"^### .+$", text, re.MULTILINE))
required = ["Scope:", "Forbidden:", "Validation:", "Evidence:", "Remaining gaps:"]
for index, heading in enumerate(headings):
    start = heading.start()
    end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
    block = text[start:end]
    if "Status: `agent-ready`" not in block:
        continue
    missing = [item for item in required if item not in block]
    if missing:
        print(f"{heading.group(0)} missing {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)
sys.exit(0)
PY

{
  echo "# MineLink Agent Workbench Guard"
  echo
  echo "## Required Files"
  echo
  for file in \
    "AGENTS.md" \
    "ARCHITECTURE.md" \
    "docs/agent-workbench.md" \
    "docs/ona-migration.md" \
    "docs/agent-task-queue.md" \
    "docs/github-labels.md" \
    ".devcontainer/devcontainer.json" \
    ".github/ISSUE_TEMPLATE/agent-task.yml" \
    ".github/pull_request_template.md" \
    "scripts/dev/verify-agent-task.sh"; do
    if [[ -f "$file" ]]; then
      echo "- present: \`$file\`"
    else
      echo "- missing: \`$file\`"
    fi
  done
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

echo "Agent workbench guard passed; wrote $summary_path"
