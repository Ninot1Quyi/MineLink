#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
repo_root="$(pwd -P)"

scenario="${1:-mine_tree}"
port="${MINELINK_PORT:-}"
runtime="${MINELINK_RUNTIME:-mock}"
work_dir="${MINELINK_WORK_DIR:-.minelink-dev/$scenario}"
record_client="${MINELINK_RECORD_CLIENT:-0}"
gradle_jvmargs="${MINELINK_GRADLE_JVMARGS:-}"

truthy_value() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

case "$scenario" in
  mine_tree)
    fixture="vanilla_tree"
    report="$work_dir/reports/mine_tree-result.json"
    default_port="25575"
    ;;
  create_smoke)
    fixture="create_smoke"
    report="$work_dir/reports/create_smoke-result.json"
    default_port="25576"
    ;;
  craft_smoke)
    fixture="craft_smoke"
    report="$work_dir/reports/craft_smoke-result.json"
    default_port="25577"
    ;;
  furnace_smoke)
    fixture="furnace_smoke"
    report="$work_dir/reports/furnace_smoke-result.json"
    default_port="25582"
    ;;
  craft_negative)
    fixture="craft_smoke"
    report="$work_dir/reports/craft_negative-result.json"
    default_port="25578"
    ;;
  guard_boundaries)
    fixture="guard_boundaries"
    report="$work_dir/reports/guard_boundaries-result.json"
    default_port="25580"
    ;;
  body_lifecycle)
    fixture="vanilla_tree"
    report="$work_dir/reports/body_lifecycle-result.json"
    default_port="25583"
    ;;
  perception_shapes)
    fixture="perception_shapes"
    report="$work_dir/reports/perception_shapes-result.json"
    default_port="25581"
    ;;
  portal_coop)
    fixture="portal_coop"
    report="$work_dir/reports/portal_coop-result.json"
    default_port="25579"
    ;;
  *)
    echo "Unknown e2e scenario: $scenario" >&2
    exit 2
    ;;
esac
port="${port:-$default_port}"

if [ "$runtime" = "neoforge" ]; then
  minecraft_port="${MINELINK_MINECRAFT_PORT:-}"
  if [ -z "$minecraft_port" ]; then
    case "$port" in
      ''|*[!0-9]*)
        echo "MINELINK_PORT must be numeric when deriving a NeoForge server port: $port" >&2
        exit 2
        ;;
    esac
    minecraft_port=$((port + 1000))
  fi
  export MINELINK_MINECRAFT_PORT="$minecraft_port"
  e2e_run_id="${MINELINK_E2E_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-${BASHPID:-$$}-$RANDOM}"
  e2e_run_id="$(printf '%s' "$e2e_run_id" | tr -c 'A-Za-z0-9._-' '_' | cut -c 1-48)"
  if [ -z "$e2e_run_id" ]; then
    e2e_run_id="$(date -u +%Y%m%dT%H%M%SZ)-${BASHPID:-$$}-$RANDOM"
  fi
  export MINELINK_E2E_RUN_ID="$e2e_run_id"
  level_name="${MINELINK_MINECRAFT_LEVEL_NAME:-minelink-${scenario}-${port}-${e2e_run_id}}"
  level_name="$(printf '%s' "$level_name" | tr -c 'A-Za-z0-9._-' '_' | cut -c 1-80)"
  export MINELINK_MINECRAFT_LEVEL_NAME="$level_name"
fi

rm -rf "$work_dir"
mkdir -p "$work_dir/logs" "$work_dir/replays" "$work_dir/reports"
{
  echo "MINELINK_RUNTIME=$runtime"
  echo "MINELINK_FIXTURE=$fixture"
  echo "MINELINK_PORT=$port"
  echo "MINELINK_MINECRAFT_PORT=${minecraft_port:-}"
  echo "MINELINK_MINECRAFT_LEVEL_NAME=${MINELINK_MINECRAFT_LEVEL_NAME:-}"
  echo "MINELINK_E2E_RUN_ID=${MINELINK_E2E_RUN_ID:-}"
  echo "MINELINK_RECORD_CLIENT=$record_client"
  echo "workDir=$work_dir"
} > "$work_dir/logs/server-config.log"

if [ "${MINELINK_SKIP_BUILD:-0}" != "1" ]; then
  scripts/dev/build.sh
