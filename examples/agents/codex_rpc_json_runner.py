#!/usr/bin/env python3
import argparse
import json
import os
import shlex
import subprocess
import sys
import time
from contextlib import ExitStack
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

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

    if scenario == "portal_coop":
        run_portal_coop(args, scenario, endpoint, report_path, log_dir, trace_path, rpc_source)
        return

    state: JsonDict = {
        "scenario": scenario,
        "objective": scenario_objective(scenario),
        "turn": 0,
        "last_scene": None,
        "last_container": None,
        "last_inventory": None,
        "last_events": None,
        "placements": {},
        "tool_results": [],
    }
    rpc_messages: List[JsonDict] = []
    final_assertions: List[JsonDict] = []

    with MineLinkMcpClient() as client:
        connect = client.connect_server(endpoint=endpoint)
        birth = client.birth(scenario_objective(scenario))
        agent_id = birth.get("agent_id")
        if connect.get("ok") is False or not agent_id:
            raise RuntimeError(f"MineLink session setup failed: connect={connect}, birth={birth}")
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
                update_shared_state_from_tool_result(state, name, result)
                log("codex_rpc_tool_result", turn=turn, name=name, result=compact_result(result))

            wait_ms = int(decision.get("wait_ms", 0) or 0)
            if wait_ms > 0:
                time.sleep(min(wait_ms, 30_000) / 1000)

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
        "placements": state["placements"],
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
        "create_smoke": "Use MineLink MCP tools to take Create materials from a chest, place one Create component, use a wrench, and press an iron ingot into an iron sheet through a powered Create depot and mechanical press.",
        "craft_smoke": "Use MineLink MCP tools to move one oak log from a chest, craft oak planks at a crafting table, and prove the planks are in inventory.",
        "craft_negative": "Use MineLink MCP tools to prove container and crafting failures return structured boundary reasons.",
        "guard_boundaries": "Use MineLink MCP tools to prove server_agent guard checks reject unobserved, expired, too-far, hidden, missing-material, and sleep-limited actions.",
        "portal_coop": "Use three MineLink server_agent bodies and only public MCP tools to exchange a local social event, withdraw shared materials, place an obsidian Nether portal frame, ignite it, and prove portal blocks exist.",
    }
    return objectives.get(scenario, f"Complete MineLink scenario {scenario}.")


