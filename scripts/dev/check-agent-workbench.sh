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
require_file ".devcontainer/Dockerfile"
require_file ".github/ISSUE_TEMPLATE/agent-task.yml"
require_file ".github/pull_request_template.md"
require_file ".github/workflows/devcontainer-image.yml"
require_file ".github/workflows/install-smoke.yml"
require_file ".github/workflows/agent-factory-dispatch.yml"
require_file "ona/ai-automations/minelink-agent-factory.yaml"
require_file "scripts/dev/install-smoke.sh"
require_file "scripts/dev/bootstrap-prebuild.sh"
require_file "scripts/dev/check-devcontainer-image-access.sh"
require_file "scripts/dev/check-agent-factory-secrets.mjs"
require_file "scripts/dev/dispatch-agent-factory.mjs"
require_file "scripts/dev/check-video-review.mjs"
require_file "scripts/dev/prepare-video-review-request.mjs"
require_file "scripts/dev/render-acceptance-video.mjs"
require_file "scripts/dev/report-agent-factory-chain.mjs"
require_file "scripts/dev/summarize-evidence.mjs"
require_file "scripts/dev/sync-linear-status.mjs"
require_file "scripts/dev/verify-agent-task.sh"
require_file "scripts/dev/watch-linear-agent-tasks.mjs"

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
require_text "docs/ona-migration.md" "Ona Platform Codex is the target execution surface"
require_text "docs/ona-migration.md" "Secrets Policy"
require_text "docs/ona-migration.md" "Validation Matrix"
require_text "docs/ona-migration.md" "Ona Platform Codex"
require_text "docs/linear-ona-agent-factory.md" "Ona CLI automation"
require_text "docs/linear-ona-agent-factory.md" "Ona Platform Codex"
require_text "docs/linear-ona-agent-factory.md" "LINEAR_API_KEY"
require_text "docs/linear-ona-agent-factory.md" "Acceptance video"
require_text "docs/linear-ona-agent-factory.md" "Release decision: pass"
require_text "docs/agent-task-queue.md" "Ready Tasks"
require_text "docs/agent-task-queue.md" "scripts/dev/install-smoke.sh"
require_text "docs/github-labels.md" "agent-ready"
require_text "docs/github-labels.md" "agent:ona"
require_text "docs/github-labels.md" "video-required"
require_text "docs/github-labels.md" "video-review request"
require_text "docs/github-labels.md" "needs-acceptance-evidence"
require_text "docs/github-labels.md" "mock-only"
require_text "docs/github-labels.md" "smoke-only"
require_text "docs/github-labels.md" "real-partial"
require_text "docs/github-labels.md" "product-accepted"
require_text ".ona/automations.yaml" "render-acceptance-evidence"
require_text ".ona/automations.yaml" "report-agent-factory-chain"
require_text ".ona/automations.yaml" "prepare-video-review"
require_text ".ona/automations.yaml" "sync-linear-status"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "agent-ready"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "agent:ona"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "needs-acceptance-evidence"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "Ona Platform Codex"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "Acceptance video required"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "video-review-request.md"
require_text ".github/ISSUE_TEMPLATE/agent-task.yml" "Linked Linear issue"
require_text ".github/pull_request_template.md" "Acceptance Gate"
require_text ".github/pull_request_template.md" "Mock/Smoke Assumption Reduced"
require_text ".github/pull_request_template.md" "Validation"
require_text ".github/pull_request_template.md" "Evidence Paths"
require_text ".github/pull_request_template.md" "Acceptance video artifact"
require_text ".github/pull_request_template.md" "Dedicated video verifier"
require_text ".github/pull_request_template.md" "video-review-request.md"
require_text ".github/pull_request_template.md" "Remaining Product Gaps"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "minelink-agent-factory"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "Ona Platform Codex agent"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "check-video-review.mjs"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "prepare-video-review-request.mjs"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "report-agent-factory-chain.mjs"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "video-review-request.md"
require_text ".github/workflows/devcontainer-image.yml" "ghcr.io/ninot1quyi/minelink-devcontainer"
require_text ".github/workflows/devcontainer-image.yml" "docker/build-push-action"
require_text ".github/workflows/devcontainer-image.yml" "packages: write"
require_text ".github/workflows/devcontainer-image.yml" "type=ref,event=branch"
require_text ".github/workflows/devcontainer-image.yml" "MINELINK_PREWARM_GRADLE=1"
require_text ".github/workflows/devcontainer-image.yml" "bootstrap-prebuild.sh"
require_text ".github/workflows/devcontainer-image.yml" "check-devcontainer-image-access.sh"
require_text ".github/workflows/devcontainer-image.yml" "--docker-smoke"
require_text ".github/workflows/agent-factory-dispatch.yml" "issues:"
require_text ".github/workflows/agent-factory-dispatch.yml" "watch-linear-agent-tasks.mjs"
require_text ".github/workflows/agent-factory-dispatch.yml" "dispatch-agent-factory.mjs"
require_text ".github/workflows/agent-factory-dispatch.yml" "check-agent-factory-secrets.mjs"
require_text ".github/workflows/agent-factory-dispatch.yml" "secrets.ONA_TOKEN"
require_text ".github/workflows/agent-factory-dispatch.yml" "secrets.LINEAR_API_KEY"
require_text ".github/workflows/install-smoke.yml" "minelink-install-smoke-evidence"
require_text ".github/workflows/install-smoke.yml" "scripts/dev/summarize-evidence.mjs"
require_text ".github/workflows/ci.yml" "Summarize MineLink evidence"
require_text ".github/workflows/minecraft-neoforge.yml" "Summarize MineLink evidence"
require_text ".github/workflows/install-smoke.yml" "Summarize MineLink evidence"
require_text ".devcontainer/devcontainer.json" "postCreateCommand"
require_text ".devcontainer/devcontainer.json" "postAttachCommand"
require_text ".devcontainer/devcontainer.json" "scripts/dev/bootstrap-prebuild.sh"
require_text ".devcontainer/devcontainer.json" "ghcr.io/ninot1quyi/minelink-devcontainer:codex-minelink-mvp-engineering"
require_text ".devcontainer/devcontainer.json" "remoteUser"
require_text ".devcontainer/devcontainer.json" "GRADLE_USER_HOME"
require_text ".devcontainer/Dockerfile" "mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm"
require_text ".devcontainer/Dockerfile" "eclipse-temurin:21-jdk"
require_text ".devcontainer/Dockerfile" "MINELINK_PREWARM_GRADLE"
require_text ".devcontainer/Dockerfile" "./gradlew --no-daemon build"
require_text ".devcontainer/Dockerfile" "/home/node/.gradle"
require_text ".devcontainer/Dockerfile" "/home/node/.npm"
require_text ".ona/automations.yaml" "bootstrap-prebuild"
require_text ".ona/automations.yaml" "triggeredBy"
require_text ".ona/automations.yaml" "prebuild"
require_text ".ona/automations.yaml" "prebuildRequiresSuccess: true"
require_text ".ona/automations.yaml" "scripts/dev/bootstrap-prebuild.sh"
require_text "scripts/dev/bootstrap-prebuild.sh" "ffmpeg"
require_text "scripts/dev/bootstrap-prebuild.sh" "python3 --version"
require_text "scripts/dev/install-smoke.sh" "fresh clone"
require_text "scripts/dev/install-smoke.sh" "dirty-local-non-acceptance"
require_text "scripts/dev/bootstrap-prebuild.sh" "MINELINK_PREBUILD_SKIP_GRADLE"
require_text "scripts/dev/bootstrap-prebuild.sh" "MINELINK_DEVCONTAINER_IMAGE"
require_text "scripts/dev/bootstrap-prebuild.sh" "report_cache_state"
require_text "scripts/dev/bootstrap-prebuild.sh" "required OS tools already present"
require_text "scripts/dev/bootstrap-prebuild.sh" "LINEAR_API_KEY present"
require_text "scripts/dev/bootstrap-prebuild.sh" "./gradlew --no-daemon build"
require_text "scripts/dev/bootstrap-prebuild.sh" "mod/neoforge/run/eula.txt"
require_text "scripts/dev/bootstrap-prebuild.sh" "online-mode=false"
require_text "scripts/dev/check-devcontainer-image-access.sh" "anonymous pull access"
require_text "scripts/dev/check-devcontainer-image-access.sh" "authenticated pull access"
require_text "scripts/dev/check-devcontainer-image-access.sh" "docker_smoke"
require_text "scripts/dev/check-devcontainer-image-access.sh" "does not prove Ona Platform Codex"
require_text "scripts/dev/check-agent-factory-secrets.mjs" "never prints secret values"
require_text "scripts/dev/check-agent-factory-secrets.mjs" "ONA_TOKEN"
require_text "scripts/dev/check-agent-factory-secrets.mjs" "LINEAR_API_KEY"
require_text "scripts/dev/dispatch-agent-factory.mjs" "does not replace the required Ona Platform Codex"
require_text "scripts/dev/render-acceptance-video.mjs" "trace-driven MineLink acceptance artifacts"
require_text "scripts/dev/report-agent-factory-chain.mjs" "automation-chain evidence only"
require_text "scripts/dev/report-agent-factory-chain.mjs" "First Blocking Edge"
require_text "scripts/dev/report-agent-factory-chain.mjs" "agent-factory-secrets.json"
require_text "scripts/dev/check-video-review.mjs" "Release decision: pass"
require_text "scripts/dev/check-video-review.mjs" "Verifier: Ona Platform Codex"
require_text "scripts/dev/check-video-review.mjs" "Summary sha256"
require_text "scripts/dev/prepare-video-review-request.mjs" "Verifier: Ona Platform Codex"
require_text "scripts/dev/prepare-video-review-request.mjs" "video-review.md"
require_text "scripts/dev/summarize-evidence.mjs" "Acceptance Boundary"
require_text "scripts/dev/summarize-evidence.mjs" "GITHUB_STEP_SUMMARY"
require_text "scripts/dev/sync-linear-status.mjs" "LINEAR_API_KEY"
require_text "scripts/dev/verify-agent-task.sh" "install   fresh clone"
require_text "scripts/dev/watch-linear-agent-tasks.mjs" "polling/CI entrypoint"

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
    ".github/workflows/agent-factory-dispatch.yml" \
    "ona/ai-automations/minelink-agent-factory.yaml" \
    "scripts/dev/install-smoke.sh" \
    ".devcontainer/Dockerfile" \
    ".github/workflows/devcontainer-image.yml" \
    "scripts/dev/bootstrap-prebuild.sh" \
    "scripts/dev/check-devcontainer-image-access.sh" \
    "scripts/dev/dispatch-agent-factory.mjs" \
    "scripts/dev/check-video-review.mjs" \
    "scripts/dev/prepare-video-review-request.mjs" \
    "scripts/dev/render-acceptance-video.mjs" \
    "scripts/dev/report-agent-factory-chain.mjs" \
    "scripts/dev/summarize-evidence.mjs" \
    "scripts/dev/sync-linear-status.mjs" \
    "scripts/dev/watch-linear-agent-tasks.mjs" \
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
