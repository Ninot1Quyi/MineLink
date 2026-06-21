#!/usr/bin/env bash
set -euo pipefail

status_file="${1:-.minelink-dev/reports/ona-prebuild-status.json}"
out_dir="${2:-.minelink-dev/reports}"
mkdir -p "$out_dir"

summary="$out_dir/ona-prebuild-log-capture.md"
env_log="$out_dir/ona-prebuild-environment.log"
env_stderr="$out_dir/ona-prebuild-environment-log.stderr"
url_log="$out_dir/ona-prebuild-log-url.txt"
url_stderr="$out_dir/ona-prebuild-log-url.stderr"

if [[ ! -f "$status_file" ]]; then
  {
    echo "# MineLink Ona Prebuild Log Capture"
    echo
    echo "- Result: skipped"
    echo "- Reason: status file not found: \`$status_file\`"
  } > "$summary"
  exit 0
fi

metadata_json="$(
  node - "$status_file" <<'NODE'
const fs = require("node:fs");
const statusFile = process.argv[2];
const records = JSON.parse(fs.readFileSync(statusFile, "utf8"));
const record = Array.isArray(records) ? records[0] : records;
const status = record?.status ?? {};
process.stdout.write(JSON.stringify({
  environmentId: status.environmentId ?? "",
  logUrl: status.logUrl ?? "",
  phase: status.phase ?? "unknown",
  failureMessage: status.failureMessage ?? ""
}));
NODE
)"

json_field() {
  node -e 'const value = JSON.parse(process.argv[1])?.[process.argv[2]] ?? ""; process.stdout.write(String(value));' \
    "$metadata_json" \
    "$1"
}

environment_id="$(json_field environmentId)"
log_url="$(json_field logUrl)"
phase="$(json_field phase)"
failure_message="$(json_field failureMessage)"

env_result="skipped"
url_result="skipped"

if [[ -n "$environment_id" ]] && command -v ona >/dev/null 2>&1; then
  if ona environment logs "$environment_id" \
    --raw \
    --include-system-logs \
    --timeout 45s > "$env_log" 2> "$env_stderr"; then
    env_result="captured"
  else
    env_result="failed"
  fi
elif [[ -z "$environment_id" ]]; then
  env_result="skipped: missing environment id"
else
  env_result="skipped: ona cli missing"
fi

auth_token="${ONA_TOKEN:-${GITPOD_TOKEN:-}}"
if [[ -n "$log_url" && -n "$auth_token" ]]; then
  if curl -fsSL \
    -H "Authorization: Bearer $auth_token" \
    "$log_url" > "$url_log" 2> "$url_stderr"; then
    url_result="captured"
  else
    url_result="failed"
  fi
elif [[ -z "$log_url" ]]; then
  url_result="skipped: missing log URL"
else
  url_result="skipped: ONA_TOKEN/GITPOD_TOKEN missing"
fi

{
  echo "# MineLink Ona Prebuild Log Capture"
  echo
  echo "- Status file: \`$status_file\`"
  echo "- Phase: \`$phase\`"
  echo "- Environment: \`${environment_id:-missing}\`"
  echo "- Failure message: \`${failure_message:-none}\`"
  echo "- Ona environment log capture: \`$env_result\`"
  echo "- Log URL capture: \`$url_result\`"
  echo "- Environment log: \`$env_log\`"
  echo "- Environment stderr: \`$env_stderr\`"
  echo "- Log URL output: \`$url_log\`"
  echo "- Log URL stderr: \`$url_stderr\`"
} > "$summary"
