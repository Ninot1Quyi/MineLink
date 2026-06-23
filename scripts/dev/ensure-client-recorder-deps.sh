#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

require_ffmpeg=1
require_xvfb=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --require-ffmpeg)
      require_ffmpeg=1
      shift
      ;;
    --require-xvfb)
      require_xvfb=1
      shift
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: bash scripts/dev/ensure-client-recorder-deps.sh [--require-xvfb]

Ensures the MineLink Minecraft client recorder has the OS tools needed for
headless MP4 capture. It uses apt-get only when a required tool is missing and
root or passwordless sudo is available.
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

report_dir="${MINELINK_RECORDER_DEPS_REPORT_DIR:-.minelink-dev/reports}"
mkdir -p "$report_dir"
report_md="$report_dir/client-recorder-deps.md"
report_json="$report_dir/client-recorder-deps.json"

missing=()
if [[ "$require_ffmpeg" == "1" ]] && ! command -v ffmpeg >/dev/null 2>&1; then
  missing+=("ffmpeg")
fi
if [[ "$require_xvfb" == "1" ]] && ! command -v Xvfb >/dev/null 2>&1; then
  missing+=("Xvfb")
fi
if ! command -v python3 >/dev/null 2>&1; then
  missing+=("python3")
elif ! python3 -c 'import PIL' >/dev/null 2>&1; then
  missing+=("python3-pil")
fi

write_report() {
  local result="$1"
  local detail="$2"
  {
    echo "# MineLink Client Recorder Dependencies"
    echo
    echo "- Result: \`$result\`"
    echo "- Detail: \`$detail\`"
    echo "- Require ffmpeg: \`$require_ffmpeg\`"
    echo "- Require Xvfb: \`$require_xvfb\`"
    echo "- ffmpeg: \`$(command -v ffmpeg 2>/dev/null || printf 'missing')\`"
    echo "- Xvfb: \`$(command -v Xvfb 2>/dev/null || printf 'missing')\`"
    echo "- Pillow: \`$(python3 -c 'import PIL; print("available")' 2>/dev/null || printf 'missing')\`"
  } > "$report_md"
  printf '{\n  "result": "%s",\n  "detail": "%s",\n  "requireFfmpeg": %s,\n  "requireXvfb": %s,\n  "ffmpeg": "%s",\n  "xvfb": "%s",\n  "pillow": "%s"\n}\n' \
    "$result" \
    "${detail//\"/\\\"}" \
    "$([[ "$require_ffmpeg" == "1" ]] && printf true || printf false)" \
    "$([[ "$require_xvfb" == "1" ]] && printf true || printf false)" \
    "$(command -v ffmpeg 2>/dev/null || printf missing)" \
    "$(command -v Xvfb 2>/dev/null || printf missing)" \
    "$(python3 -c 'import PIL; print("available")' 2>/dev/null || printf missing)" \
    > "$report_json"
}

if [[ ${#missing[@]} -eq 0 ]]; then
  write_report "passed" "required recorder dependencies already present"
  exit 0
fi

if ! command -v apt-get >/dev/null 2>&1; then
  write_report "blocked" "missing ${missing[*]} and apt-get is unavailable"
  echo "Missing recorder dependencies (${missing[*]}) and apt-get is unavailable." >&2
  exit 2
fi

sudo_cmd=()
if [[ "$(id -u)" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo_cmd=(sudo -n)
  else
    write_report "blocked" "missing ${missing[*]} and passwordless sudo is unavailable"
    echo "Missing recorder dependencies (${missing[*]}) and passwordless sudo is unavailable." >&2
    exit 2
  fi
fi

export DEBIAN_FRONTEND=noninteractive
"${sudo_cmd[@]}" apt-get update
"${sudo_cmd[@]}" apt-get install -y --no-install-recommends \
  ca-certificates \
  ffmpeg \
  libasound2 \
  libgl1 \
  libgl1-mesa-dri \
  libxcursor1 \
  libxi6 \
  libxinerama1 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  libxxf86vm1 \
  python3 \
  python3-pil \
  xvfb

post_missing=()
if [[ "$require_ffmpeg" == "1" ]] && ! command -v ffmpeg >/dev/null 2>&1; then
  post_missing+=("ffmpeg")
fi
if [[ "$require_xvfb" == "1" ]] && ! command -v Xvfb >/dev/null 2>&1; then
  post_missing+=("Xvfb")
fi
if ! command -v python3 >/dev/null 2>&1; then
  post_missing+=("python3")
elif ! python3 -c 'import PIL' >/dev/null 2>&1; then
  post_missing+=("python3-pil")
fi

if [[ ${#post_missing[@]} -gt 0 ]]; then
  write_report "blocked" "installed packages but still missing ${post_missing[*]}"
  echo "Recorder dependency install finished but still missing: ${post_missing[*]}" >&2
  exit 2
fi

write_report "passed" "installed missing recorder dependencies: ${missing[*]}"
