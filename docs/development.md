# MineLink Development Guide

## Local Commands

```bash
npm install
npm run build
npm test
bash scripts/dev/e2e.sh mine_tree
bash scripts/dev/e2e.sh create_smoke
bash scripts/dev/e2e.sh craft_smoke
node packages/host/dist/index.js http --port 8765
```

## Harness Modes

Default mode is `mock`, which starts a deterministic WebSocket runtime.

```bash
MINELINK_RUNTIME=mock bash scripts/dev/e2e.sh mine_tree
```

The default e2e agent path is `examples/agents/codex_rpc_json_runner.py`.
It consumes JSON-RPC decision envelopes and executes the requested MineLink MCP
tools. CI uses replay fixtures in `examples/codex-rpc/*.replay.jsonl`; live
experiments can set `MINELINK_CODEX_RPC_COMMAND` to a command that reads one
JSON-RPC request from stdin and writes one JSON-RPC response to stdout.

Real NeoForge mode is explicit:

```bash
MINELINK_RUNTIME=neoforge bash scripts/dev/start-server.sh
```

This mode requires Java 21 and a local dev server configured with
`online-mode=false` for agent validation. On macOS the script automatically
selects a Java 21 JDK from `/usr/libexec/java_home -v 21` when the default
`java` points at an older runtime. For local testing, the dev harness defaults
`MINELINK_ACCEPT_EULA=1` and writes `mod/neoforge/run/eula.txt` with `eula=true`;
set `MINELINK_ACCEPT_EULA=0` to disable that local automation.
It also writes `online-mode=false` by default. Use `MINELINK_ONLINE_MODE=true`
only for the negative auth gate that proves online-mode agent birth is rejected.

Real NeoForge e2e uses the Mod's loopback HTTP MineLink Protocol endpoint:

```bash
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh mine_tree
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh craft_smoke
```

The real smoke path starts a Minecraft dedicated dev server, waits for the Mod
endpoint, runs the same MCP Host and Codex JSON-RPC replay harness, and stores
evidence under `.minelink-dev/<scenario>/`. The `mine_tree` scenario validates
the first body/perception/action loop. The `craft_smoke` scenario validates the
first real chest, slot movement, server recipe lookup, crafting output, and
inventory assertion path. Each NeoForge e2e run derives a distinct Minecraft
`server-port` from the MineLink endpoint port unless `MINELINK_MINECRAFT_PORT`
is set, so sequential CI smoke runs do not collide on the vanilla `25565` port.
These are still smoke gates; complete FakePlayer,
server menu, Create, and soak coverage remain separate product gates. This path
is intentionally separate from the fast mock CI path because first-run
Minecraft/NeoForge dependency resolution and server startup are much slower.

## MCP Transports

Local agent tools should use stdio by default:

```bash
node packages/host/dist/index.js mcp
```

Remote-capable agent platforms can use the Streamable HTTP Gateway:

```bash
node packages/host/dist/index.js http --host 127.0.0.1 --port 8765
```

The Gateway exposes `GET /healthz` and MCP Streamable HTTP at `POST /mcp`.

## Evidence Layout

```text
.minelink-dev/
  mine_tree/
    logs/
    replays/
    reports/
  create_smoke/
    logs/
    replays/
    reports/
  craft_smoke/
    logs/
    replays/
    reports/
```

## GitHub Workflow

Use short-lived `codex/*` branches for implementation work. Keep product changes in reviewable commits and include:

- Acceptance gate touched.
- Commands run.
- Known verification gap.
- Link to GitHub issue or PR when tracking follow-up real-Minecraft validation.

CI is split into two layers:

- `.github/workflows/ci.yml` runs fast contract, TypeScript, mock runtime, and
  JSON-RPC replay gates on every push/PR.
- `.github/workflows/minecraft-neoforge.yml` runs a real NeoForge dedicated
  server smoke for `mine_tree` and `craft_smoke` on push, pull request,
  `workflow_dispatch`, and a daily schedule, then uploads server and MineLink
  evidence artifacts. Keep long Create worlds and soak tests on a future
  self-hosted runner profile.
