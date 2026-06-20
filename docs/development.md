# MineLink Development Guide

## Local Commands

```bash
npm install
npm run build
npm test
bash scripts/dev/e2e.sh mine_tree
bash scripts/dev/e2e.sh create_smoke
bash scripts/dev/e2e.sh craft_smoke
bash scripts/dev/e2e.sh craft_negative
bash scripts/dev/e2e.sh guard_boundaries
bash scripts/dev/e2e.sh portal_coop
bash scripts/dev/soak.sh --runtime mock --iterations 1 --scenarios mine_tree,craft_negative,guard_boundaries,portal_coop
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
MINELINK_RUNTIME=neoforge MINELINK_ENABLE_CREATE=1 bash scripts/dev/e2e.sh create_smoke
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh craft_smoke
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh craft_negative
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh guard_boundaries
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh portal_coop
```

The real smoke path starts a Minecraft dedicated dev server, waits for the Mod
endpoint, runs the same MCP Host and Codex JSON-RPC replay harness, and stores
evidence under `.minelink-dev/<scenario>/`. The `mine_tree` scenario validates
the first body/perception/action loop. The `craft_smoke` scenario validates the
first real chest, slot movement, server recipe lookup, crafting output, and
inventory assertion path. The `craft_negative` scenario validates structured
boundary failures for missing station, missing material, invalid recipe, empty
output, and stale slot refs. The `guard_boundaries` scenario validates that a
real server_agent cannot act on unobserved refs, too-far refs, expired refs,
missing materials, or daytime sleep, and that a fixture-hidden diamond ore is
not returned by `observe.scene` while the opaque wall remains visible. The
`create_smoke` scenario uses the opt-in Create adapter profile, loads Create in
the real NeoForge dev server, moves `create:shaft` and `create:wrench` from a
visible chest into the agent inventory, places the shaft on a visible build
anchor through vanilla `useItemOn`, inspects the placed shaft, then uses the
wrench on the same visible component through the same FakePlayer-backed vanilla
interaction path as other item use. The
`portal_coop` scenario validates three server_agent bodies using public MCP
tools to take shared materials, place a
14-block obsidian frame through vanilla FakePlayer interaction, ignite it with
flint and steel, observe `minecraft:nether_portal`, and exchange one
distance-limited local A2A social event through `chat.say_local` plus
`observe.events`. Each NeoForge e2e run
derives a distinct Minecraft `server-port` from the MineLink endpoint port
unless `MINELINK_MINECRAFT_PORT` is set, so sequential CI smoke runs do not
collide on the vanilla `25565` port.
These are still smoke gates; complete server menu, Create, social runtime, and
long release soak coverage remain separate product gates. This path
is intentionally separate from the fast mock CI path because first-run
Minecraft/NeoForge dependency resolution and server startup are much slower.

Short stability soak runs repeat e2e scenarios and writes structured evidence:

```bash
bash scripts/dev/soak.sh --runtime mock --iterations 1 --scenarios mine_tree,craft_negative,guard_boundaries,portal_coop
MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/soak.sh --runtime neoforge --iterations 1 --scenarios craft_negative,guard_boundaries,portal_coop
```

Use `MINELINK_SKIP_BUILD=1` after a successful `npm run build` to avoid
rebuilding TypeScript packages for every e2e or soak scenario.

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
  craft_negative/
    logs/
    replays/
    reports/
  guard_boundaries/
    logs/
    replays/
    reports/
  portal_coop/
    logs/
    replays/
    reports/
  soak/
    mock/
      soak-report.json
      process-cleanup.json
      queue-metrics.json
    neoforge/
      soak-report.json
      process-cleanup.json
      queue-metrics.json
```

## GitHub Workflow

Use short-lived `codex/*` branches for implementation work. Keep product changes in reviewable commits and include:

- Acceptance gate touched.
- Commands run.
- Known verification gap.
- Link to GitHub issue or PR when tracking follow-up real-Minecraft validation.

CI is split into two layers:

- `.github/workflows/ci.yml` runs fast contract, TypeScript, mock runtime, and
  JSON-RPC replay gates plus a short mock stability soak on every push/PR.
- `.github/workflows/minecraft-neoforge.yml` runs a real NeoForge dedicated
  server smoke for `mine_tree`, `craft_smoke`, `craft_negative`,
  `guard_boundaries`, and
  `portal_coop`, then runs a short real NeoForge stability soak on push, pull
  request, `workflow_dispatch`, and a daily schedule. Keep long Create worlds
  and release-length soak tests on a future self-hosted runner profile.