fi

export MINELINK_FIXTURE="$fixture"
export MINELINK_PORT="$port"
if [ "$scenario" = "guard_boundaries" ]; then
  export MINELINK_REF_TTL_MS="${MINELINK_REF_TTL_MS:-1000}"
fi
if [ "$runtime" = "neoforge" ] && [ "$scenario" = "create_smoke" ]; then
  export MINELINK_ENABLE_CREATE="${MINELINK_ENABLE_CREATE:-1}"
fi
if [ "$runtime" = "neoforge" ]; then
  export MINELINK_ENDPOINT="http://127.0.0.1:$port/minelink"
else
  export MINELINK_ENDPOINT="ws://127.0.0.1:$port"
fi
export MINELINK_REPORT="$report"
export MINELINK_LOG_DIR="$work_dir/logs"
export MINELINK_TRACE="$work_dir/replays/latest-action-trace.jsonl"
if truthy_value "$record_client"; then
  if [ "$runtime" != "neoforge" ]; then
    echo "MINELINK_RECORD_CLIENT=1 requires MINELINK_RUNTIME=neoforge." >&2
    exit 2
  fi
  export MINELINK_RECORDER_ENABLED="${MINELINK_RECORDER_ENABLED:-1}"
  export MINELINK_RECORDER_PLAYER_NAME="${MINELINK_RECORDER_PLAYER_NAME:-MineLinkRecorder}"
fi

server_pid=""
gateway_pid=""
client_pid=""
ffmpeg_pid=""
xvfb_pid=""
client_capture=""
client_capture_ready=""
kill_tree() {
  pid="$1"
  if command -v pgrep >/dev/null 2>&1; then
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do
      kill_tree "$child"
    done
  fi
  kill "$pid" >/dev/null 2>&1 || true
}

kill_repo_neoforge_processes() {
  if [ "$runtime" != "neoforge" ]; then
    return 0
  fi
  if ! truthy_value "${MINELINK_E2E_PRE_CLEAN_NEOFORGE:-1}"; then
    return 0
  fi
  if ! command -v ps >/dev/null 2>&1; then
    return 0
  fi
  local neoforge_root="$repo_root/mod/neoforge"
  local current_pid="${BASHPID:-$$}"
  ps -eo pid=,ppid=,args= 2>/dev/null | while read -r pid ppid args; do
    if [ -z "${pid:-}" ]; then
      continue
    fi
    case "$pid" in
      *[!0-9]*)
        continue
        ;;
    esac
    if [ "$pid" = "$$" ] || [ "$pid" = "$current_pid" ]; then
      continue
    fi
    case "${args:-}" in
      *"$neoforge_root"*runServer*|*"$neoforge_root"*"net.neoforged.devlaunch.Main"*|*"$neoforge_root"*"serverRunProgramArgs.txt"*)
        {
          echo "pre-clean repo NeoForge process pid $pid ppid ${ppid:-unknown}"
          ps -p "$pid" -o pid,ppid,etime,cmd 2>/dev/null || true
        } >> "$work_dir/logs/pre-clean.log" 2>/dev/null || true
        kill_tree "$pid"
        sleep 1
        if kill -0 "$pid" >/dev/null 2>&1; then
          kill -9 "$pid" >/dev/null 2>&1 || true
        fi
        ;;
    esac
  done
}

quiesce_repo_background_tasks() {
  if ! truthy_value "${MINELINK_E2E_QUIESCE_REPO_TASKS:-0}"; then
    return 0
  fi
  if ! command -v ps >/dev/null 2>&1; then
    return 0
  fi
  local current_pid="${BASHPID:-$$}"
  ps -eo pid=,ppid=,args= 2>/dev/null | while read -r pid ppid args; do
    if [ -z "${pid:-}" ]; then
      continue
    fi
    case "$pid" in
      *[!0-9]*)
        continue
        ;;
    esac
    if [ "$pid" = "$$" ] || [ "$pid" = "$current_pid" ]; then
      continue
    fi
    case "${args:-}" in
      *"$repo_root"*"npm run build"*|*"$repo_root"*"npm run typecheck"*|*"$repo_root"*"node_modules/.bin/tsc"*|*"$repo_root"*"node_modules/vitest"*|*"$repo_root"*"verify-agent-task.sh"*)
        {
          echo "quiesce repo task pid $pid ppid ${ppid:-unknown}"
          ps -p "$pid" -o pid,ppid,etime,cmd 2>/dev/null || true
        } >> "$work_dir/logs/pre-clean.log" 2>/dev/null || true
        kill_tree "$pid"
        sleep 1
        if kill -0 "$pid" >/dev/null 2>&1; then
          kill -9 "$pid" >/dev/null 2>&1 || true
        fi
        ;;
    esac
  done
  if [ -x mod/neoforge/gradlew ]; then
    (cd mod/neoforge && ./gradlew --stop) >> "$work_dir/logs/pre-clean.log" 2>&1 || true
  fi
}

