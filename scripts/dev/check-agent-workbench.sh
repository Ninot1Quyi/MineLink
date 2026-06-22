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
require_file ".github/workflows/ona-prebuild.yml"
require_file "ona/ai-automations/minelink-agent-factory.yaml"
require_file "scripts/dev/install-smoke.sh"
require_file "scripts/dev/bootstrap-prebuild.sh"
require_file "scripts/dev/check-devcontainer-image-access.sh"
require_file "scripts/dev/check-agent-factory-secrets.mjs"
require_file "scripts/dev/check-platform-codex-evidence.mjs"
require_file "scripts/dev/create-agent-factory-pr.mjs"
require_file "scripts/dev/wait-agent-factory-pr-ci.mjs"
require_file "scripts/dev/dispatch-agent-factory.mjs"
require_file "scripts/dev/check-video-review.mjs"
require_file "scripts/dev/prepare-video-review-request.mjs"
require_file "scripts/dev/render-acceptance-video.mjs"
require_file "scripts/dev/report-agent-factory-chain.mjs"
require_file "scripts/dev/start-ona-platform-codex.mjs"
require_file "scripts/dev/setup-linear-agent-factory.mjs"
require_file "scripts/dev/summarize-evidence.mjs"
require_file "scripts/dev/sync-github-status.mjs"
require_file "scripts/dev/sync-linear-status.mjs"
require_file "scripts/dev/trigger-agent-factory-full-chain.mjs"
require_file "scripts/dev/verify-agent-task.sh"
require_file "scripts/dev/watch-linear-agent-tasks.mjs"
require_file "scripts/dev/fetch-platform-codex-video-verifier.mjs"

