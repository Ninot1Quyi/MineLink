# Codex RPC JSON Agent Harness

MineLink keeps the game interface MCP-compatible. Codex is the first verified
agent runtime because it has a local JSON-RPC app-server surface, but the
MineLink Host and Gateway remain generic MCP servers for Claude Code, OpenClaw,
Hermes, and other agent runtimes.

## Contract

The e2e harness sends a JSON-RPC request to an agent decision source:

```json
{
  "jsonrpc": "2.0",
  "id": "minelink-agent-turn-1",
  "method": "minelink/next_tool_calls",
  "params": {
    "scenario": "craft_smoke",
    "objective": "Use MineLink MCP tools to craft oak planks.",
    "available_tools": [],
    "state": {}
  }
}
```

The decision source returns a JSON-RPC response whose
`result.mineLinkDecision.tool_calls` array contains public MineLink MCP dynamic
tool calls:

```json
{
  "jsonrpc": "2.0",
  "id": "minelink-agent-turn-1",
  "result": {
    "mineLinkDecision": {
      "tool_calls": [
        {
          "name": "observe.scene",
          "arguments": { "radius": 16, "include": ["visible_blocks", "self"] }
        }
      ],
      "done": false
    }
  }
}
```

Final responses set `done: true` and include assertions. The runner writes the
assertion results and evidence paths into `.minelink-dev/<scenario>/reports/`.
Replay responses may include `wait_ms` to let short-lived refs expire during a
boundary test. This delay is a harness feature, not a MineLink runtime tool.

## Running

Replay mode is deterministic and is used by CI:

```bash
bash scripts/dev/e2e.sh craft_smoke
```

Live command mode lets a Codex RPC bridge provide decisions:

```bash
MINELINK_CODEX_RPC_COMMAND="your-codex-rpc-bridge" bash scripts/dev/e2e.sh craft_smoke
```

The command must read one JSON-RPC request from stdin and write one JSON-RPC
response to stdout. The response may only request MineLink MCP tools; runtime
internals, Minecraft protocol packets, and direct Mod methods are not part of
the agent contract.

## Replay Templates

Replay fixtures may use deterministic placeholders such as
`${visible_block:minecraft:chest}`, `${container_slot:minecraft:oak_log}`,
`${inventory_empty_slot}`, and `${output_slot}`. These placeholders exist only
to keep CI replay stable when runtime refs are short-lived. A live agent should
return concrete refs from the previous observation state.

The `guard_boundaries` replay also uses assertions such as
`visible_block_absent` to prove that hidden fixture blocks were not returned by
`observe.scene`, and `move_collided` to prove movement was clipped by collision
instead of passing through blocking fixture geometry.
