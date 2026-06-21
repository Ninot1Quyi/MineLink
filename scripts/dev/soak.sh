#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

runtime="mock"
iterations="2"
scenarios="mine_tree,craft_negative,guard_boundaries"
work_dir=""

usage() {
  cat <<'EOF'
Usage: scripts/dev/soak.sh [--runtime mock|neoforge] [--iterations N] [--scenarios a,b] [--work-dir PATH]

Runs repeat MineLink e2e scenarios and writes stability evidence:
  - soak-report.json
  - process-cleanup.json
  - queue-metrics.json
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --runtime)
      runtime="${2:-}"
      shift 2
      ;;
    --iterations)
      iterations="${2:-}"
      shift 2
      ;;
    --scenarios)
      scenarios="${2:-}"
      shift 2
      ;;
    --work-dir)
      work_dir="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown soak argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$runtime" in
  mock|neoforge) ;;
  *)
    echo "Unsupported soak runtime: $runtime" >&2
    exit 2
    ;;
esac

case "$iterations" in
  ''|*[!0-9]*)
    echo "--iterations must be a positive integer" >&2
    exit 2
    ;;
esac
if [ "$iterations" -lt 1 ]; then
  echo "--iterations must be >= 1" >&2
  exit 2
fi

if [ -z "$work_dir" ]; then
  work_dir=".minelink-dev/soak/$runtime"
fi

IFS=',' read -r -a scenario_list <<< "$scenarios"
if [ "${#scenario_list[@]}" -eq 0 ]; then
  echo "--scenarios must include at least one scenario" >&2
  exit 2
fi

for scenario in "${scenario_list[@]}"; do
  case "$scenario" in
    mine_tree|create_smoke|craft_smoke|furnace_smoke|craft_negative|guard_boundaries|body_lifecycle|perception_shapes|portal_coop) ;;
    *)
      echo "Unsupported soak scenario: $scenario" >&2
      exit 2
      ;;
  esac
done

rm -rf "$work_dir"
mkdir -p "$work_dir/runs"

if [ "${MINELINK_SKIP_BUILD:-0}" != "1" ]; then
  scripts/dev/build.sh
fi

runs_jsonl="$work_dir/runs.jsonl"
: > "$runs_jsonl"

ports_for_scenario() {
  scenario="$1"
  case "$scenario" in
    mine_tree) endpoint_port=25575 ;;
    create_smoke) endpoint_port=25576 ;;
    craft_smoke) endpoint_port=25577 ;;
    furnace_smoke) endpoint_port=25582 ;;
    craft_negative) endpoint_port=25578 ;;
    guard_boundaries) endpoint_port=25580 ;;
    body_lifecycle) endpoint_port=25583 ;;
    perception_shapes) endpoint_port=25581 ;;
    portal_coop) endpoint_port=25579 ;;
    *) endpoint_port=25575 ;;
  esac
  if [ "$runtime" = "neoforge" ]; then
    printf '%s,%s' "$endpoint_port" "$((endpoint_port + 1000))"
  else
    printf '%s' "$endpoint_port"
  fi
}

status=0
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

for iteration in $(seq 1 "$iterations"); do
  for scenario in "${scenario_list[@]}"; do
    run_dir="$work_dir/runs/iteration-$(printf '%02d' "$iteration")/$scenario"
    mkdir -p "$run_dir"
    start_epoch="$(python3 - <<'PY'
import time
print(time.time())
PY
)"
    set +e
    MINELINK_RUNTIME="$runtime" \
      MINELINK_WORK_DIR="$run_dir" \
      MINELINK_SKIP_BUILD=1 \
      bash scripts/dev/e2e.sh "$scenario"
    exit_code="$?"
    set -e
    end_epoch="$(python3 - <<'PY'
import time
print(time.time())
PY
)"
    if [ "$exit_code" -ne 0 ]; then
      status="$exit_code"
    fi

    python3 - "$runs_jsonl" "$runtime" "$scenario" "$iteration" "$run_dir" "$exit_code" "$start_epoch" "$end_epoch" "$(ports_for_scenario "$scenario")" <<'PY'
import json
import socket
import sys
from pathlib import Path

runs_jsonl, runtime, scenario, iteration, run_dir, exit_code, start_epoch, end_epoch, ports_csv = sys.argv[1:]
ports = [int(port) for port in ports_csv.split(",") if port]