def run_portal_coop(
    args: argparse.Namespace,
    scenario: str,
    endpoint: str,
    report_path: Path,
    log_dir: str,
    trace_path: str,
    rpc_source: RpcSource,
) -> None:
    agent_names = ["builder_a", "builder_b", "builder_c"]
    state: JsonDict = {
        "scenario": scenario,
        "objective": scenario_objective(scenario),
        "turn": 0,
        "agents": {
            name: {
                "name": name,
                "last_scene": None,
                "last_container": None,
                "last_inventory": None,
                "last_events": None,
                "tool_results": [],
            }
            for name in agent_names
        },
        "placements": {},
        "tool_results": [],
    }
    rpc_messages: List[JsonDict] = []
    final_assertions: List[JsonDict] = []
    connect_results: JsonDict = {}
    birth_results: JsonDict = {}
    clients: Dict[str, MineLinkMcpClient] = {}
    tools: JsonDict = {}

    with ExitStack() as stack:
        for name in agent_names:
            client = stack.enter_context(MineLinkMcpClient())
            clients[name] = client
            connect_results[name] = client.connect_server(endpoint=endpoint, owner_name=f"codex_{name}")
            birth_results[name] = client.birth(f"{scenario}:{name}: {scenario_objective(scenario)}")
            state["agents"][name]["agent_id"] = birth_results[name].get("agent_id")
            state["agents"][name]["display_name"] = birth_results[name].get("display_name")
            if connect_results[name].get("ok") is False or not state["agents"][name]["agent_id"]:
                raise RuntimeError(
                    f"MineLink team session setup failed for {name}: "
                    f"connect={connect_results[name]}, birth={birth_results[name]}"
                )
            if not tools:
                tools = client.tool_list({"limit": 50})

        log(
            "codex_rpc_team_session_started",
            scenario=scenario,
            endpoint=endpoint,
            agents={name: state["agents"][name].get("agent_id") for name in agent_names},
        )

        for turn in range(1, args.max_turns + 1):
            state["turn"] = turn
            request = {
                "jsonrpc": "2.0",
                "id": f"minelink-agent-team-turn-{turn}",
                "method": "minelink/next_tool_calls",
                "params": {
                    "scenario": scenario,
                    "objective": state["objective"],
                    "available_tools": tools.get("tools", []),
                    "agents": {
                        name: {
                            "agent_id": state["agents"][name].get("agent_id"),
                            "display_name": state["agents"][name].get("display_name"),
                            "state": public_state(state["agents"][name]),
                        }
                        for name in agent_names
                    },
                    "shared_state": {
                        "placements": state["placements"],
                        "recent_tool_results": state["tool_results"][-8:],
                    },
                },
            }
            rpc_message = rpc_source.next_message(request)
            validate_rpc_message(rpc_message, expected_id=request["id"])
            rpc_messages.append(redact_rpc_message(rpc_message))
            decision = extract_decision(rpc_message)
            agent_name = str(decision.get("agent", ""))
            if agent_name not in clients:
                raise RuntimeError(f"portal_coop decision must name one of {agent_names}, got {agent_name!r}")
            agent_state = state["agents"][agent_name]
            client = clients[agent_name]

            for tool_call in decision.get("tool_calls", []):
                name = str(tool_call.get("name", ""))
                arguments = resolve_templates(tool_call.get("arguments", {}) or {}, agent_state, state)
                mode = str(tool_call.get("mode", "await_completion"))
                result = client.tool_execute(name, arguments, mode)
                record = {
                    "turn": turn,
                    "agent": agent_name,
                    "name": name,
                    "arguments": arguments,
                    "result": result,
                }
                agent_state["tool_results"].append(record)
                state["tool_results"].append(record)
                update_state_from_tool_result(agent_state, name, result)
                update_shared_state_from_tool_result(state, name, result)
                log(
                    "codex_rpc_team_tool_result",
                    turn=turn,
                    agent=agent_name,
                    name=name,
                    result=compact_result(result),
                )

            wait_ms = int(decision.get("wait_ms", 0) or 0)
            if wait_ms > 0:
                time.sleep(min(wait_ms, 30_000) / 1000)

            if decision.get("done") is True:
                final_assertions = run_assertions(decision.get("final_assertions", []), agent_state, state)
                break
        else:
            final_assertions = [{"name": "max_turns_not_exceeded", "passed": False, "max_turns": args.max_turns}]

    passed = bool(final_assertions) and all(assertion.get("passed") is True for assertion in final_assertions)
    report: JsonDict = {
        "scenario": scenario,
        "passed": passed,
        "endpoint": endpoint,
        "agents": {
            name: {
                "agent_id": state["agents"][name].get("agent_id"),
                "display_name": state["agents"][name].get("display_name"),
            }
            for name in agent_names
        },
        "rpc_source": rpc_source_name(args, scenario),
        "rpc_contract": {
            "transport": "json-rpc-2.0-envelope",
            "decision_path": "result.mineLinkDecision",
            "decision_agent_field": "result.mineLinkDecision.agent",
            "real_command_env": "MINELINK_CODEX_RPC_COMMAND",
            "replay_env": "MINELINK_CODEX_RPC_REPLAY",
        },
        "connect": connect_results,
        "birth": birth_results,
        "placements": state["placements"],
        "final_assertions": final_assertions,
        "tool_results": state["tool_results"],
        "rpc_messages": rpc_messages,
        "final_inventory": {
            name: state["agents"][name].get("last_inventory")
            for name in agent_names
        },
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
    log("codex_rpc_team_result", scenario=scenario, passed=passed, report=str(report_path))
    if not passed:
        raise SystemExit(1)


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


def resolve_templates(value: Any, state: JsonDict, global_state: Optional[JsonDict] = None) -> Any:
    if isinstance(value, dict):
        return {key: resolve_templates(item, state, global_state) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_templates(item, state, global_state) for item in value]
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
    if value.startswith("${placed_block:") and value.endswith("}"):
        return find_placed_block_ref(state, global_state, value.removeprefix("${placed_block:").removesuffix("}"))
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


def find_placed_block_ref(state: JsonDict, global_state: Optional[JsonDict], label: str) -> str:
    placement_source = global_state if global_state is not None else state
    placement = (placement_source.get("placements") or {}).get(label)
    if not isinstance(placement, dict):
        raise RuntimeError(f"No placement label has been recorded: {label}")
    expected_pos = normalize_pos(placement.get("pos"))
    if expected_pos is None:
        raise RuntimeError(f"Placement label {label} has no usable position")
    for block in visible_blocks(state):
        if normalize_pos(block.get("position")) == expected_pos or normalize_pos(block.get("pos_hint")) == expected_pos:
            return str(block["block_ref"])
    raise RuntimeError(f"No visible block ref matches placement label {label} at {expected_pos}")


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
    elif name == "observe.events":
        state["last_events"] = result


def update_shared_state_from_tool_result(global_state: JsonDict, name: str, result: JsonDict) -> None:
    if name != "block.place" or not isinstance(result, dict):
        return
    placed = result.get("placed")
    if not isinstance(placed, dict):
        return
    label = placed.get("placement_label")
    if not isinstance(label, str) or not label:
        return
    pos = normalize_pos(placed.get("pos") or placed.get("position"))
    if pos is None:
        return
    placements = global_state.setdefault("placements", {})
    placements[label] = {
        "item": placed.get("item"),
        "id": placed.get("id"),
        "pos": list(pos),
    }


def run_assertions(assertions: Any, state: JsonDict, global_state: Optional[JsonDict] = None) -> List[JsonDict]:
    if not isinstance(assertions, list):
        raise RuntimeError("mineLinkDecision.final_assertions must be an array")
    return [run_assertion(assertion, state, global_state) for assertion in assertions]


def run_assertion(assertion: JsonDict, state: JsonDict, global_state: Optional[JsonDict] = None) -> JsonDict:
    kind = assertion.get("kind")
    if kind == "inventory_contains":
        item = str(assertion.get("item", ""))
        min_count = int(assertion.get("min_count", 1))
        assertion_state = assertion_agent_state(assertion, state, global_state)
        actual = inventory_count(assertion_state.get("last_inventory") or {}, item)
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
        min_count = int(assertion.get("min_count", 1))
        matches = [
            record
            for record in tool_records(state, global_state)
            if record.get("name") == name and not is_tool_failure(record.get("result", {}))
        ]
        return {
            "name": assertion.get("name", f"tool_call_succeeded_{name}"),
            "kind": kind,
            "passed": len(matches) >= min_count,
            "tool_name": name,
            "expected_min_count": min_count,
            "matching_calls": len(matches),
        }
    if kind == "tool_call_failed":
        name = str(assertion.get("tool_name", ""))
        expected_reason = assertion.get("reason")
        matches = []
        observed_reasons = []
        for record in tool_records(state, global_state):
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
    if kind == "agent_count":
        expected = int(assertion.get("count", 0))
        actual = len((global_state or {}).get("agents", {}))
        return {
            "name": assertion.get("name", f"agent_count_{expected}"),
            "kind": kind,
            "passed": actual == expected,
            "expected": expected,
            "actual": actual,
        }
    if kind == "visible_block_exists":
        item = str(assertion.get("id", ""))
        min_count = int(assertion.get("min_count", 1))
        assertion_state = assertion_agent_state(assertion, state, global_state)
        count = sum(1 for block in visible_blocks(assertion_state) if block.get("id") == item)
        return {
            "name": assertion.get("name", f"visible_block_exists_{item}"),
            "kind": kind,
            "passed": count >= min_count,
            "id": item,
            "expected_min_count": min_count,
            "actual_count": count,
            "agent": assertion.get("agent"),
        }
    if kind == "visible_block_absent":
        item = str(assertion.get("id", ""))
        assertion_state = assertion_agent_state(assertion, state, global_state)
        count = sum(1 for block in visible_blocks(assertion_state) if block.get("id") == item)
        return {
            "name": assertion.get("name", f"visible_block_absent_{item}"),
            "kind": kind,
            "passed": count == 0,
            "id": item,
            "actual_count": count,
            "agent": assertion.get("agent"),
        }
    if kind == "recipe_available":
        recipe_id = str(assertion.get("recipe_id", ""))
        expected_craftable = assertion.get("craftable")
        matches = []
        for record in tool_records(state, global_state):
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
    if kind == "event_message_seen":
        assertion_state = assertion_agent_state(assertion, state, global_state)
        message_contains = str(assertion.get("message_contains", ""))
        source_agent = assertion.get("source_agent")
        source_agent_id = None
        if source_agent and global_state:
            agent_info = (global_state.get("agents") or {}).get(source_agent, {})
            if isinstance(agent_info, dict):
                source_agent_id = agent_info.get("agent_id")
        events_payload = assertion_state.get("last_events") or {}
        events = events_payload.get("events", []) if isinstance(events_payload, dict) else []
        matches = [
            event
            for event in events
            if isinstance(event, dict)
            and (not message_contains or message_contains in str(event.get("message", "")))
            and (source_agent_id is None or event.get("source_agent_id") == source_agent_id)
        ]
        return {
            "name": assertion.get("name", "event_message_seen"),
            "kind": kind,
            "passed": bool(matches),
            "agent": assertion.get("agent"),
            "source_agent": source_agent,
            "message_contains": message_contains,
            "matching_events": len(matches),
            "observed_messages": [event.get("message") for event in events if isinstance(event, dict)],
        }
    if kind == "create_component_semantics":
        expected_kinds = [str(item) for item in assertion.get("kinds", [])]
        require_client_limits = bool(assertion.get("require_unsupported_client_capabilities", True))
        observed: Dict[str, JsonDict] = {}
        missing_fields: Dict[str, List[str]] = {}
        for record in tool_records(state, global_state):
            if record.get("name") != "create.inspect_component" or is_tool_failure(record.get("result", {})):
                continue
            raw_result = record.get("result", {})
            result = raw_result.get("result", raw_result) if isinstance(raw_result, dict) else {}
            if not isinstance(result, dict):
                continue
            create = result.get("create")
            if not isinstance(create, dict):
                continue
            create_kind = str(create.get("kind", ""))
            observed[create_kind] = create
            required_paths = [
                ("role",),
                ("kinetic", "speed_hint"),
                ("kinetic", "stress_impact"),
                ("kinetic", "stress_capacity"),
                ("inventory", "accepts_loose_items"),
                ("wrench_relevant_faces",),
                ("supported_interactions",),
                ("common_blockage_reasons",),
            ]
            if require_client_limits:
                required_paths.append(("unsupported_client_capabilities",))
            missing_fields[create_kind] = [
                ".".join(path)
                for path in required_paths
                if not has_nested_key(create, path)
            ]
        missing_kinds = [create_kind for create_kind in expected_kinds if create_kind not in observed]
        kinds_with_missing_fields = {
            create_kind: fields
            for create_kind, fields in missing_fields.items()
            if create_kind in expected_kinds and fields
        }
        return {
            "name": assertion.get("name", "create_component_semantics"),
            "kind": kind,
            "passed": not missing_kinds and not kinds_with_missing_fields,
            "expected_kinds": expected_kinds,
            "observed_kinds": sorted(observed.keys()),
            "missing_kinds": missing_kinds,
            "missing_fields": kinds_with_missing_fields,
        }
    if kind == "create_component_held_item":
        expected_kind = str(assertion.get("component_kind", ""))
        expected_item = str(assertion.get("item", ""))
        min_count = int(assertion.get("min_count", 1))
        observed_items: List[Any] = []
        matches = 0
        for create in inspected_create_payloads(state, global_state, expected_kind):
            inventory = create.get("inventory", {})
            held_item = inventory.get("held_item") if isinstance(inventory, dict) else None
            observed_items.append(held_item)
            if isinstance(held_item, dict) and held_item.get("item") == expected_item and int(held_item.get("count", 0)) >= min_count:
                matches += 1
        return {
            "name": assertion.get("name", f"create_component_held_item_{expected_kind}_{expected_item}"),
            "kind": kind,
            "passed": matches > 0,
            "component_kind": expected_kind,
            "item": expected_item,
            "expected_min_count": min_count,
            "matching_components": matches,
            "observed_items": observed_items,
        }
    if kind == "create_component_kinetic_nonzero":
        expected_kind = str(assertion.get("component_kind", ""))
        observed_speeds: List[Any] = []
        for create in inspected_create_payloads(state, global_state, expected_kind):
            kinetic = create.get("kinetic", {})
            if isinstance(kinetic, dict):
                observed_speeds.append(kinetic.get("speed"))
            press = create.get("press", {})
            if isinstance(press, dict):
                observed_speeds.append(press.get("kinetic_speed"))
        nonzero = [
            speed
            for speed in observed_speeds
            if isinstance(speed, (int, float)) and speed != 0
        ]
        return {
            "name": assertion.get("name", f"create_component_kinetic_nonzero_{expected_kind}"),
            "kind": kind,
            "passed": bool(nonzero),
            "component_kind": expected_kind,
            "observed_speeds": observed_speeds,
        }
    return {"name": assertion.get("name", "unknown_assertion"), "kind": kind, "passed": False}


def inventory_count(inventory: JsonDict, item_id: str) -> int:
    slots = inventory.get("inventory", {}).get("main", [])
    return sum(int(slot.get("count", 0)) for slot in slots if slot.get("item") == item_id)


def tool_records(state: JsonDict, global_state: Optional[JsonDict] = None) -> List[JsonDict]:
    if global_state and isinstance(global_state.get("tool_results"), list):
        return global_state["tool_results"]
    return state.get("tool_results", [])


def assertion_agent_state(assertion: JsonDict, state: JsonDict, global_state: Optional[JsonDict]) -> JsonDict:
    agent = assertion.get("agent")
    if agent and global_state:
        agents = global_state.get("agents", {})
        if isinstance(agents, dict) and isinstance(agents.get(agent), dict):
            return agents[agent]
    return state


def inspected_create_payloads(state: JsonDict, global_state: Optional[JsonDict], component_kind: str) -> Iterable[JsonDict]:
    for record in tool_records(state, global_state):
        if record.get("name") != "create.inspect_component" or is_tool_failure(record.get("result", {})):
            continue
        raw_result = record.get("result", {})
        result = raw_result.get("result", raw_result) if isinstance(raw_result, dict) else {}
        if not isinstance(result, dict):
            continue
        create = result.get("create")
        if not isinstance(create, dict):
            continue
        if component_kind and create.get("kind") != component_kind:
            continue
        yield create


def normalize_pos(value: Any) -> Optional[Tuple[int, int, int]]:
    if isinstance(value, list) and len(value) == 3:
        return (int(value[0]), int(value[1]), int(value[2]))
    if isinstance(value, dict) and {"x", "y", "z"}.issubset(value.keys()):
        return (int(value["x"]), int(value["y"]), int(value["z"]))
    return None


def is_tool_failure(result: Any) -> bool:
    return isinstance(result, dict) and result.get("ok") is False


def has_nested_key(value: Any, path: Tuple[str, ...]) -> bool:
    current = value
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return False
        current = current[key]
    return True


def public_state(state: JsonDict) -> JsonDict:
    return {
        "last_scene": state.get("last_scene"),
        "last_container": state.get("last_container"),
        "last_inventory": state.get("last_inventory"),
        "last_events": state.get("last_events"),
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
