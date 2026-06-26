#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

image_ref="${MINELINK_PREWARMED_IMAGE:-}"
require_anonymous=0
require_authenticated=0
docker_smoke=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --require-anonymous)
      require_anonymous=1
      shift
      ;;
    --require-authenticated)
      require_authenticated=1
      shift
      ;;
    --docker-smoke)
      docker_smoke=1
      shift
      ;;
    --help)
      cat <<'EOF'
Usage: bash scripts/dev/check-devcontainer-image-access.sh [image] [options]

Options:
  --require-anonymous       Fail unless GHCR anonymous pull access works.
  --require-authenticated   Fail unless GHCR authenticated pull access works.
  --docker-smoke            Pull and run the image with Docker, then verify core tools and cache paths.

If image is omitted, MINELINK_PREWARMED_IMAGE is used. If that is also unset,
the script checks ghcr.io/ninot1quyi/minelink-devcontainer:sha-<current-short-sha>.
EOF
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
    *)
      if [[ -n "$image_ref" ]]; then
        echo "Image was provided more than once: $1" >&2
        exit 2
      fi
      image_ref="$1"
      shift
      ;;
  esac
done

if [[ -z "$image_ref" ]]; then
  image_ref="ghcr.io/ninot1quyi/minelink-devcontainer:sha-$(git rev-parse --short HEAD)"
fi

if [[ "$image_ref" != ghcr.io/* ]]; then
  echo "Only ghcr.io images are supported by this checker: $image_ref" >&2
  exit 2
fi

summary_dir=".minelink-dev/reports"
summary_path="$summary_dir/devcontainer-image-access.md"
mkdir -p "$summary_dir"

without_registry="${image_ref#ghcr.io/}"
repository="${without_registry%%[:@]*}"
suffix="${without_registry#"$repository"}"
reference="latest"
if [[ "$suffix" == :* ]]; then
  reference="${suffix#:}"
elif [[ "$suffix" == @* ]]; then
  reference="${suffix#@}"
fi

token_url="https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull"
manifest_url="https://ghcr.io/v2/${repository}/manifests/${reference}"
accept_header="application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

http_get() {
  local output="$1"
  shift
  curl -sS -L -w '%{http_code}' -o "$output" "$@" || true
}

extract_token() {
  local input="$1"
  node -e '
    const fs = require("node:fs");
    try {
      const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (typeof parsed.token === "string" && parsed.token.length > 0) {
        process.stdout.write(parsed.token);
      } else {
        process.exit(1);
      }
    } catch {
      process.exit(1);
    }
  ' "$input"
}

check_manifest_with_registry_token() {
  local token="$1"
  local body="$2"
  http_get "$body" \
    -H "Authorization: Bearer ${token}" \
    -H "Accept: ${accept_header}" \
    "$manifest_url"
}

anonymous_token_body="$tmp_dir/anonymous-token.json"
anonymous_manifest_body="$tmp_dir/anonymous-manifest.json"
anonymous_token_code="$(http_get "$anonymous_token_body" "$token_url")"
anonymous_manifest_code="not_attempted"
anonymous_ok=0

if [[ "$anonymous_token_code" == "200" ]] && anonymous_token="$(extract_token "$anonymous_token_body")"; then
  anonymous_manifest_code="$(check_manifest_with_registry_token "$anonymous_token" "$anonymous_manifest_body")"
  if [[ "$anonymous_manifest_code" == "200" ]]; then
    anonymous_ok=1
  fi
fi

github_token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
github_actor="${GITHUB_ACTOR:-}"
if [[ -z "$github_actor" ]] && command -v gh >/dev/null 2>&1; then
  github_actor="$(gh api /user --jq '.login' 2>/dev/null || true)"
fi

authenticated_token_code="not_attempted"
authenticated_manifest_code="not_attempted"
authenticated_ok=0

if [[ -n "$github_token" && -n "$github_actor" ]]; then
  authenticated_token_body="$tmp_dir/authenticated-token.json"
  authenticated_manifest_body="$tmp_dir/authenticated-manifest.json"
  authenticated_token_code="$(http_get "$authenticated_token_body" -u "${github_actor}:${github_token}" "$token_url")"
  if [[ "$authenticated_token_code" == "200" ]] && authenticated_token="$(extract_token "$authenticated_token_body")"; then
    authenticated_manifest_code="$(check_manifest_with_registry_token "$authenticated_token" "$authenticated_manifest_body")"
    if [[ "$authenticated_manifest_code" == "200" ]]; then
      authenticated_ok=1
    fi
  fi
fi

docker_smoke_result="not_requested"
if [[ "$docker_smoke" -eq 1 ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    docker_smoke_result="failed_docker_missing"
  elif docker pull "$image_ref" >/dev/null; then
    if docker run --rm "$image_ref" bash -lc '
      set -euo pipefail
      node --version
      npm --version
      python3 --version
      python3 -c "import PIL"
      java -version
      ffmpeg -version >/dev/null
      command -v Xvfb
      test -d "$HOME/.npm"
      test -d "${GRADLE_USER_HOME:-$HOME/.gradle}/caches/modules-2"
    ' >/dev/null; then
      docker_smoke_result="passed"
    else
      docker_smoke_result="failed_runtime_check"
    fi
  else
    docker_smoke_result="failed_pull"
  fi
fi

{
  echo "# MineLink Devcontainer Image Access"
  echo
  echo "- image: \`$image_ref\`"
  echo "- repository: \`$repository\`"
  echo "- reference: \`$reference\`"
  echo "- anonymous token HTTP: \`$anonymous_token_code\`"
  echo "- anonymous manifest HTTP: \`$anonymous_manifest_code\`"
  echo "- anonymous pull access: \`$([[ "$anonymous_ok" -eq 1 ]] && echo yes || echo no)\`"
  echo "- authenticated token HTTP: \`$authenticated_token_code\`"
  echo "- authenticated manifest HTTP: \`$authenticated_manifest_code\`"
  echo "- authenticated pull access: \`$([[ "$authenticated_ok" -eq 1 ]] && echo yes || echo no)\`"
  echo "- docker smoke: \`$docker_smoke_result\`"
  echo
  echo "## Boundary"
  echo
  echo "This proves registry access and, when Docker smoke is enabled, that the image starts with the expected tools and cache paths. It does not prove Ona Platform Codex task execution, Minecraft server startup, or product packaging acceptance."
} > "$summary_path"

failures=()
if [[ "$require_anonymous" -eq 1 && "$anonymous_ok" -ne 1 ]]; then
  failures+=("anonymous GHCR pull access is required but did not succeed")
fi
if [[ "$require_authenticated" -eq 1 && "$authenticated_ok" -ne 1 ]]; then
  failures+=("authenticated GHCR pull access is required but did not succeed")
fi
if [[ "$require_anonymous" -eq 0 && "$require_authenticated" -eq 0 && "$anonymous_ok" -ne 1 && "$authenticated_ok" -ne 1 ]]; then
  failures+=("neither anonymous nor authenticated GHCR pull access succeeded")
fi
if [[ "$docker_smoke" -eq 1 && "$docker_smoke_result" != "passed" ]]; then
  failures+=("Docker smoke was requested but result was $docker_smoke_result")
fi

if [[ ${#failures[@]} -gt 0 ]]; then
  {
    echo
    echo "## Result"
    for failure in "${failures[@]}"; do
      echo "- failed: $failure"
    done
  } >> "$summary_path"
  cat "$summary_path" >&2
  exit 1
fi

{
  echo
  echo "## Result"
  echo "- passed"
} >> "$summary_path"

echo "Devcontainer image access check passed; wrote $summary_path"