def is_open(port: int) -> bool:
    sock = socket.socket()
    sock.settimeout(0.25)
    try:
        sock.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        sock.close()

run_path = Path(run_dir)
reports = sorted((run_path / "reports").glob("*-result.json"))
report_payload = None
if reports:
    try:
        report_payload = json.loads(reports[0].read_text(encoding="utf-8"))
    except Exception as error:
        report_payload = {"passed": False, "parse_error": str(error)}

def file_size(path: Path) -> int:
    return path.stat().st_size if path.is_file() else 0

record = {
    "runtime": runtime,
    "scenario": scenario,
    "iteration": int(iteration),
    "run_dir": str(run_path),
    "exit_code": int(exit_code),
    "duration_ms": int((float(end_epoch) - float(start_epoch)) * 1000),
    "report_path": str(reports[0]) if reports else None,
    "passed": bool(report_payload and report_payload.get("passed") is True and int(exit_code) == 0),
    "final_assertion_count": len(report_payload.get("final_assertions", [])) if isinstance(report_payload, dict) else 0,
    "tool_result_count": len(report_payload.get("tool_results", [])) if isinstance(report_payload, dict) else 0,
    "failure_reasons": [
        item.get("result", {}).get("reason")
        for item in (report_payload.get("tool_results", []) if isinstance(report_payload, dict) else [])
        if isinstance(item.get("result"), dict) and item.get("result", {}).get("ok") is False
    ],
    "artifact_sizes": {
        "agent_log_bytes": file_size(run_path / "logs" / "agent.log"),
        "server_stdout_bytes": file_size(run_path / "logs" / "server.stdout.log"),
        "server_stderr_bytes": file_size(run_path / "logs" / "server.stderr.log"),
        "trace_bytes": file_size(run_path / "replays" / "latest-action-trace.jsonl"),
    },
    "post_run_ports": [{"port": port, "open": is_open(port)} for port in ports],
}

with Path(runs_jsonl).open("a", encoding="utf-8") as output:
    output.write(json.dumps(record, sort_keys=True) + "\n")
PY
  done
done

completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

python3 - "$work_dir" "$runtime" "$iterations" "$scenarios" "$started_at" "$completed_at" <<'PY'
import json
import sys
from collections import Counter
from pathlib import Path

work_dir, runtime, iterations, scenarios, started_at, completed_at = sys.argv[1:]
root = Path(work_dir)
records = [
    json.loads(line)
    for line in (root / "runs.jsonl").read_text(encoding="utf-8").splitlines()
    if line.strip()
]
all_passed = bool(records) and all(record["passed"] for record in records)
all_ports_closed = all(
    not port_status["open"]
    for record in records
    for port_status in record["post_run_ports"]
)
failure_reasons = Counter(
    reason
    for record in records
    for reason in record["failure_reasons"]
    if reason
)

soak_report = {
    "schema_version": 1,
    "runtime": runtime,
    "scenarios": [item for item in scenarios.split(",") if item],
    "iterations": int(iterations),
    "started_at": started_at,
    "completed_at": completed_at,
    "passed": all_passed and all_ports_closed,
    "run_count": len(records),
    "runs": records,
}
process_cleanup = {
    "schema_version": 1,
    "runtime": runtime,
    "passed": all_ports_closed,
    "checks": [
        {
            "scenario": record["scenario"],
            "iteration": record["iteration"],
            "run_dir": record["run_dir"],
            "ports": record["post_run_ports"],
        }
        for record in records
    ],
}
queue_metrics = {
    "schema_version": 1,
    "runtime": runtime,
    "passed": all_passed,
    "run_count": len(records),
    "total_tool_results": sum(record["tool_result_count"] for record in records),
    "failure_reasons": dict(sorted(failure_reasons.items())),
    "max_trace_bytes": max((record["artifact_sizes"]["trace_bytes"] for record in records), default=0),
    "max_agent_log_bytes": max((record["artifact_sizes"]["agent_log_bytes"] for record in records), default=0),
}

(root / "soak-report.json").write_text(json.dumps(soak_report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
(root / "process-cleanup.json").write_text(json.dumps(process_cleanup, indent=2, sort_keys=True) + "\n", encoding="utf-8")
(root / "queue-metrics.json").write_text(json.dumps(queue_metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8")

if not soak_report["passed"]:
    raise SystemExit(f"soak failed: all_passed={all_passed} all_ports_closed={all_ports_closed}")
PY

exit "$status"
