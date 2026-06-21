#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

log() {
  printf '[minelink-prebuild] %s\n' "$*"
}

run() {
  log "+ $*"
  "$@"
}

install_os_packages() {
  if ! command -v apt-get >/dev/null 2>&1; then
    log "apt-get not found; skipping OS package installation"
    return
  fi

  local sudo_cmd=()
  if [[ "$(id -u)" -ne 0 ]]; then
    sudo_cmd=(sudo)
  fi

  run "${sudo_cmd[@]}" apt-get update
  run "${sudo_cmd[@]}" apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    git
}

check_runtime_versions() {
  run node --version
  run npm --version
  run python3 --version
  run java -version
  run ffmpeg -version
  if command -v gh >/dev/null 2>&1; then
    run gh --version
  else
    log "gh not found; GitHub CLI feature may not be installed"
  fi

  if [[ -n "${LINEAR_API_KEY:-}" ]]; then
    log "LINEAR_API_KEY present"
  else
    log "LINEAR_API_KEY missing; Linear sync will be skipped until the Ona secret is attached"
  fi
}

warm_node_workspace() {
  run npm ci
  run npm run build
  run npm run typecheck
}

warm_neoforge_workspace() {
  if [[ "${MINELINK_PREBUILD_SKIP_GRADLE:-0}" == "1" ]]; then
    log "MINELINK_PREBUILD_SKIP_GRADLE=1; skipping Gradle/NeoForge cache warmup"
    return
  fi

  pushd mod/neoforge >/dev/null
  run ./gradlew --no-daemon --version
  run ./gradlew --no-daemon build
  popd >/dev/null
}

run_repo_guards() {
  run bash scripts/dev/verify-agent-task.sh --scope docs
}

install_os_packages
check_runtime_versions
warm_node_workspace
warm_neoforge_workspace
run_repo_guards

log "prebuild bootstrap complete"
