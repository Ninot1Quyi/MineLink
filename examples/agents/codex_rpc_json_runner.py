#!/usr/bin/env python3
import argparse
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from minelink_sdk import MineLinkMcpClient, log, write_json


JsonDict = Dict[str, Any]


class RpcSource:
    def next_message(self, request: JsonDict) -> JsonDict:
        raise NotImplementedError


class ReplayRpcSource(RpcSource):
    def __init__(self, path: Path) -> None:
        self.path = path
        self.messages = [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        self.index = 0

    def next_message(self, request: JsonDict) -> JsonDict:
        del request
        if self.index >= len(self.messages):
            raise RuntimeError(f"Codex RPC replay is exhausted: {self.path}")
        message = self.messages[self.index]
        self.index += 1
        return message


class CommandRpcSource(RpcSource):
    def __init__(self, command: str, cwd: Path) -> None:
        self.command = command
        self.cwd = cwd

    def next_message(self, request: JsonDict) -> JsonDict:
        completed = subprocess.run(
            shlex.split(self.command),
            cwd=self.cwd,
            input=json.dumps(request) + "\n",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(
                f"Codex RPC command failed with exit {completed.returncode}: {completed.stderr.strip()}"
            )
        return parse_json_stdout(completed.stdout)


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    scenario = args.scenario
    endpoint = os.environ.get("MINELINK_ENDPOINT", "ws://127.0.0.1:25575")
    report_path = Path(os.environ.get("MINELINK_REPORT", f".minelink-dev/reports/{scenario}-result.json"))
    log_dir = os.environ.get("MINELINK_LOG_DIR", ".minelink-dev/logs")
    trace_path = os.environ.get("MINELINK_TRACE", ".minelink-dev/replays/latest-action-trace.jsonl")
    rpc_source = build_rpc_source(args, repo_root, scenario)

    state: JsonDict = {
        "scenario": scenario,
        "objective": scenario_objective(scenario),
        "turn": 0,
        "last_scene": None,
        "last_container": None,
        "last_inventory": None,
        "tool_results": [],
    }
    rpc_messages: List[JsonDict] = []
    final_assertions: List[JsonDict] = []

    with MineLinkMcpClient() as client:
        connect = client.connect_server(endpoint=endpoint)
        birth = client.birth(scenario_objective(scenario))
        agent_id = birth.get("agent_id")
        tools = client.tool_list({"limit": 50})
        log("codex_rpc_session_started", scenario=scenario, endpoint=endpoint, agent_id=agent_id)

        for turn in range(1, args.max_turns + 1):
            state["turn"] = turn
            request = {
                "jsonrpc": "2.0",
                "id": f"minelink-agent-turn-{turn}",
                "method": "minelink/next_tool_calls",
                "params": {
                    "agent_id": agent_id,
                    "scenario": scenario,
                    "objective": state["objective"],
                    "available_tools": tools.get("tools", []),
                    "state": public_state(state),
                },
            }
            rpc_message = rpc_source.next_message(request)
            validate_rpc_message(rpc_message, expected_id=request["id"])
            rpc_messages.append(redact_rpc_message(rpc_message))
            decision = extract_decision(rpc_message)

            for tool_call in decision.get("tool_calls", []):
                name = str(tool_call.get("name", ""))
                arguments = resolve_templates(tool_call.get("arguments", {}) or {}, state)
                mode = str(tool_call.get("mode", "await_completion"))
                result = client.tool_execute(name, arguments, mode)
                record = {"turn": turn, "name": name, "arguments": arguments, "result": result}
                state["tool_results"].append(record)
                update_state_from_tool_result(state, name, result)
                log("codex_rpc_tool_result", turn=turn, name=name, result=compact_result(result))

            if decision.get("done") is True:
                final_assertions = run_assertions(decision.get("final_assertions", []), state)
                break
        else:
            final_assertions = [{"name": "max_turns_not_exceeded", "passed": False, "max_turns": args.max_turns}]

    passed = bool(final_assertions) and all(assertion.get("passed") is True for assertion in final_assertions)
    report: JsonDict = {
        "scenario": scenario,
        "passed": passed,
        "endpoint": endpoint,
        "agent_id": agent_id,
        "rpc_source": rpc_source_name(args, scenario),
        "rpc_contract": {
            "transport": "json-rpc-2.0-envelope",
            "decision_path": "result.mineLinkDecision",
            "real_command_env": "MINELINK_CODEX_RPC_COMMAND",
            "replay_env": "MINELINK_CODEX_RPC_REPLAY",
        },
        "connect": connect,
        "final_assertions": final_assertions,
        "tool_results": state["tool_results"],
        "rpc_messages": rpc_messages,
        "final_inventory": state.get("last_inventory"),
        "evidence_paths": {
            "server_log": f"{log_dir}/server.log",
            "server_stdout_log": f"{log_dir}/server.stdout.log",
            "server_stderr_log": f"{log_dir}/server.stderr.log",
            "host_log": f"{log_dir}/host.log",
            "agent_log": f"{log_dir}/agent.log",
            "action_trace": trace_path,
        },
    }
    write_json(report_path, report)
    log("codex_rpc_result", scenario=scenario, passed=passed, report=str(report_path))
    if not passed:
        raise SystemExit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a MineLink scenario from Codex JSON-RPC tool-call decisions.")
    parser.add_argument("--scenario", default=os.environ.get("MINELINK_SCENARIO", "mine_tree"))
    parser.add_argument("--replay", default=os.environ.get("MINELINK_CODEX_RPC_REPLAY"))
    parser.add_argument("--max-turns", type=int, default=int(os.environ.get("MINELINK_AGENT_MAX_TURNS", "32")))
    return parser.parse_args()


def build_rpc_source(args: argparse.Namespace, repo_root: Path, scenario: str) -> RpcSource:
    command = os.environ.get("MINELINK_CODEX_RPC_COMMAND")
    if command:
        return CommandRpcSource(command, repo_root)
    replay = Path(args.replay) if args.replay else repo_root / "examples" / "codex-rpc" / f"{scenario}.replay.jsonl"
    return ReplayRpcSource(replay)


def rpc_source_name(args: argparse.Namespace, scenario: str) -> str:
    if os.environ.get("MINELINK_CODEX_RPC_COMMAND"):
        return "command"
    return args.replay or f"examples/codex-rpc/{scenario}.replay.jsonl"


def scenario_objective(scenario: str) -> str:
    objectives = {
        "mine_tree": "Use MineLink MCP tools to create a server_agent body, mine one visible oak log, and prove it is in inventory.",
        "create_smoke": "Use MineLink MCP tools to inspect and interact with one reachable Create component.",
        "craft_smoke": "Use MineLink MCP tools to move one oak log from a chest, craft oak planks at a crafting table, and prove the planks are in inventory.",
        "craft_negative": "Use MineLink MCP tools to prove container and crafting failures return structured boundary reasons.",
    }
    return objectives.get(scenario, f"Complete MineLink scenario {scenario}.")


def parse_json_stdout(stdout: str) -> JsonDict:
    candidates = [line for line in stdout.splitlines() if line.strip()]
    if not candidates:
        raise RuntimeError("Codex RPC command produced no stdout JSON")
    for line in reversed(candidates):
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            continue
    raise RuntimeError(f"Codex RPC command did not emit a JSON object: {stdout}")


def validate_rpc_message(message: JsonDict, expected_id: str) -> None:
    if not isinstance(message, dict):
        raise RuntimeError("Codex RPC message must be a JSON object")
    if message.get("jsonrpc") != "2.0":
        raise RuntimeError(f"Unsupported JSON-RPC version: {message.get('jsonrpc')}")
    if message.get("id") != expected_id:
        raise RuntimeError(f"Codex RPC response id mismatch: expected {expected_id}, got {message.get('id')}")
    if "error" in message:
        raise RuntimeError(f"Codex RPC error response: {message['error']}")
    if "result" not in message:
        raise RuntimeError(f"Codex RPC response must contain result: {message}")


def extract_decision(message: JsonDict) -> JsonDict:
    result = message.get("result", {})
    if not isinstance(result, dict):
        raise RuntimeError(f"Codex RPC result must be an object: {message}")
    decision = result.get("mineLinkDecision")
    if isinstance(decision, str):
        decision = json.loads(decision)
    if not isinstance(decision, dict):
        raise RuntimeError(f"Codex RPC result missing mineLinkDecision object: {message}")
    tool_calls = decision.get("tool_calls", [])
    if not isinstance(tool_calls, list):
        raise RuntimeError("mineLinkDecision.tool_calls must be an array")
    return decision


def resolve_templates(value: Any, state: JsonDict) -> Any:
    if isinstance(value, dict):
        return {key: resolve_templates(item, state) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_templates(item, state) for item in value]
    if not isinstance(value, str):
        return value
    if value == "${inventory_empty_slot}":
        return find_inventory_empty_slot(state)
    if value == "${output_slot}":
        return find_output_slot(state)
    if value.startswith("${visible_block:") and value.endswith("}"):
        return find_visible_block_ref(state, value.removeprefix("${visible_block:").removesuffix("}"))
    if value.startswith("${visible_block_tag:") and value.endswith("}"):
        return find_visible_block_ref_by_tag(state, value.removeprefix("${visible_block_tag:").removesuffix("}"))
    if value.startswith("${container_slot:") and value.endswith("}"):
        return find_container_slot_ref(state, value.removeprefix("${container_slot:").removesuffix("}"))
    return value


def find_visible_block_ref(state: JsonDict, block_id: str) -> str:
    for block in visible_blocks(state):
        if block.get("id") == block_id:
            return str(block["block_ref"])
    raise RuntimeError(f"No visible block matches id {block_id}")


def find_visible_block_ref_by_tag(state: JsonDict, tag: str) -> str:
    for block in visible_blocks(state):
        if tag in block.get("tags", []):
            return str(block["block_ref"])
    raise RuntimeError(f"No visible block matches tag {tag}")


def find_container_slot_ref(state: JsonDict, item_id: str) -> str:
    container = current_container(state)
    for slot in container.get("slots", []):
        if slot.get("item") == item_id and int(slot.get("count", 0)) > 0:
            return str(slot["slot_ref"])
    raise RuntimeError(f"No open container slot contains {item_id}")


def find_inventory_empty_slot(state: JsonDict) -> str:
    container = current_container(state)
    for slot in container.get("inventory_slots", []):
        if slot.get("item") is None:
            return str(slot["slot_ref"])
    raise RuntimeError("No empty inventory slot is available in the current container snapshot")


def find_output_slot(state: JsonDict) -> str:
    container = current_container(state)
    output = container.get("output_slot")
    if not output:
        raise RuntimeError("No output slot is available in the current container snapshot")
    return str(output["slot_ref"])


def visible_blocks(state: JsonDict) -> Iterable[JsonDict]:
    scene = state.get("last_scene") or {}
    return scene.get("visible_scene", {}).get("visible_blocks", [])


def current_container(state: JsonDict) -> JsonDict:
    container = state.get("last_container")
    if not isinstance(container, dict):
        raise RuntimeError("No current container snapshot is available")
    return container


def update_state_from_tool_result(state: JsonDict, name: str, result: JsonDict) -> None:
    if name == "observe.scene":
        state["last_scene"] = result
    elif name in {"container.open", "container.observe"}:
        state["last_container"] = result
    elif isinstance(result.get("container"), dict):
        state["last_container"] = result["container"]
    elif name == "observe.inventory":
        state["last_inventory"] = result


def run_assertions(assertions: Any, state: JsonDict) -> List[JsonDict]:
    if not isinstance(assertions, list):
        raise RuntimeError("mineLinkDecision.final_assertions must be an array")
    return [run_assertion(assertion, state) for assertion in assertions]


def run_assertion(assertion: JsonDict, state: JsonDict) -> JsonDict:
    kind = assertion.get("kind")
    if kind == "inventory_contains":
        item = str(assertion.get("item", ""))
        min_count = int(assertion.get("min_count", 1))
        actual = inventory_count(state.get("last_inventory") or {}, item)
        return {
            "name": assertion.get("name", f"inventory_contains_{item}"),
            "kind": kind,
            "passed": actual >= min_count,
            "item": item,
            "expected_min_count": min_count,
            "actual_count": actual,
        }
    if kind == "tool_call_succeeded":
        name = str(assertion.get("tool_name", ""))
        matches = [
            record
            for record in state.get("tool_results", [])
            if record.get("name") == name and not is_tool_failure(record.get("result", {}))
        ]
        return {
            "name": assertion.get("name", f"tool_call_succeeded_{name}"),
            "kind": kind,
            "passed": bool(matches),
            "tool_name": name,
            "matching_calls": len(matches),
        }
    if kind == "tool_call_failed":
        name = str(assertion.get("tool_name", ""))
        expected_reason = assertion.get("reason")
        matches = []
        observed_reasons = []
        for record in state.get("tool_results", []):
            if name and record.get("name") != name:
                continue
            result = record.get("result", {})
            if not is_tool_failure(result):
                continue
            reason = result.get("reason")
            observed_reasons.append(reason)
            if expected_reason is not None and reason != expected_reason:
                continue
            matches.append(record)
        return {
            "name": assertion.get("name", f"tool_call_failed_{name}_{expected_reason}"),
            "kind": kind,
            "passed": bool(matches),
            "tool_name": name,
            "expected_reason": expected_reason,
            "matching_calls": len(matches),
            "observed_reasons": observed_reasons,
        }
    if kind == "recipe_available":
        recipe_id = str(assertion.get("recipe_id", ""))
        expected_craftable = assertion.get("craftable")
        matches = []
        for record in state.get("tool_results", []):
            if record.get("name") != "craft.list_available":
                continue
            result = record.get("result", {})
            if not isinstance(result, dict):
                continue
            for recipe in result.get("recipes", []):
                if recipe.get("recipe_id") != recipe_id:
                    continue
                if expected_craftable is not None and recipe.get("craftable") != expected_craftable:
                    continue
                matches.append(recipe)
        return {
            "name": assertion.get("name", f"recipe_available_{recipe_id}"),
            "kind": kind,
            "passed": bool(matches),
            "recipe_id": recipe_id,
            "expected_craftable": expected_craftable,
            "matching_recipes": len(matches),
        }
    return {"name": assertion.get("name", "unknown_assertion"), "kind": kind, "passed": False}


def inventory_count(inventory: JsonDict, item_id: str) -> int:
    slots = inventory.get("inventory", {}).get("main", [])
    return sum(int(slot.get("count", 0)) for slot in slots if slot.get("item") == item_id)


def is_tool_failure(result: Any) -> bool:
    return isinstance(result, dict) and result.get("ok") is False


def public_state(state: JsonDict) -> JsonDict:
    return {
        "last_scene": state.get("last_scene"),
        "last_container": state.get("last_container"),
        "last_inventory": state.get("last_inventory"),
        "tool_results": state.get("tool_results", [])[-5:],
    }


def compact_result(result: Any) -> Any:
    if not isinstance(result, dict):
        return result
    keys = ["ok", "status", "reason", "message", "id", "kind", "used", "moved", "taken", "recipe_id", "output"]
    compact = {key: result[key] for key in keys if key in result}
    if compact:
        return compact
    return {key: result[key] for key in list(result.keys())[:6]}


def redact_rpc_message(message: JsonDict) -> JsonDict:
    return message


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stderr.write(f"codex_rpc_json_runner failed: {exc}\n")
        raise
