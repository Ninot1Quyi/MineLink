# MineLink Development Guide

## Agent-Friendly Entry Point

Use this command as the default verification entry point for Ona/Codex worktree
tasks:

```bash
bash scripts/dev/verify-agent-task.sh
```

It classifies the current diff and runs the smallest useful validation scope:
docs-only checks, fast build/typecheck/tests, selected mock e2e, or selected
real NeoForge e2e. Override the automatic scope when the issue requires a
specific gate:

```bash
bash scripts/dev/verify-agent-task.sh --scope docs
bash scripts/dev/verify-agent-task.sh --scope runtime --scenarios craft_smoke,craft_negative
bash scripts/dev/verify-agent-task.sh --scope neoforge --scenarios guard_boundaries,body_lifecycle
bash scripts/dev/verify-agent-task.sh --scope install
```

The script writes `.minelink-dev/reports/agent-task-summary.md`, which should
be pasted into PRs together with scenario report paths.

Install and Ona bootstrap changes should also run:

```bash
bash scripts/dev/install-smoke.sh --scope fast
```

The install smoke script refuses a dirty source worktree by default because it
proves a fresh clone of a committed ref. Its report is written to
`.minelink-dev/install-smoke/install-smoke-report.md` and records the source
commit, environment versions, command exit codes, and copied verifier summary.

Ona worktrees should rebuild from `.devcontainer/devcontainer.json`. The
devcontainer intentionally uses the prebuilt Node 22 image, Java 21 feature,
and image or OS provided `python3`; do not add a pinned Python feature that
forces source compilation during cloud rebuilds.

Ona prebuilds use two bootstrap entry points:

```bash
bash scripts/dev/bootstrap-prebuild.sh
```

The primary cloud prebuild entry is `.ona/automations.yaml`
`bootstrap-prebuild`, triggered by Ona's `prebuild` event with
`prebuildRequiresSuccess: true`. A failed bootstrap must fail the prebuild
instead of leaving agents with a snapshot that skipped MineLink setup. The
devcontainer `postCreateCommand` calls the same script for normal environment
creation and local devcontainer rebuilds.

This prebuild bootstrap installs OS tools, verifies Node/npm/Python/Java/ffmpeg,
runs `npm ci`, `npm run build`, `npm run typecheck`, and runs
`mod/neoforge/./gradlew --no-daemon build` to warm Gradle, Minecraft, and
NeoForge caches before a Codex agent opens the environment. It only logs whether
`LINEAR_API_KEY` is present; it never prints the value. Because the repository
owner has authorized development EULA acceptance for these private
Ona/devcontainer environments, the bootstrap also writes ignored local
`mod/neoforge/run/eula.txt` and `server.properties` files so NeoForge can start
without another setup step. It does not start a Minecraft server.

CI and PR review evidence can be summarized with:

```bash
node scripts/dev/summarize-evidence.mjs
```

The summary is written to `.minelink-dev/reports/ci-evidence-summary.md`. In
GitHub Actions, the CI, Install Smoke, and Minecraft NeoForge Smoke workflows
also append the same content to the run's Step Summary before uploading
artifacts.

Trace-driven acceptance artifacts can be rendered with:

```bash
node scripts/dev/render-acceptance-video.mjs --require-mp4
node scripts/dev/prepare-video-review-request.mjs --require-mp4
```

The script writes `.minelink-dev/reports/artifacts/acceptance-summary.md` and
`.minelink-dev/reports/artifacts/acceptance.mp4`; `--require-mp4` makes missing
`ffmpeg` support fail the command. Use `--task-requirements` to embed the
bounded task contract. The review-request script writes
`.minelink-dev/reports/artifacts/video-review-request.md` with the current
summary and MP4 hashes plus the exact markers that the release gate will
enforce. For tasks labeled `video-required`, a separate Ona Platform Codex
verifier must compare that request with the rendered summary/MP4 and write:

```text
.minelink-dev/reports/artifacts/video-review.md
```

The release gate is:

```bash
node scripts/dev/check-video-review.mjs --require-mp4
```

Ona agent-factory implementation and video review must use the Ona Platform
Codex agent option. The default Ona Agent mode is not accepted as MineLink
agent evidence. The checked-in Ona CLI automation is only for validation,
Linear status sync, artifact gating, and PR creation:

```bash
ona automations validate .ona/automations.yaml
ona ai automation create ona/ai-automations/minelink-agent-factory.yaml
```

Use `docs/linear-ona-agent-factory.md` for the Linear/GitHub task contract,
status model, board setup, and pilot `ona ai automation start` command.

Ona/Codex cloud worktrees should also read:

- `docs/linear-ona-agent-factory.md`
- `docs/ona-migration.md`
- `docs/agent-task-queue.md`
- `.github/pull_request_template.md`

The docs scope runs both repository guards:

- `scripts/dev/check-architecture-guard.sh`
- `scripts/dev/check-agent-workbench.sh`

## Local Commands