kill_port_listeners() {
  if ! truthy_value "${MINELINK_E2E_PRE_CLEAN_PORTS:-1}"; then
    return 0
  fi
  for target_port in "$@"; do
    if [ -z "$target_port" ]; then
      continue
    fi
    case "$target_port" in
      *[!0-9]*)
        continue
        ;;
    esac
    pids=""
    if command -v lsof >/dev/null 2>&1; then
      pids="$(lsof -tiTCP:"$target_port" -sTCP:LISTEN 2>/dev/null || true)"
    elif command -v fuser >/dev/null 2>&1; then
      pids="$(fuser -n tcp "$target_port" 2>/dev/null || true)"
    fi
    if [ -z "$pids" ]; then
      continue
    fi
    for pid in $pids; do
      if [ "$pid" = "$$" ]; then
        continue
      fi
      {
        echo "pre-clean port $target_port listener pid $pid"
        ps -p "$pid" -o pid,ppid,etime,cmd 2>/dev/null || true
      } >> "$work_dir/logs/pre-clean.log" 2>/dev/null || true
      kill_tree "$pid"
      sleep 1
      if kill -0 "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" >/dev/null 2>&1 || true
      fi
    done
  done
}

dump_failure() {
  status="$1"
  echo "MineLink e2e scenario '$scenario' failed with exit code $status." >&2
  if [ -f "$report" ]; then
    echo "---- MineLink report: $report ----" >&2
    python3 - "$report" <<'PY' >&2 || cat "$report" >&2
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print(json.dumps(
    {
        "scenario": payload.get("scenario"),
        "passed": payload.get("passed"),
        "final_assertions": payload.get("final_assertions"),
        "tool_failures": [
            {
                "turn": item.get("turn"),
                "name": item.get("name"),
                "arguments": item.get("arguments"),
                "status": (item.get("result") or {}).get("status"),
                "reason": (item.get("result") or {}).get("reason"),
                "error": (item.get("result") or {}).get("error"),
            }
            for item in payload.get("tool_results", [])
            if (item.get("result") or {}).get("ok") is False
            or (item.get("result") or {}).get("status") in {"failed", "blocked"}
            or (item.get("result") or {}).get("error")
        ],
    },
    indent=2,
    sort_keys=True,
))
PY
  fi
  failure_tail="$work_dir/reports/e2e-failure-log-tail.txt"
  {
    for log_file in \
      "$work_dir/logs/server.stdout.log" \
      "$work_dir/logs/server-config.log" \
      "$work_dir/logs/pre-clean.log" \
      "$work_dir/logs/server.stderr.log" \
      "$work_dir/logs/gateway.stdout.log" \
      "$work_dir/logs/gateway.stderr.log" \
      "$work_dir/logs/agent.log" \
      "$work_dir/logs/client-config.log" \
      "$work_dir/logs/client-capture-ready.log" \
      "$work_dir/logs/recorder-xvfb.log" \
      "$work_dir/logs/recorder-ffmpeg.log" \
      "$work_dir/logs/client.stdout.log" \
      "$work_dir/logs/client.stderr.log"; do
      if [ -f "$log_file" ]; then
        echo "---- tail $log_file ----"
        tail -n 160 "$log_file" || true
      fi
    done
  } > "$failure_tail" 2>/dev/null || true
  cat "$failure_tail" >&2 || true
}

