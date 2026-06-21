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
  if ! grep -Fq -- "$text" "$file"; then
    failures+=("$file must contain: $text")
  fi
}

require_file "AGENTS.md"
require_file "ARCHITECTURE.md"
require_file "docs/agent-workbench.md"
require_file "docs/ona-migration.md"
require_file "docs/linear-ona-agent-factory.md"
require_file "docs/agent-task-queue.md"
require_file "docs/github-labels.md"
require_file ".ona/automations.yaml"
require_file ".devcontainer/devcontainer.json"
require_file ".github/ISSUE_TEMPLATE/agent-task.yml"
require_file ".github/pull_request_template.md"
require_file ".github/workflows/install-smoke.yml"
require_file "ona/ai-automations/minelink-agent-factory.yaml"
require_file "scripts/dev/install-smoke.sh"
require_file "scripts/dev/render-acceptance-video.mjs"
require_file "scripts/dev/summarize-evidence.mjs"
require_file "scripts/dev/sync-linear-status.mjs"
require_file "scripts/dev/verify-agent-task.sh"

require_text "AGENTS.md" "docs/agent-workbench.md"
require_text "AGENTS.md" "docs/linear-ona-agent-factory.md"
require_text "AGENTS.md" "Architecture Maintenance Guard"
require_text "AGENTS.md" "Product Completion Rule"
require_text "ARCHITECTURE.md" "Parallel Development Model"
require_text "ARCHITECTURE.md" "AI-Native Delivery Model"
require_text "ARCHITECTURE.md" "Architecture Maintenance Guard"
require_text "docs/agent-workbench.md" "one environment = one task = one branch = one PR"
require_text "docs/agent-workbench.md" "ona/ai-automations/minelink-agent-factory.yaml"
require_text "docs/agent-workbench.md" "docs/agent-task-queue.md"
require_text "docs/ona-migration.md" "Ona Environment Contract"
require_text "docs/ona-migration.md" "Ona AI automation is the target execution surface"
require_text "docs/ona-migration.md" "Secrets Policy"
require_text "docs/ona-migration.md" "Validation Matrix"
require_text "docs/linear-ona-agent-factory.md" "Ona AI automation"
require_text "docs/linear-ona-agent-factory.md" "LINEAR_API_KEY"
require_text "docs/linear-ona-agent-factory.md" "Acceptance video"
require_text "docs/agent-task-queue.md" "Ready Tasks"
require_text "docs/agent-task-queue.md" "scripts/dev/install-smoke.sh"
require_text "docs/github-labels.md" "agent-ready"
require_text "docs/github-labels.md" "agent:ona"
require_text "docs/github-labels.md" "video-required"
require_text "docs/github-labels.md" "needs-acceptance-evidence"
require_text "docs/github-labels.md" "mock-only"
require_text "docs/github-labels.md" "smoke-only"
require_text "docs/github-labels.md" "real-partial"
require_text "docs/github-labels.md" "product-accepted"
require_text ".ona/automations.yaml" "render-acceptance-evidence"
require_text ".ona/automations.yaml" "sync-linear-status"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "agent-ready"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "agent:ona"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "needs-acceptance-evidence"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "Acceptance video required"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "Linked Linear issue"
require_text ".github/pull_request_template.md" "Acceptance Gate"
require_text ".github/pull_request_template.md" "Mock/Smoke Assumption Reduced"
require_text ".github/pull_request_template.md" "Validation"
require_text ".github/pull_request_template.md" "Evidence Paths"
require_text ".github/pull_request_template.md" "Acceptance video artifact"
require_text ".github/pull_request_template.md" "Remaining Product Gaps"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "minelink-agent-factory"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "Ona agent execution environment"
require_text ".github/workflows/install-smoke.yml" "minelink-install-smoke-evidence"
require_text ".github/workflows/install-smoke.yml" "scripts/dev/summarize-evidence.mjs"
require_text ".github/workflows/ci.yml" "Summarize MineLink evidence"
require_text ".github/workflows/minecraft-neoforge.yml" "Summarize MineLink evidence"
require_text ".github/workflows/install-smoke.yml" "Summarize MineLink evidence"
require_text ".devcontainer/devcontainer.json" "postCreateCommand"
require_text ".devcontainer/devcontainer.json" "postAttachCommand"
require_text ".devcontainer/devcontainer.json" "mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm"
require_text ".devcontainer/devcontainer.json" "ghcr.io/devcontainers/features/java:1"
require_text ".devcontainer/devcontainer.json" "python3 --version"
require_text "scripts/dev/install-smoke.sh" "fresh clone"
require_text "scripts/dev/install-smoke.sh" "dirty-local-non-acceptance"
require_text "scripts/dev/render-acceptance-video.mjs" "trace-driven MineLink acceptance artifacts"
require_text "scripts/dev/summarize-evidence.mjs" "Acceptance Boundary"
require_text "scripts/dev/summarize-evidence.mjs" "GITHUB_STEP_SUMMARY"
require_text "scripts/dev/sync-linear-status.mjs" "LINEAR_API_KEY"
require_text "scripts/dev/verify-agent-task.sh" "install   fresh clone"

python3 - <<'PY' || failures+=(".devcontainer/devcontainer.json must not pin the Python feature to a source-built version in Ona.")
from pathlib import Path
import json
import sys

data = json.loads(Path(".devcontainer/devcontainer.json").read_text())
features = data.get("features", {})
python_feature = features.get("ghcr.io/devcontainers/features/python:1")
if isinstance(python_feature, dict) and python_feature.get("version") not in (None, "os-provided"):
    print("Pinned Python feature versions can source-build during Ona rebuilds.", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
PY

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
    "docs/linear-ona-agent-factory.md" \
    "docs/agent-task-queue.md" \
    "docs/github-labels.md" \
    ".ona/automations.yaml" \
    ".devcontainer/devcontainer.json" \
    ".github/ISSUE_TEMPLATE/agent-task.yml" \
    ".github/pull_request_template.md" \
    ".github/workflows/install-smoke.yml" \
    "ona/ai-automations/minelink-agent-factory.yaml" \
    "scripts/dev/install-smoke.sh" \
    "scripts/dev/render-acceptance-video.mjs" \
    "scripts/dev/summarize-evidence.mjs" \
    "scripts/dev/sync-linear-status.mjs" \
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
