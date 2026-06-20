#!/usr/bin/env python3
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from minelink_sdk import MineLinkMcpClient, log, write_json


JsonDict = Dict[str, Any]


def main() -> None:
    endpoint = os.environ.get("MINELINK_ENDPOINT", "ws://127.0.0.1:25575")
    report_path = Path(os.environ.get("MINELINK_REPORT", ".minelink-dev/reports/mine_tree-result.json"))
    log_dir = os.environ.get("MINELINK_LOG_DIR", ".minelink-dev/logs")
    trace_path = os.environ.get("MINELINK_TRACE", ".minelink-dev/replays/latest-action-trace.jsonl")
    actions: List[JsonDict] = []

    with MineLinkMcpClient() as client:
        connect = client.connect_server(endpoint=endpoint)
        birth = client.birth("A cautious but curious newcomer.")
        agent_id = birth.get("agent_id")
        log("connected_and_born", endpoint=endpoint, agent_id=agent_id)

        mined = False
        last_scene: JsonDict = {}
        for attempt in range(1, 8):
            scene = client.tool_execute("observe.scene", {"radius": 16, "include": ["visible_blocks", "self"]})
            last_scene = scene
            log_block = nearest_visible_log(scene)
            if log_block is None:
                actions.append({"attempt": attempt, "result": "no_visible_log"})
                break

            distance = float(log_block.get("distance", 999))
            if distance > 4.5:
                move_distance = max(0.5, min(distance - 3.5, 2.0))
                move = client.tool_execute("action.move", {"vector": [move_distance, 0, 0], "durationMs": 500})
                actions.append({"attempt": attempt, "action": "move", "distance": distance, "result": move})
                continue

            look = client.tool_execute("action.look_at", {"block_ref": log_block["block_ref"]})
            mine = client.tool_execute(
                "action.mine_visible_block",
                {"block_ref": log_block["block_ref"], "tool_policy": "best_available"},
            )
            actions.append({"attempt": attempt, "action": "mine", "look": look, "mine": mine})
            if mine.get("ok") is False and mine.get("reason") in {"target_too_far", "must_turn_first"}:
                continue
            if mine.get("status") == "completed" or mine.get("changed_block") or mine.get("drops_spawned", 0) >= 1:
                mined = True
                break

        inventory = client.tool_execute("observe.inventory")
        oak_logs = count_item(inventory, "minecraft:oak_log")
        passed = oak_logs >= 1 and (mined or any(action.get("action") == "mine" for action in actions))

    report: JsonDict = {
        "scenario": "mine_tree",
        "passed": passed,
        "endpoint": endpoint,
        "agent_id": agent_id,
        "oak_logs": oak_logs,
        "final_assertion": {
            "name": "inventory_contains_minecraft_oak_log",
            "passed": oak_logs >= 1,
            "expected_min_count": 1,
            "actual_count": oak_logs,
        },
        "evidence_paths": {
            "server_log": f"{log_dir}/server.log",
            "host_log": f"{log_dir}/host.log",
            "agent_log": f"{log_dir}/agent.log",
            "action_trace": trace_path,
        },
        "actions": actions,
        "last_scene": last_scene,
        "inventory": inventory,
    }
    write_json(report_path, report)
    log("mine_tree_result", passed=passed, report=str(report_path), oak_logs=oak_logs)
    if not passed:
        raise SystemExit(1)


def nearest_visible_log(scene: JsonDict) -> Optional[JsonDict]:
    visible_blocks = scene.get("visible_scene", {}).get("visible_blocks", [])
    logs = [
        block
        for block in visible_blocks
        if block.get("id") == "minecraft:oak_log" or "minecraft:logs" in block.get("tags", [])
    ]
    if not logs:
        return None
    return sorted(logs, key=lambda block: float(block.get("distance", 999)))[0]


def count_item(inventory: JsonDict, item_id: str) -> int:
    total = 0
    for slot in inventory.get("inventory", {}).get("main", []):
        if slot.get("item") == item_id:
            total += int(slot.get("count", 0))
    return total


if __name__ == "__main__":
    main()