cleanup() {
  if [ -n "$ffmpeg_pid" ] && kill -0 "$ffmpeg_pid" >/dev/null 2>&1; then
    kill -INT "$ffmpeg_pid" >/dev/null 2>&1 || true
    sleep 1
    kill_tree "$ffmpeg_pid"
    wait "$ffmpeg_pid" >/dev/null 2>&1 || true
  fi
  if [ -n "$client_pid" ] && kill -0 "$client_pid" >/dev/null 2>&1; then
    kill_tree "$client_pid"
    wait "$client_pid" >/dev/null 2>&1 || true
  fi
  if [ -n "$xvfb_pid" ] && kill -0 "$xvfb_pid" >/dev/null 2>&1; then
    kill_tree "$xvfb_pid"
    wait "$xvfb_pid" >/dev/null 2>&1 || true
  fi
  if [ -n "$gateway_pid" ] && kill -0 "$gateway_pid" >/dev/null 2>&1; then
    kill_tree "$gateway_pid"
    wait "$gateway_pid" >/dev/null 2>&1 || true
  fi
  if [ -n "$server_pid" ] && kill -0 "$server_pid" >/dev/null 2>&1; then
    kill_tree "$server_pid"
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
}
on_exit() {
  status="$?"
  if [ "$status" -ne 0 ]; then
    dump_failure "$status"
  fi
  cleanup
  return "$status"
}
trap on_exit EXIT

wait_for_log_text() {
  log_file="$1"
  text="$2"
  timeout_seconds="$3"
  deadline=$((SECONDS + timeout_seconds))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ -f "$log_file" ] && grep -Fq "$text" "$log_file"; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for '$text' in $log_file" >&2
  return 1
}

wait_for_any_log_text() {
  text="$1"
  timeout_seconds="$2"
  shift 2
  deadline=$((SECONDS + timeout_seconds))
  while [ "$SECONDS" -lt "$deadline" ]; do
    for log_file in "$@"; do
      if [ -f "$log_file" ] && grep -Fq "$text" "$log_file"; then
        return 0
      fi
    done
    sleep 1
  done
  echo "Timed out waiting for '$text' in logs: $*" >&2
  return 1
}

record_resource_snapshot() {
  label="$1"
  {
    echo "=== $label $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
    echo "nproc=$(command -v nproc >/dev/null 2>&1 && nproc || printf unknown)"
    uptime || true
    free -h 2>/dev/null || true
    ps -eo pid,ppid,stat,pcpu,pmem,etime,cmd --sort=-pcpu 2>/dev/null | head -20 || true
    echo
  } >> "$work_dir/logs/resource-snapshots.log" 2>/dev/null || true
}

write_recorder_client_options() {
  options_file="$1"
  profile="${MINELINK_RECORDER_CLIENT_OPTIONS_PROFILE:-ci_low_cpu}"
  if [ "$profile" = "off" ] || [ "$profile" = "none" ]; then
    return 0
  fi
  mkdir -p "$(dirname "$options_file")"
  cat > "$options_file" <<'EOF'
version:3465
autoJump:false
biomeBlendRadius:0
bobView:false
clouds:false
entityShadows:false
enableVsync:false
fancyGraphics:false
graphicsMode:fast
maxFps:30
mipmapLevels:0
particles:0
prioritizeChunkUpdates:0
renderDistance:4
simulationDistance:4
smoothLighting:false
syncChunkWrites:false
EOF
}

