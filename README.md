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
- NeoForge 1.21.1 dev server wrapper, loopback MineLink Protocol smoke endpoint, and product acceptance gates.

The mock runtime is not a replacement for the NeoForge server. It is the repeatable fast harness used before running a real Minecraft server. Real Minecraft validation runs through the NeoForge Mod endpoint and remains the authority for product acceptance.

## Quick Start

```bash
npm install
bash scripts/dev/e2e.sh mine_tree
bash scripts/dev/e2e.sh create_smoke
bash scripts/dev/e2e.sh craft_smoke
bash scripts/dev/e2e.sh craft_negative
bash scripts/dev/e2e.sh guard_boundaries
bash scripts/dev/e2e.sh portal_coop
bash scripts/dev/soak.sh --runtime mock --iterations 1 --scenarios mine_tree,craft_negative,guard_boundaries,portal_coop
```

The e2e harness writes evidence under `.minelink-dev/<scenario>/`:

- `logs/server.log`
- `logs/server.stdout.log`
- `logs/server.stderr.log`
- `logs/host.log`
- `logs/agent.log`
- `replays/latest-action-trace.jsonl`
- `reports/*-result.json`

The soak harness writes stability evidence under `.minelink-dev/soak/<runtime>/`:

- `soak-report.json`
- `process-cleanup.json`
- `queue-metrics.json`

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

MineLink targets Minecraft `1.21.1`, NeoForge `21.1.233`, and Java 21. A real NeoForge server run should use:

```bash
MINELINK_RUNTIME=neoforge bash scripts/dev/start-server.sh
```

For local agent validation, the dev harness writes `mod/neoforge/run/eula.txt`
with `eula=true` and generates `server.properties` with `online-mode=false`.
On macOS it automatically selects a Java 21 JDK when the default `java` points
to an older runtime.

Run the real game smoke scenarios with:

```bash
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh mine_tree
MINELINK_RUNTIME=neoforge MINELINK_ENABLE_CREATE=1 bash scripts/dev/e2e.sh create_smoke
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh craft_smoke
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh craft_negative
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh guard_boundaries
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh portal_coop
```

This starts the NeoForge dedicated dev server, waits for the Mod's loopback HTTP
MineLink Protocol endpoint, runs the MCP Host, and drives the scenario through
the Codex JSON-RPC replay harness. The current real smoke validates connection,
birth, observation, movement, looking, mining one visible block in the real
world, chest slot movement, crafting-table recipe lookup, oak-plank crafting,
inventory assertions, structured negative crafting failures, a guard-boundary
path that rejects unobserved refs, too-far targets, expired refs, missing
materials, and daytime sleep through server-side rules, and a three-agent portal
cooperation path. The portal path uses FakePlayer-backed vanilla
`useItemOn`/`useItem` for block placement and ignition after MineLink ref,
reach, visibility, and inventory checks. The Create smoke opt-in profile loads
Create and verifies `create.inspect_component` plus a wrench `action.use`
against visible component refs; it remains a partial adapter gate, not an
automation shortcut. Complete server menu coverage, multi-agent social runtime,
and long soak tests remain separate acceptance gates in
`docs/minelink-acceptance.md`.