```bash
npm install
npm run build
npm test
bash scripts/dev/install-smoke.sh --scope fast
bash scripts/dev/e2e.sh mine_tree
bash scripts/dev/e2e.sh create_smoke
bash scripts/dev/e2e.sh craft_smoke
bash scripts/dev/e2e.sh craft_negative
bash scripts/dev/e2e.sh guard_boundaries
bash scripts/dev/e2e.sh body_lifecycle
bash scripts/dev/e2e.sh portal_coop
bash scripts/dev/soak.sh --runtime mock --iterations 1 --scenarios mine_tree,craft_negative,guard_boundaries,body_lifecycle,portal_coop
node packages/host/dist/index.js http --port 8765
node scripts/dev/summarize-evidence.mjs
node scripts/dev/render-acceptance-video.mjs --require-mp4
node scripts/dev/prepare-video-review-request.mjs --require-mp4
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
If the local Gradle wrapper process is unavailable or hangs while the cached
Gradle distribution is healthy, set `MINELINK_GRADLE_CMD=/absolute/path/to/gradle`
for `scripts/dev/build.sh` or `scripts/dev/start-server.sh`. The default path
remains the committed wrapper.

Real NeoForge e2e uses the Mod's loopback HTTP MineLink Protocol endpoint:

```bash
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh mine_tree
MINELINK_RUNTIME=neoforge MINELINK_ENABLE_CREATE=1 bash scripts/dev/e2e.sh create_smoke
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh craft_smoke
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh craft_negative
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh guard_boundaries
MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh body_lifecycle
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
missing materials, or daytime sleep, that `action.move` reports collision and
clips movement against a blocking fixture, and that a fixture-hidden diamond ore
is not returned by `observe.scene` while the opaque wall remains visible. It
also validates submit-mode queue backpressure for real NeoForge actions. The
`body_lifecycle` scenario validates the same public MCP body lifecycle surface
in mock and real NeoForge: `body.freeze` cancels an active submitted action and
freezes the body, world-changing action tools reject with `body_frozen`,
`body.restore` returns the same in-process body to `active`, and `body.remove`
deletes the runtime body so later `observe.self` returns `agent_not_born` while
the owner quota slot is released. It is not persistent restart restore
evidence. The
`create_smoke` scenario uses the opt-in Create adapter profile, loads Create in
the real NeoForge dev server, moves `create:shaft`, `create:wrench`, and
`minecraft:iron_ingot` from a visible chest into the agent inventory, places the
shaft on a visible build anchor through vanilla `useItemOn`, inspects the placed
shaft plus visible fixture cogwheel, depot, powered mechanical press, and belt
semantic payloads, uses the wrench on the same placed visible component, then
right-clicks the visible depot with the iron ingot through the same
FakePlayer-backed vanilla interaction path and proves the powered press leaves a
`create:iron_sheet` on the depot. It then uses empty-hand `action.use` against
that visible depot and proves the sheet reaches the agent inventory. The
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
bash scripts/dev/soak.sh --runtime mock --iterations 1 --scenarios mine_tree,craft_negative,guard_boundaries,body_lifecycle,portal_coop
MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/soak.sh --runtime neoforge --iterations 1 --scenarios craft_negative,guard_boundaries,body_lifecycle,portal_coop
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
Keep development runs bound to `127.0.0.1`. If you bind the Gateway to a
non-loopback host, set `MINELINK_GATEWAY_TOKEN` and send
`Authorization: Bearer <token>` on MCP requests. The Gateway also enforces
`MINELINK_GATEWAY_RATE_LIMIT_MAX_REQUESTS`,
`MINELINK_GATEWAY_RATE_LIMIT_WINDOW_MS`, and
`MINELINK_GATEWAY_MAX_SESSIONS`.

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
  reports/
    agent-task-summary.md
    architecture-guard.md
    agent-workbench-guard.md
    ci-evidence-summary.md
  install-smoke/
    install-smoke-report.md
    ci-evidence-summary.md
```

## GitHub Workflow

Use short-lived `codex/*`, `ona/*`, or `agent/*` branches for implementation
work. Keep product changes in reviewable commits and include:

- Acceptance gate touched.
- Commands run.
- Known verification gap.
- Link to GitHub issue or PR when tracking follow-up real-Minecraft validation.

CI is split into two layers:

- `.github/workflows/ci.yml` runs fast contract, TypeScript, mock runtime, and
  JSON-RPC replay gates plus architecture/workbench guards and a short mock
  stability soak on every push/PR. It appends
  `.minelink-dev/reports/ci-evidence-summary.md` to the GitHub Step Summary
  before artifact upload.
- `.github/workflows/minecraft-neoforge.yml` runs a real NeoForge dedicated
  server smoke for `create_smoke`, `mine_tree`, HTTP `mine_tree`,
  `craft_smoke`, `furnace_smoke`, `craft_negative`, `guard_boundaries`,
  `body_lifecycle`, `perception_shapes`, and `portal_coop`, then runs a short
  real NeoForge stability soak, installs `ffmpeg`, and requires a trace-driven
  acceptance MP4 before artifact upload on push, pull request,
  `workflow_dispatch`, and a daily schedule. Keep long Create worlds and
  release-length soak tests on a future self-hosted runner profile.
