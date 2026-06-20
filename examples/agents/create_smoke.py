#!/usr/bin/env python3
import os
from pathlib import Path
from typing import Any, Dict, Optional

from minelink_sdk import MineLinkMcpClient, log, write_json


JsonDict = Dict[str, Any]


def main() -> None:
    endpoint = os.environ.get("MINELINK_ENDPOINT", "ws://127.0.0.1:25575")
    report_path = Path(os.environ.get("MINELINK_REPORT", ".minelink-dev/reports/create_smoke-result.json"))
    log_dir = os.environ.get("MINELINK_LOG_DIR", ".minelink-dev/logs")
    trace_path = os.environ.get("MINELINK_TRACE", ".minelink-dev/replays/latest-action-trace.jsonl")

    with MineLinkMcpClient() as client:
        client.connect_server(endpoint=endpoint)
        birth = client.birth("A newcomer interested in mechanical structures.")
        scene = client.tool_execute("observe.scene", {"radius": 16, "include": ["visible_blocks", "self"]})
        component = first_create_component(scene)
        if component is None:
            report = {"scenario": "create_smoke", "passed": False, "reason": "no_visible_create_component", "scene": scene}
            write_json(report_path, report)
            raise SystemExit(1)

        inspect = client.tool_execute("create.inspect_component", {"block_ref": component["block_ref"]})
        use = client.tool_execute("action.use", {"target_ref": component["block_ref"]})

    passed = ("create" in inspect or inspect.get("ok") is True) and (use.get("used") is True or use.get("ok") is True)
    report = {
        "scenario": "create_smoke",
        "passed": passed,
        "agent_id": birth.get("agent_id"),
        "component": component,
        "inspect": inspect,
        "use": use,
        "evidence_paths": {
            "server_log": f"{log_dir}/server.log",
            "host_log": f"{log_dir}/host.log",
            "agent_log": f"{log_dir}/agent.log",
            "action_trace": trace_path,
        },
    }
    write_json(report_path, report)
    log("create_smoke_result", passed=passed, report=str(report_path), component=component.get("id"))
    if not passed:
        raise SystemExit(1)


def first_create_component(scene: JsonDict) -> Optional[JsonDict]:
    for block in scene.get("visible_scene", {}).get("visible_blocks", []):
        if "create:component" in block.get("tags", []) or str(block.get("id", "")).startswith("create:"):
            return block
    return None


if __name__ == "__main__":
    main()