require_text "AGENTS.md" "docs/agent-workbench.md"
require_text "AGENTS.md" "docs/linear-ona-agent-factory.md"
require_text "AGENTS.md" "Architecture Maintenance Guard"
require_text "AGENTS.md" "Product Completion Rule"
require_text "AGENTS.md" 'Self-reported `Identity: I am Codex running in Ona Platform Codex` is a'
require_text "AGENTS.md" "scripts/dev/start-ona-platform-codex.mjs"
require_text "ARCHITECTURE.md" "Parallel Development Model"
require_text "ARCHITECTURE.md" "AI-Native Delivery Model"
require_text "ARCHITECTURE.md" "Architecture Maintenance Guard"
require_text "docs/agent-workbench.md" "one environment = one task = one branch = one PR"
require_text "docs/agent-workbench.md" "ona/ai-automations/minelink-agent-factory.yaml"
require_text "docs/agent-workbench.md" "docs/agent-task-queue.md"
require_text "docs/agent-workbench.md" "platform-side Codex selector/API evidence"
require_text "docs/ona-migration.md" "Ona Environment Contract"
require_text "docs/ona-migration.md" "Ona Platform Codex is the target execution surface"
require_text "docs/ona-migration.md" 'Ona automation `agent` steps currently start the default Ona Agent'
require_text "docs/ona-migration.md" "Self-reported identity is not enough"
require_text "docs/ona-migration.md" "agent is disabled by organization policy"
require_text "docs/ona-migration.md" "Secrets Policy"
require_text "docs/ona-migration.md" "Validation Matrix"
require_text "docs/ona-migration.md" "Ona Platform Codex"
require_text "docs/linear-ona-agent-factory.md" "Ona CLI automation"
require_text "docs/linear-ona-agent-factory.md" "Ona Platform Codex"
require_text "docs/linear-ona-agent-factory.md" "Platform evidence"
require_text "docs/linear-ona-agent-factory.md" "identity self-report is"
require_text "docs/linear-ona-agent-factory.md" "agent is disabled by organization policy"
require_text "docs/linear-ona-agent-factory.md" "StartAgent"
require_text "docs/linear-ona-agent-factory.md" "MINELINK_ONA_CODEX_AGENT_ID"
require_text "docs/linear-ona-agent-factory.md" "LINEAR_API_KEY"
require_text "docs/linear-ona-agent-factory.md" "Acceptance video"
require_text "docs/linear-ona-agent-factory.md" "Release decision: pass"
require_text "docs/linear-ona-agent-factory.md" "ona-codex-implementation-session.md"
require_text "docs/linear-ona-agent-factory.md" "ona-codex-video-verifier-session.md"
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
require_text ".github/pull_request_template.md" "Same-session video verifier subagent"
require_text ".github/pull_request_template.md" "video-review-request.md"
require_text ".github/pull_request_template.md" "Remaining Product Gaps"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "minelink-agent-factory"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "Ona Platform Codex agent"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "run-agent-factory-stage.mjs"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "implementation-finalize"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "release-finalize"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "ona-codex-implementation-session.md"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "ona-codex-video-verifier-session.md"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "missing_public_ona_automation_codex_selector"
require_text "ona/ai-automations/minelink-agent-factory.yaml" 'Commit: $(git rev-parse --short HEAD'
require_text "ona/ai-automations/minelink-agent-factory.yaml" "maxParallel: 1"
require_text ".github/workflows/ona-platform-codex-probe.yml" "implementation_execution"
require_text ".github/workflows/ona-platform-codex-probe.yml" "MINELINK_PLATFORM_CODEX_IMPLEMENTATION_EXECUTION"
require_text ".github/workflows/ona-platform-codex-probe.yml" "Request implementation Codex verifier subagent"
require_text ".github/workflows/ona-platform-codex-probe.yml" "--readback-execution"
require_text "scripts/dev/start-ona-platform-codex.mjs" "shouldSendPromptToExistingExecution"
require_text "scripts/dev/start-ona-platform-codex.mjs" "native Codex subagent/verifier"
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
require_text ".github/workflows/agent-factory-dispatch.yml" "trigger-agent-factory-full-chain.mjs"
require_text ".github/workflows/agent-factory-dispatch.yml" "Trigger Platform Codex full-chain workflow"
require_text ".github/workflows/agent-factory-dispatch.yml" "check-agent-factory-secrets.mjs"
require_text ".github/workflows/agent-factory-dispatch.yml" "--cancel-ona-execution-on-timeout"
require_text ".github/workflows/agent-factory-dispatch.yml" "secrets.ONA_TOKEN"
require_text ".github/workflows/agent-factory-dispatch.yml" "secrets.LINEAR_API_KEY"
require_text ".github/workflows/agent-factory-dispatch.yml" "actions: write"
require_file ".github/workflows/ona-platform-codex-probe.yml"
require_text ".github/workflows/ona-platform-codex-probe.yml" "start-ona-platform-codex.mjs"
require_text ".github/workflows/ona-platform-codex-probe.yml" "secrets.ONA_TOKEN"
require_text ".github/workflows/ona-platform-codex-probe.yml" "MINELINK_ONA_CODEX_AGENT_ID"
require_text ".github/workflows/ona-platform-codex-probe.yml" "AGENT_FACTORY_GITHUB_TOKEN"
require_text ".github/workflows/ona-platform-codex-probe.yml" "identity-canary"
require_text ".github/workflows/ona-platform-codex-probe.yml" "implementation-canary"
require_text ".github/workflows/ona-platform-codex-probe.yml" "fetch-platform-codex-canary.mjs"
require_text ".github/workflows/ona-platform-codex-probe.yml" "video-verifier-canary"
require_text ".github/workflows/ona-platform-codex-probe.yml" "full-chain-canary"
require_text ".github/workflows/ona-platform-codex-probe.yml" "fetch-platform-codex-video-verifier.mjs"
require_text ".github/workflows/ona-prebuild.yml" "codex/minelink-mvp-engineering"
require_text ".github/workflows/ona-prebuild.yml" "paths:"
require_text ".github/workflows/ona-prebuild.yml" "secrets.ONA_TOKEN"
require_text ".github/workflows/ona-prebuild.yml" "ona prebuild cancel"
require_text ".github/workflows/ona-prebuild.yml" "ona prebuild trigger"
require_text ".github/workflows/ona-prebuild.yml" "ona prebuild get"
require_text ".github/workflows/ona-prebuild.yml" "PREBUILD_PHASE_COMPLETED"
require_text ".github/workflows/ona-prebuild.yml" "snapshotCompletionPercentage"
require_text ".github/workflows/ona-prebuild.yml" "minelink-ona-prebuild"
require_text ".github/workflows/install-smoke.yml" "minelink-install-smoke-evidence"
require_text ".github/workflows/install-smoke.yml" "scripts/dev/summarize-evidence.mjs"
require_text ".github/workflows/ci.yml" "Summarize MineLink evidence"
require_text ".github/workflows/minecraft-neoforge.yml" "Summarize MineLink evidence"
require_text ".github/workflows/install-smoke.yml" "Summarize MineLink evidence"
require_text ".devcontainer/devcontainer.json" "postCreateCommand"
require_text ".devcontainer/devcontainer.json" "postAttachCommand"
require_text ".devcontainer/devcontainer.json" "scripts/dev/bootstrap-prebuild.sh"
require_text ".devcontainer/devcontainer.json" "--light"
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
require_text "scripts/dev/bootstrap-prebuild.sh" "MINELINK_PREBUILD_KEEP_OUTPUTS"
require_text "scripts/dev/bootstrap-prebuild.sh" "MINELINK_DEVCONTAINER_IMAGE"
require_text "scripts/dev/bootstrap-prebuild.sh" "light bootstrap; skipping Gradle/NeoForge cache warmup"
require_text "scripts/dev/bootstrap-prebuild.sh" "report_cache_state"
require_text "scripts/dev/bootstrap-prebuild.sh" "required OS tools already present"
require_text "scripts/dev/bootstrap-prebuild.sh" "LINEAR_API_KEY present"
require_text "scripts/dev/bootstrap-prebuild.sh" "./gradlew --no-daemon build"
require_text "scripts/dev/bootstrap-prebuild.sh" "pruned checkout-local build outputs before Ona snapshot"
require_text "scripts/dev/bootstrap-prebuild.sh" "mod/neoforge/run/eula.txt"
require_text "scripts/dev/bootstrap-prebuild.sh" "online-mode=false"
require_text "scripts/dev/check-devcontainer-image-access.sh" "anonymous pull access"
require_text "scripts/dev/check-devcontainer-image-access.sh" "authenticated pull access"
require_text "scripts/dev/check-devcontainer-image-access.sh" "docker_smoke"
require_text "scripts/dev/check-devcontainer-image-access.sh" "does not prove Ona Platform Codex"
require_text "scripts/dev/check-agent-factory-secrets.mjs" "never prints secret values"
require_text "scripts/dev/check-agent-factory-secrets.mjs" "ONA_TOKEN"
require_text "scripts/dev/check-agent-factory-secrets.mjs" "LINEAR_API_KEY"
require_text "scripts/dev/check-agent-factory-secrets.mjs" "AGENT_FACTORY_GITHUB_TOKEN"
require_text "scripts/dev/wait-agent-factory-pr-ci.mjs" "statusCheckRollup"
require_text "scripts/dev/wait-agent-factory-pr-ci.mjs" "agent-factory-pr-ci.json"
require_text "scripts/dev/check-platform-codex-evidence.mjs" "Agent mode: Ona Platform Codex"
require_text "scripts/dev/check-platform-codex-evidence.mjs" "Identity: I am Codex running in Ona Platform Codex"
require_text "scripts/dev/check-platform-codex-evidence.mjs" "Platform evidence"
require_text "scripts/dev/check-platform-codex-evidence.mjs" "self-reported identity"
require_text "scripts/dev/check-platform-codex-evidence.mjs" "generic Ona automation"
require_text "scripts/dev/check-platform-codex-evidence.mjs" "Task id mismatch"
require_text "scripts/dev/check-platform-codex-evidence.mjs" "Branch mismatch"
require_text "scripts/dev/check-platform-codex-evidence.mjs" "Commit mismatch"
require_text "scripts/dev/run-agent-factory-stage.mjs" "check-platform-codex-evidence.mjs"
require_text "scripts/dev/run-agent-factory-stage.mjs" "implementation-finalize"
require_text "scripts/dev/run-agent-factory-stage.mjs" "release-finalize"
require_text "scripts/dev/run-agent-factory-stage.mjs" "render-acceptance-video.mjs"
require_text "scripts/dev/run-agent-factory-stage.mjs" "--implementation"
require_text "scripts/dev/run-agent-factory-stage.mjs" "--verifier"
require_text "scripts/dev/run-agent-factory-stage.mjs" "blocked_waiting_for_platform_codex_evidence"
require_text "scripts/dev/run-agent-factory-stage.mjs" "check-video-review.mjs"
require_text "scripts/dev/run-agent-factory-stage.mjs" "prepare-video-review-request.mjs"
require_text "scripts/dev/run-agent-factory-stage.mjs" "report-agent-factory-chain.mjs"
require_text "scripts/dev/run-agent-factory-stage.mjs" "create-agent-factory-pr.mjs"
require_text "scripts/dev/run-agent-factory-stage.mjs" "video-review-request.md"
require_text "scripts/dev/create-agent-factory-pr.mjs" "gh"
require_text "scripts/dev/create-agent-factory-pr.mjs" "codex/minelink-mvp-engineering"
require_text "scripts/dev/dispatch-agent-factory.mjs" "does not replace the required Ona Platform Codex"
require_text "scripts/dev/dispatch-agent-factory.mjs" "cancel-ona-execution-on-timeout"
require_text "scripts/dev/dispatch-agent-factory.mjs" "cancel-execution"
require_text "scripts/dev/start-ona-platform-codex.mjs" "AgentService/StartAgent"
require_text "scripts/dev/start-ona-platform-codex.mjs" "MINELINK_ONA_CODEX_AGENT_ID"
require_text "scripts/dev/start-ona-platform-codex.mjs" "codexSettings"
require_text "scripts/dev/start-ona-platform-codex.mjs" "default Ona automation agent id"
require_text "scripts/dev/start-ona-platform-codex.mjs" "implementation-canary"
require_text "scripts/dev/start-ona-platform-codex.mjs" "video-verifier-canary"
require_file ".codex/config.toml"
require_text ".codex/config.toml" "model = \"gpt-5.5\""
require_text ".codex/config.toml" "model_context_window = 258400"
require_text ".codex/config.toml" "model_auto_compact_token_limit = 240000"
require_file "scripts/dev/fetch-platform-codex-canary.mjs"
require_text "scripts/dev/fetch-platform-codex-canary.mjs" "implementation-canary handoff evidence only"
require_text "scripts/dev/fetch-platform-codex-canary.mjs" "spec.agentId matched configured Codex agent id"
require_text "scripts/dev/fetch-platform-codex-video-verifier.mjs" "video-verifier-canary handoff evidence only"
require_text "scripts/dev/fetch-platform-codex-video-verifier.mjs" "spec.agentId matched configured Codex agent id"
require_text "scripts/dev/render-acceptance-video.mjs" "trace-driven MineLink acceptance artifacts"
require_text "scripts/dev/render-acceptance-video.mjs" "acceptance-video-origin.json"
require_text "scripts/dev/report-agent-factory-chain.mjs" "automation-chain evidence only"
require_text "scripts/dev/report-agent-factory-chain.mjs" "First Blocking Edge"
require_text "scripts/dev/report-agent-factory-chain.mjs" "timed_out_cancelled"
require_text "scripts/dev/report-agent-factory-chain.mjs" "agent-factory-secrets.json"
require_text "scripts/dev/report-agent-factory-chain.mjs" "ona-platform-codex-api-session.json"
require_text "scripts/dev/report-agent-factory-chain.mjs" "platform_codex_launch"
require_text "scripts/dev/report-agent-factory-chain.mjs" "ona-codex-implementation-session.md"
require_text "scripts/dev/report-agent-factory-chain.mjs" "require-platform-codex-implementation"
require_text "scripts/dev/setup-linear-agent-factory.mjs" "LINEAR_API_KEY"
require_text "scripts/dev/setup-linear-agent-factory.mjs" "Ready for Agent"
require_text "scripts/dev/setup-linear-agent-factory.mjs" "video-required"
require_text "scripts/dev/check-video-review.mjs" "Release decision: pass"
require_text "scripts/dev/check-video-review.mjs" "Verifier: Ona Platform Codex"
require_text "scripts/dev/check-video-review.mjs" "Summary sha256"
require_text "scripts/dev/check-video-review.mjs" "--require-producer"
require_text "scripts/dev/prepare-video-review-request.mjs" "Verifier: Ona Platform Codex"
require_text "scripts/dev/prepare-video-review-request.mjs" "video-review.md"
require_text "scripts/dev/prepare-video-review-request.mjs" "Video producer"
require_text ".github/workflows/ona-platform-codex-probe.yml" "create_pr"
require_text ".github/workflows/ona-platform-codex-probe.yml" "Create or update canary PR after release gate"
require_text ".github/workflows/ona-platform-codex-probe.yml" "Wait for canary PR CI"
require_text ".github/workflows/ona-platform-codex-probe.yml" "Sync final canary status"
require_text ".github/workflows/ona-platform-codex-probe.yml" "MINELINK_AGENT_FACTORY_CI_URL"
require_text ".github/workflows/ona-platform-codex-probe.yml" "Refresh chain report after canary PR"
require_text ".github/workflows/ona-platform-codex-probe.yml" "create-agent-factory-pr.mjs"
require_text ".github/workflows/ona-platform-codex-probe.yml" "wait-agent-factory-pr-ci.mjs"
require_text ".github/workflows/ona-platform-codex-probe.yml" "sync-github-status.mjs"
require_text ".github/workflows/ona-platform-codex-probe.yml" "--ci-url"
require_text ".github/workflows/ona-platform-codex-probe.yml" "--github-status-url"
require_text ".github/workflows/ona-platform-codex-probe.yml" "--producer github-actions-canary"
require_text "ona/ai-automations/minelink-agent-factory.yaml" "Identity: unavailable"
require_text "docs/linear-ona-agent-factory.md" "Identity: I am Codex running in Ona Platform Codex"
require_text "docs/ona-migration.md" "Identity: I am Codex running in Ona Platform Codex"
require_text "scripts/dev/summarize-evidence.mjs" "Acceptance Boundary"
require_text "scripts/dev/summarize-evidence.mjs" "GITHUB_STEP_SUMMARY"
require_text "scripts/dev/sync-github-status.mjs" "GitHub status writeback"
require_text "scripts/dev/sync-github-status.mjs" 'issues/${target.number}/comments'
require_text "scripts/dev/sync-linear-status.mjs" "LINEAR_API_KEY"
require_text "scripts/dev/trigger-agent-factory-full-chain.mjs" "mode=full-chain-canary"
require_text "scripts/dev/trigger-agent-factory-full-chain.mjs" "agent-factory-dispatch.json"
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
    "scripts/dev/check-platform-codex-evidence.mjs" \
    "scripts/dev/create-agent-factory-pr.mjs" \
    "scripts/dev/dispatch-agent-factory.mjs" \
    "scripts/dev/check-video-review.mjs" \
    "scripts/dev/prepare-video-review-request.mjs" \
    "scripts/dev/render-acceptance-video.mjs" \
    "scripts/dev/report-agent-factory-chain.mjs" \
    "scripts/dev/fetch-platform-codex-video-verifier.mjs" \
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
