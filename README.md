# MineLink

MineLink is a two-process Minecraft agent runtime:

```text
Codex / Claude Code -> MineLink Host/Gateway (MCP stdio or Streamable HTTP) -> MineLink Protocol -> MineLink Mod / server_agent
```

This repository currently delivers the Phase 0/1 engineering baseline:

- TypeScript MineLink Host with MCP stdio tools and a Streamable HTTP Gateway.
- JSON/WebSocket MineLink Protocol client.
- Agent-local SDK surface.
- Codex JSON-RPC e2e harness that still drives MineLink through public MCP tools.
- Mock Minecraft runtime for deterministic CI and local e2e validation.
- NeoForge 1.21.1 mod skeleton and product acceptance gates.

The mock runtime is not a replacement for the NeoForge server. It is the repeatable dev harness used before running a real Minecraft server, because real server startup requires Java 21, NeoForge assets, and a completed Mod endpoint.

## Quick Start

```bash
npm install
bash scripts/dev/e2e.sh mine_tree
bash scripts/dev/e2e.sh create_smoke
bash scripts/dev/e2e.sh craft_smoke
```

The e2e harness writes evidence under `.minelink-dev/<scenario>/`:

- `logs/server.log`
- `logs/host.log`
- `logs/agent.log`
- `replays/latest-action-trace.jsonl`
- `reports/*-result.json`

## MCP Host and Gateway

Build and run the stdio MCP server:

```bash
npm run build
node packages/host/dist/index.js mcp
```

Run the Streamable HTTP Gateway for remote-capable MCP clients:

```bash
node packages/host/dist/index.js http --host 127.0.0.1 --port 8765
```

The Gateway exposes `GET /healthz` and MCP Streamable HTTP at `POST /mcp`.
Keep it bound to localhost for development. Binding it to a public interface requires an external auth/rate-limit layer until MineLink has production admission controls.

Codex/Claude-style MCP config can point at that command. The stable public tools are:

- `minelink.ping`
- `minelink.connect_server`
- `minelink.birth`
- `minelink.tool_list`
- `minelink.tool_query`
- `minelink.tool_execute`

Dynamic game tools are discovered lazily with `tool_list` and `tool_query`, then executed with `tool_execute`.

## Real NeoForge Runtime

MineLink targets Minecraft `1.21.1`, NeoForge `21.1.233`, and Java 21. The current automated tests use the mock runtime; a real NeoForge run should use:

```bash
MINELINK_RUNTIME=neoforge bash scripts/dev/start-server.sh
```

For local agent validation, the dev harness writes `mod/neoforge/run/eula.txt`
with `eula=true` and generates `server.properties` with `online-mode=false`.
That path still refuses to proceed when Java 21 or the NeoForge wrapper is
missing.