start_recorder_client() {
  if ! truthy_value "$record_client"; then
    return 0
  fi
  if [ "$runtime" != "neoforge" ]; then
    echo "MINELINK_RECORD_CLIENT=1 requires MINELINK_RUNTIME=neoforge." >&2
    exit 2
  fi
  recorder_display="${MINELINK_RECORDER_DISPLAY:-${DISPLAY:-:99}}"
  recorder_video_size="${MINELINK_RECORDER_VIDEO_SIZE:-960x720}"
  recorder_fps="${MINELINK_RECORDER_FPS:-15}"
  recorder_width="${recorder_video_size%x*}"
  recorder_height="${recorder_video_size#*x}"
  case "$recorder_width:$recorder_height" in
    *[!0-9:]*|:|*:) recorder_width="960"; recorder_height="720" ;;
  esac
  if [ "$recorder_width" = "$recorder_video_size" ] || [ "$recorder_height" = "$recorder_video_size" ]; then
    recorder_width="960"
    recorder_height="720"
  fi
  recorder_needs_xvfb=0
  if [ -z "${DISPLAY:-}" ] || [ "${MINELINK_RECORDER_FORCE_XVFB:-0}" = "1" ]; then
    recorder_needs_xvfb=1
  fi

  record_resource_snapshot "recorder-before-deps"
  ensure_args=(--require-ffmpeg)
  if [ "$recorder_needs_xvfb" = "1" ]; then
    ensure_args+=(--require-xvfb)
  fi
  if truthy_value "${MINELINK_RECORDER_AUTO_INSTALL_DEPS:-0}"; then
    ensure_args+=(--install-missing)
  fi
  bash scripts/dev/ensure-client-recorder-deps.sh "${ensure_args[@]}"

  if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg is required for MineLink client acceptance recording." >&2
    exit 2
  fi

  if [ "$recorder_needs_xvfb" = "1" ]; then
    if ! command -v Xvfb >/dev/null 2>&1; then
      echo "Xvfb is required for headless Minecraft client recording when DISPLAY is not set." >&2
      exit 2
    fi
    Xvfb "$recorder_display" -screen 0 "${recorder_video_size}x24" \
      > "$work_dir/logs/recorder-xvfb.log" \
      2>&1 &
    xvfb_pid="$!"
    export DISPLAY="$recorder_display"
    sleep 2
  else
    export DISPLAY="$recorder_display"
  fi

  client_capture="$work_dir/reports/client-capture.mp4"
  client_capture_ready="$work_dir/logs/client-capture-ready.log"

  export MINELINK_RECORDER_CLIENT_ENABLED="${MINELINK_RECORDER_CLIENT_ENABLED:-1}"
  export MINELINK_RECORDER_CLIENT_USERNAME="${MINELINK_RECORDER_CLIENT_USERNAME:-MineLinkRecorder}"
  export MINELINK_RECORDER_CLIENT_ADDRESS="${MINELINK_RECORDER_CLIENT_ADDRESS:-127.0.0.1:$minecraft_port}"
  export MINELINK_RECORDER_CLIENT_WIDTH="${MINELINK_RECORDER_CLIENT_WIDTH:-$recorder_width}"
  export MINELINK_RECORDER_CLIENT_HEIGHT="${MINELINK_RECORDER_CLIENT_HEIGHT:-$recorder_height}"
  export MINELINK_RECORDER_CLIENT_CONNECT_DELAY_TICKS="${MINELINK_RECORDER_CLIENT_CONNECT_DELAY_TICKS:-40}"
  recorder_client_game_dir="${MINELINK_RECORDER_CLIENT_GAME_DIR:-$work_dir/recorder-game-dir}"
  case "$recorder_client_game_dir" in
    /*) ;;
    *) recorder_client_game_dir="$repo_root/$recorder_client_game_dir" ;;
  esac
  mkdir -p "$recorder_client_game_dir"
  write_recorder_client_options "$recorder_client_game_dir/options.txt"
  export MINELINK_RECORDER_CLIENT_GAME_DIR="$recorder_client_game_dir"
  {
    echo "MINELINK_RECORDER_CLIENT_GAME_DIR=$MINELINK_RECORDER_CLIENT_GAME_DIR"
    echo "MINELINK_RECORDER_CLIENT_ADDRESS=$MINELINK_RECORDER_CLIENT_ADDRESS"
    echo "MINELINK_RECORDER_CLIENT_USERNAME=$MINELINK_RECORDER_CLIENT_USERNAME"
    echo "MINELINK_RECORDER_CLIENT_WIDTH=$MINELINK_RECORDER_CLIENT_WIDTH"
    echo "MINELINK_RECORDER_CLIENT_HEIGHT=$MINELINK_RECORDER_CLIENT_HEIGHT"
    echo "MINELINK_RECORDER_VIDEO_SIZE=$recorder_video_size"
    echo "MINELINK_RECORDER_FPS=$recorder_fps"
    echo "MINELINK_RECORDER_CLIENT_OPTIONS_PROFILE=${MINELINK_RECORDER_CLIENT_OPTIONS_PROFILE:-ci_low_cpu}"
    echo "DISPLAY=$DISPLAY"
  } > "$work_dir/logs/client-config.log"

  record_resource_snapshot "recorder-before-client"
  gradle_run_args=(--no-daemon)
  if [ -n "$gradle_jvmargs" ]; then
    gradle_run_args+=("-Dorg.gradle.jvmargs=$gradle_jvmargs")
  fi
  (
    cd mod/neoforge
    if truthy_value "${MINELINK_ENABLE_CREATE:-0}"; then
      exec ./gradlew "${gradle_run_args[@]}" -PenableCreateAdapter=true runClient
    fi
    exec ./gradlew "${gradle_run_args[@]}" runClient
  ) > "$work_dir/logs/client.stdout.log" 2> "$work_dir/logs/client.stderr.log" &
  client_pid="$!"

  wait_for_any_log_text \
    "MineLink recorder client joined" \
    "${MINELINK_RECORDER_CLIENT_JOIN_TIMEOUT:-120}" \
    "$work_dir/logs/client.stdout.log" \
    "$work_dir/logs/client.stderr.log"

  wait_for_any_log_text \
    "MineLink recorder client in world" \
    "${MINELINK_RECORDER_CLIENT_WORLD_READY_TIMEOUT:-180}" \
    "$work_dir/logs/client.stdout.log" \
    "$work_dir/logs/client.stderr.log"

  {
    echo "MineLink recorder client in world confirmed"
    echo "clientWorldReady=true"
    echo "DISPLAY=$DISPLAY"
    echo "clientCapture=$client_capture"
    echo "worldReadyLog=MineLink recorder client in world"
  } > "$client_capture_ready"

  ffmpeg -y -hide_banner -loglevel warning \
    -thread_queue_size 64 \
    -f x11grab \
    -video_size "$recorder_video_size" \
    -framerate "$recorder_fps" \
    -i "$DISPLAY" \
    -an \
    -c:v "${MINELINK_RECORDER_VIDEO_CODEC:-libx264}" \
    -preset "${MINELINK_RECORDER_X264_PRESET:-ultrafast}" \
    -tune zerolatency \
    -crf "${MINELINK_RECORDER_CRF:-28}" \
    -threads "${MINELINK_RECORDER_FFMPEG_THREADS:-1}" \
    -pix_fmt yuv420p \
    -r "$recorder_fps" \
    "$client_capture" \
    > "$work_dir/logs/recorder-ffmpeg.log" \
    2>&1 &
  ffmpeg_pid="$!"
  record_resource_snapshot "recorder-after-ffmpeg-start"

  {
    echo "captureStartedAfterWorldReady=true"
    echo "captureStartedAtEpoch=$(date +%s)"
    echo "ffmpegPid=$ffmpeg_pid"
    echo "ffmpeg started after recorder client world-ready"
  } >> "$client_capture_ready"

  sleep "${MINELINK_RECORDER_CAPTURE_STABILIZE_SECONDS:-2}"
}

stop_recorder_client() {
  if ! truthy_value "$record_client"; then
    return 0
  fi
  record_resource_snapshot "recorder-before-stop"
  if [ -n "$ffmpeg_pid" ] && kill -0 "$ffmpeg_pid" >/dev/null 2>&1; then
    kill -INT "$ffmpeg_pid" >/dev/null 2>&1 || true
    wait "$ffmpeg_pid" >/dev/null 2>&1 || true
    ffmpeg_pid=""
  fi
  if [ -n "$client_pid" ] && kill -0 "$client_pid" >/dev/null 2>&1; then
    kill_tree "$client_pid"
    wait "$client_pid" >/dev/null 2>&1 || true
    client_pid=""
  fi
  record_resource_snapshot "recorder-after-stop"
}

if [ "$runtime" = "neoforge" ]; then
  start_timeout="${MINELINK_SERVER_START_TIMEOUT:-240}"
  agent_timeout="${MINELINK_AGENT_TIMEOUT_SECONDS:-300}"
else
  start_timeout="${MINELINK_SERVER_START_TIMEOUT:-25}"
  agent_timeout="${MINELINK_AGENT_TIMEOUT_SECONDS:-120}"
fi
agent_timeout_grace="${MINELINK_AGENT_TIMEOUT_GRACE_SECONDS:-10}"

if [ "$runtime" = "neoforge" ]; then
  quiesce_repo_background_tasks
  kill_repo_neoforge_processes
  kill_port_listeners "$port" "$minecraft_port"
else
  kill_port_listeners "$port"
fi

MINELINK_RUNTIME="$runtime" bash scripts/dev/start-server.sh > "$work_dir/logs/server.stdout.log" 2> "$work_dir/logs/server.stderr.log" &
server_pid="$!"

scripts/dev/wait-for-port.py 127.0.0.1 "$port" "$start_timeout"
if truthy_value "$record_client"; then
  scripts/dev/wait-for-port.py 127.0.0.1 "$minecraft_port" "$start_timeout"
  start_recorder_client
fi

mcp_transport="${MINELINK_MCP_TRANSPORT:-stdio}"
if [ "$mcp_transport" = "http" ] || [ "$mcp_transport" = "streamable-http" ] || [ "$mcp_transport" = "gateway" ]; then
  export MINELINK_MCP_TRANSPORT="$mcp_transport"
  if [ -z "${MINELINK_MCP_URL:-}" ] && [ -z "${MINELINK_MCP_HTTP_URL:-}" ]; then
    gateway_host="${MINELINK_MCP_HOST:-127.0.0.1}"
    gateway_port="${MINELINK_MCP_PORT:-}"
    if [ -z "$gateway_port" ]; then
      case "$port" in
        ''|*[!0-9]*)
          echo "MINELINK_PORT must be numeric when deriving an MCP Gateway port: $port" >&2
          exit 2
          ;;
      esac
      gateway_port=$((port + 10000))
    fi
    kill_port_listeners "$gateway_port"
    export MINELINK_MCP_URL="http://$gateway_host:$gateway_port/mcp"
    export MINELINK_MCP_HTTP_URL="$MINELINK_MCP_URL"
    node packages/host/dist/index.js http --host "$gateway_host" --port "$gateway_port" \
      > "$work_dir/logs/gateway.stdout.log" \
      2> "$work_dir/logs/gateway.stderr.log" &
    gateway_pid="$!"
    scripts/dev/wait-for-port.py "$gateway_host" "$gateway_port" 25
    python3 - "$gateway_host" "$gateway_port" <<'PY'
import json
import sys
from urllib.request import urlopen

host, port = sys.argv[1], sys.argv[2]
with urlopen(f"http://{host}:{port}/healthz", timeout=5) as response:
    payload = json.loads(response.read().decode("utf-8"))
if payload.get("ok") is not True or payload.get("transport") != "streamable-http":
    raise SystemExit(f"unexpected gateway health payload: {payload}")
PY
  elif [ -z "${MINELINK_MCP_URL:-}" ]; then
    export MINELINK_MCP_URL="$MINELINK_MCP_HTTP_URL"
  else
    export MINELINK_MCP_HTTP_URL="$MINELINK_MCP_URL"
  fi
fi

python3 scripts/dev/run-with-timeout.py \
  --timeout "$agent_timeout" \
  --grace "$agent_timeout_grace" \
  --label "MineLink agent scenario '$scenario'" \
  -- scripts/dev/run-agent.sh "$scenario" > "$work_dir/logs/agent.log" 2>&1

python3 - "$report" <<'PY'
import json
import sys
from pathlib import Path

report = Path(sys.argv[1])
payload = json.loads(report.read_text(encoding="utf-8"))
if not payload.get("passed"):
    raise SystemExit(f"scenario failed: {payload}")
print(json.dumps({"scenario": payload.get("scenario"), "passed": True, "report": str(report)}, ensure_ascii=False))
PY

if truthy_value "$record_client"; then
  recorder_post_seconds="${MINELINK_RECORDER_POST_SCENARIO_SECONDS:-12}"
  recorder_min_work_seconds="${MINELINK_RECORDER_MIN_WORK_VISIBLE_SECONDS:-10}"
  recorder_min_visible_mining_ms="${MINELINK_RECORDER_MINING_VISIBLE_MS:-2500}"
  recorder_visual_timeout="${MINELINK_RECORDER_POST_SCENARIO_READY_TIMEOUT:-30}"
  {
    echo "scenarioCompletedAtEpoch=$(date +%s)"
    echo "recorderPostScenarioSeconds=$recorder_post_seconds"
    echo "recorderMinWorkVisibleSeconds=$recorder_min_work_seconds"
    echo "recorderMinVisibleMiningMs=$recorder_min_visible_mining_ms"
    echo "recorderPostScenarioReadyTimeoutSeconds=$recorder_visual_timeout"
  } >> "$client_capture_ready"
  wait_for_any_log_text \
    "MineLink recorder auto-follow active" \
    "$recorder_visual_timeout" \
    "$work_dir/logs/server.stdout.log" \
    "$work_dir/logs/server.stderr.log"
  wait_for_any_log_text \
    "MineLink recorder target moved server_agent" \
    "$recorder_visual_timeout" \
    "$work_dir/logs/server.stdout.log" \
    "$work_dir/logs/server.stderr.log"
  wait_for_any_log_text \
    "MineLink recorder client following server_agent" \
    "$recorder_visual_timeout" \
    "$work_dir/logs/client.stdout.log" \
    "$work_dir/logs/client.stderr.log"
  wait_for_any_log_text \
    "MineLink recorder client target centered server_agent" \
    "$recorder_visual_timeout" \
    "$work_dir/logs/client.stdout.log" \
    "$work_dir/logs/client.stderr.log"
  wait_for_any_log_text \
    "MineLink recorder client target visible server_agent" \
    "$recorder_visual_timeout" \
    "$work_dir/logs/client.stdout.log" \
    "$work_dir/logs/client.stderr.log"
  {
    echo "recorderWorkHoldStartedAtEpoch=$(date +%s)"
    echo "recorderWorkHoldReason=post-scenario-visible-server-agent"
  } >> "$client_capture_ready"
  sleep "$recorder_post_seconds"
  {
    echo "recorderWorkHoldEndedAtEpoch=$(date +%s)"
    echo "recorderWorkHoldCompleted=true"
  } >> "$client_capture_ready"
  stop_recorder_client
  {
    if grep -Fq "MineLink recorder auto-follow active" "$work_dir/logs/server.stdout.log" "$work_dir/logs/server.stderr.log" 2>/dev/null; then
      echo "recorderAutoFollow=true"
      echo "autoFollowLog=MineLink recorder auto-follow active"
    else
      echo "recorderAutoFollow=false"
    fi
    if grep -Fq "MineLink recorder target moved server_agent" "$work_dir/logs/server.stdout.log" "$work_dir/logs/server.stderr.log" 2>/dev/null; then
      echo "recorderTargetMoved=true"
      echo "targetMovedLog=MineLink recorder target moved server_agent"
    else
      echo "recorderTargetMoved=false"
    fi
    if grep -Fq "MineLink recorder client following server_agent" "$work_dir/logs/client.stdout.log" "$work_dir/logs/client.stderr.log" 2>/dev/null; then
      echo "recorderClientFollow=true"
      echo "clientFollowLog=MineLink recorder client following server_agent"
    else
      echo "recorderClientFollow=false"
    fi
    if grep -Fq "MineLink recorder client target centered server_agent" "$work_dir/logs/client.stdout.log" "$work_dir/logs/client.stderr.log" 2>/dev/null; then
      echo "recorderClientTargetCentered=true"
      echo "clientTargetCenteredLog=MineLink recorder client target centered server_agent"
    else
      echo "recorderClientTargetCentered=false"
    fi
    if grep -Fq "MineLink recorder client target visible server_agent" "$work_dir/logs/client.stdout.log" "$work_dir/logs/client.stderr.log" 2>/dev/null; then
      echo "recorderClientTargetVisible=true"
      echo "clientTargetVisibleLog=MineLink recorder client target visible server_agent"
    else
      echo "recorderClientTargetVisible=false"
    fi
  } >> "$client_capture_ready"
  branch_name="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || printf '%s' unknown)"
  node scripts/dev/render-client-capture-video.mjs \
    --client-video "$client_capture" \
    --report "$report" \
    --log-dir "$work_dir/logs" \
    --output-dir "${MINELINK_ACCEPTANCE_VIDEO_OUTPUT_DIR:-.minelink-dev/reports/artifacts}" \
    --task-id "${MINELINK_TASK_ID:-$scenario}" \
    --branch "$branch_name" \
    --producer "${MINELINK_ACCEPTANCE_VIDEO_PRODUCER:-ona-task-finalizer}" \
    --require-mp4
fi
