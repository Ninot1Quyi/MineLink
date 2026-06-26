# MineLink Full Product Acceptance Plan

Updated: 2026-06-21

This document is the acceptance contract for the full MineLink product described by `minelink-plan.md` and `minelink-mod-mcp-architecture.md`. It is intentionally broader than the current local baseline: a gate is accepted only when its evidence is produced by repeatable commands, logs, reports, and runtime assertions.

## 1. Required Product Shape

MineLink is accepted only as a two-process system:

```text
Codex / Claude Code / OpenClaw / Hermes
  -> MineLink Host or Gateway
  -> MineLink Protocol
  -> MineLink Mod / MineLink Runtime
  -> server_agent body in Minecraft
```

Hard boundaries:

- The Mod is the Minecraft authority: server_agent bodies, limited perception, guard checks, action scheduler, inventory/container/crafting execution, social events, persistence, and audit.
- The Host/Gateway is the MCP authority: stdio/Streamable HTTP transports, tool schemas, sessions, reconnect, capability cache, logs, replay, admission tokens, and local config.
- Agent skill code runs in the agent-local workspace by default. It is not uploaded to the Minecraft JVM and is not executed by the Mod.
- All world-changing actions are revalidated by server-side guard logic. MCP schemas, local SDK code, and prompts are not security boundaries.
- `server_agent` is the default body. `local_player` remains a human player unless explicitly attached later.

## 2. Full Acceptance Gates

### Gate Status Audit

Status vocabulary:

- `mock-only`: only the mock runtime proves the behavior.
- `smoke-only`: a narrow happy-path fixture proves the behavior, but not a real product capability.
- `real-partial`: real NeoForge/Minecraft evidence exists, but release requirements remain incomplete.
- `product-accepted`: every required item in the gate has repeatable real evidence.
- `missing`: no meaningful accepted implementation/evidence exists yet.

Current audit:

| Gate | Status | Evidence Boundary |
| --- | --- | --- |
| Gate 0: Repository, Install, and Baseline Harness | real-partial | Build, typecheck, tests, CI, mock e2e, and real NeoForge smoke exist; fresh user install and full release readiness remain incomplete. |
| Gate 1: Real NeoForge Mod Runtime | real-partial | Real dedicated NeoForge e2e covers core protocol and smoke tools; persistence, full lifecycle, and complete runtime parity remain incomplete. |
| Gate 2: server_agent Body and Guard Pipeline | real-partial | Real guard, queue, FakePlayer inventory, movement, mining, owner quota, and same-process freeze/restore/remove evidence exists; persistent restore, timed lifecycle parity, cancellation breadth, expiry breadth, and full body parity remain incomplete. |
| Gate 3: Limited Perception | real-partial | Real fixture evidence covers occlusion and selected shape classifications; generic raycast/block-shape visibility and long-running perception cache behavior remain incomplete. |
| Gate 4: MCP Host and Gateway | real-partial | MCP stdio, Streamable HTTP, reconnect, catalog preflight, token/rate/session checks, and real HTTP gateway smoke exist; full hosted gateway operations remain incomplete. |
| Gate 5: Agent RPC JSON, MCP Compatibility, and Local SDK | real-partial | Codex JSON-RPC replay and generic MCP dynamic tools are verified; Python helper parity, polling/subscription helpers, reconnect ergonomics, replay SDK, and semantic retries remain incomplete. |
| Gate 6: Container and Crafting | real-partial | Real chest, crafting table, furnace, native `useItemOn` container entry, server `Slot.safeTake/safeInsert` transfer evidence, slot refs, recipe registry, native oak-planks `ResultSlot` evidence, repeated oak-planks result takes, vanilla `PlaceRecipe` shaped stick placement, bounded crafting-table `AbstractContainerMenu.clicked` evidence, and FakePlayer inventory evidence exists; broader menu click parity, broader shaped/modded recipe breadth, and remainder parity remain incomplete. |
| Gate 7: Create Adapter | real-partial | Real Create fixture proves visible component inspection, native item/wrench use, powered press processing, and inventory pickup; complete Create semantics and broader mod compatibility remain incomplete. |
| Gate 8: Multi-agent, A2A, and Social Runtime | real-partial | Real three-agent portal cooperation, local chat, physical notice board, redacted payloads, and owner quota evidence exists; human interaction, durable social persistence, orders, letters, telegraph, and broader A2A remain incomplete. |
| Gate 9: Frontier Society and Director | missing | No accepted 10-agent society, Director replay, relationship/economy metrics, or emergent-role evidence yet. |
| Gate 10: Install and Product Packaging | real-partial | Fresh committed checkout bootstrap is scriptable through `scripts/dev/install-smoke.sh`; the default devcontainer now uses a registry/Docker-smoked GHCR cache-prewarm image; GitHub issue and Linear polling dispatchers can queue the shared Ona automation and write chain reports; CI now has a manual/path-filtered Ona prebuild refresh fallback for `codex/minelink-mvp-engineering`, but public Ona automation `agent` steps currently launch the default Agent rather than Codex. Ona's documented `StartAgent(agentId, codexSettings)` API now has GitHub Actions identity-canary evidence for programmatic Ona Platform Codex launch/readback, but automatic task implementation, video verifier launch, PR finalization, server admin install, agent user install, LAN install, and cross-platform packaging evidence remain incomplete. |
| Gate 11: Security, Stability, and Release | real-partial | Short mock/real soaks, cleanup reports, gateway admission tests, and owner quota evidence exist; long real Minecraft soak and release security evidence remain incomplete. |

No gate is currently `product-accepted`. A full-product completion claim requires
every gate above to move to `product-accepted` with repeatable real evidence.

### Gate 0: Repository, Install, and Baseline Harness

Required:

- `npm install` from a clean clone sets up Host, SDK, mock runtime, tests, and scripts.
- `npm run build`, `npm run typecheck`, `npm test`, and `npm run ci` pass.
- CI runs build, tests, mock `mine_tree`, `create_smoke`, `craft_smoke`,
  `furnace_smoke`, `craft_negative`, `guard_boundaries`,
  `body_lifecycle`, `perception_shapes`, and `portal_coop`, plus real NeoForge
  smoke for those scenarios, and uploads `.minelink-dev/` evidence. Ordinary
  GitHub CI must not publish final acceptance-video PR comments; final video
  evidence belongs to the Ona task/finalizer plus same-session Codex verifier
  release path.
- `scripts/dev/build.sh` records Java/NeoForge readiness as valid JSON.
- No GitHub token, admission token, Microsoft credential, EULA acceptance, or server secret is committed.

Evidence:

- `package-lock.json`
- `.github/workflows/ci.yml`
- `.minelink-dev/reports/build-environment.json`
- `npm_config_registry=https://registry.npmjs.org npm audit --audit-level=moderate`

Current status:

- Implemented for the TypeScript/mock baseline.
- Real NeoForge startup now uses the committed Gradle wrapper and selects Java 21
  when available.
- GitHub Actions now has a dedicated real NeoForge smoke workflow for
  `mine_tree`, `create_smoke`, `craft_smoke`, `furnace_smoke`,
  `craft_negative`, `guard_boundaries`, `body_lifecycle`,
  `perception_shapes`, and `portal_coop` on push, pull request, manual
  dispatch, and daily schedule; full release acceptance still requires the
  later complete Create, social runtime, install, security, and release-length
  soak gates.

### Gate 1: Real NeoForge Mod Runtime

Required:

- `mod/neoforge` builds on Java 21 with Minecraft `1.21.1` and NeoForge `21.1.233`.
- `./gradlew runServer` prints `MineLink ready`.
- The Mod opens a configurable loopback MineLink Protocol endpoint.
- Endpoint supports `hello`, `connect`, `agent.birth`, `tool.list`, and `tool.execute` for the first real smoke tools.
- The first real smoke tools are `observe.self`, `observe.scene`, `observe.inventory`, `action.move`, `action.look_at`, and `action.mine_visible_block`.
- The second real smoke path adds chest/crafting-table coverage for
  `container.open`, `container.observe`, `container.move_stack`,
  `container.take_output`, `craft.list_available`, and `craft.quick_craft`.
- The portal cooperation smoke path adds `block.place` and `action.use` backed
  by NeoForge `FakePlayer` and vanilla `ServerPlayerGameMode.useItemOn/useItem`
  after MineLink observed-ref, reach, visibility, and inventory checks.
- The Create smoke path adds optional Create dependencies and verifies
  chest material withdrawal, Create component placement, structured
  `create.inspect_component` semantics for the placed shaft plus visible
  cogwheel, depot, mechanical press, and belt fixtures, wrench `action.use`
  against visible component refs, and a real powered press flow where
  `action.use` places `minecraft:iron_ingot` onto a visible depot and
  returns a target-insert payload with `placed_on_target.input=minecraft:iron_ingot`
  and `placed_on_target.held_item.item=minecraft:iron_ingot`;
  `create.inspect_component` then observes `create:iron_sheet` after Create
  processing on a real NeoForge dev server. The same replay then uses
  empty-hand `action.use` on the visible depot, asserts
  `taken.item=create:iron_sheet`, and proves the sheet enters the agent
  inventory.
- The guard-boundaries smoke path adds `action.sleep` and deliberate negative
  actions that prove unobserved refs, too-far refs, expired refs, missing
  materials, hidden fixture blocks, and vanilla sleep rejections produce
  structured server-side outcomes.
- Complete Create semantics, persistence, social runtime, complete server menu
  coverage, and full inventory/menu parity remain later gates; they must not be
  claimed by the smoke implementation.
- `online-mode=true` returns `unsupported_online_auth` and does not create an agent.
- `online-mode=false` supports open admission plus server-side rate and agent-count limits.
- Server logs and action trace survive clean server stop/restart.

Evidence:

- Java 21 build log.
- Dedicated server log.
- Real protocol trace.
- `MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh mine_tree`.
- `MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh craft_smoke`.
- `MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh furnace_smoke`.
- `MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh guard_boundaries`.
- `MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh body_lifecycle`.
- `MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh perception_shapes`.
- `MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh portal_coop`.
- GitHub Actions artifact from `.github/workflows/minecraft-neoforge.yml`.

Blocking rule:

- Local dev automation defaults `MINELINK_ACCEPT_EULA=1` and writes `mod/neoforge/run/eula.txt` with `eula=true` so Minecraft server startup is not blocked during agent validation. Set `MINELINK_ACCEPT_EULA=0` when testing the no-EULA failure path.
- Local and GitHub validation must use `online-mode=false`; `online-mode=true` remains a negative auth test until agent-owned online authentication is implemented.

### Gate 2: server_agent Body and Guard Pipeline

Required:

- AgentBodyManager creates, restores, freezes, and removes `server_agent` bodies.
- Every action passes schema, admission, ref/lease, perception, body-state, and native-interaction checks.
- Action lifecycle supports `submitted`, `accepted`, `queued`, `running`, `completed`, `failed`, `cancelled`, and `expired`.
- Per-agent queue/backpressure returns `backpressure_queue_full`.
- Ref expiration returns `expired_ref`.
- Unknown or unobserved targets return `unknown_or_unobserved_target`.
- Distant visible targets return `target_too_far`.
- Hidden or stale targets return `target_not_visible` or `target_not_visible_from_current_view`.

Evidence:

- Unit tests for each failure reason.
- Real server action trace proving guard order.
- E2E with deliberate negative actions.

Current status:

- Mock runtime and real NeoForge runtime cover `guard_boundaries`, which uses
  only public MCP dynamic tools to assert `unknown_or_unobserved_target`,
  `target_too_far`, `missing_material`, `blocked` for vanilla daytime sleep,
  and `expired_ref`.
- `agent.birth` now publishes the real `MineLink-*` FakePlayer-backed
  `server_agent` as a visible ServerPlayer entity, instead of relying on a
  recorder-only ArmorStand proxy. The client recorder is required to follow a
  player entity, so proxy marker footage cannot satisfy product-video gates.
- `action.move` now uses native entity movement in the NeoForge runtime and the
  guard replay asserts movement collision feedback; the latest real guard run
  reported `collision=true` with `moved_distance` lower than
  `requested_distance`. Movement is stepped at an approximate vanilla walking
  cadence for video-required scenarios and now broadcasts position/motion
  updates for the visible `MineLink-*` player body, but full client-equivalent
  locomotion, pathfinding, jump/fall handling, and animation parity remain open
  product gaps.
- `action.mine_visible_block` in the real NeoForge runtime now keeps the
  existing observed-ref, TTL, reach, and block-id guards, then mines through the
  FakePlayer `ServerPlayerGameMode.handleBlockBreakAction` start/stop path while
  ticking `ServerPlayerGameMode` until vanilla block-destroy progress removes
  the target. Drops are collected only from newly spawned nearby item entities
  through vanilla/NeoForge pickup hooks, and unbreakable or unharvestable targets
  return structured `blocked` or `wrong_tool` failures instead of synthetic
  inventory credit. Synchronous mining is capped below the protocol request
  timeout; the `mine_tree` fixture requires the agent to take a wooden axe from
  the shared chest through public container tools before mining the log. Video-
  required mining also broadcasts main-hand swing and block-destroy progress
  from the same visible `server_agent` player entity so the MP4 can show task
  work, not just a final inventory result.
- The real NeoForge runtime now treats the FakePlayer inventory as the
  authoritative item store for `observe.inventory`, container inventory slots,
  `container.take_output`, `craft.quick_craft` ingredient consumption,
  `block.place`, and `action.use`. The remaining internal inventory map is only
  a compatibility mirror rebuilt from the FakePlayer inventory.
- The guard replay also exercises `mode=submit` for real NeoForge actions.
  Accepted action handles return `status=accepted`, `lifecycle_status=queued`,
  and an `action_id`; public `action.status` and `action.cancel` resolve only
  the active server_agent's own handles; queued or running actions can be
  cancelled and release queue capacity; submitted actions are scheduled through
  `queued -> running -> completed/failed/cancelled/expired`; failed submitted
  actions preserve the public tool failure reason; submitted actions that
  outlive their TTL can be observed as `expired`; excess submissions return
  `backpressure_queue_full` instead of allowing unbounded per-agent queue
  growth.
- Mock runtime and real NeoForge runtime enforce the advertised
  `max_agents_per_owner=3` admission limit with `agent_quota_exceeded`; the
  three-agent portal cooperation replay proves exactly three same-owner agents
  can cooperate while a fourth same-owner birth is rejected server-side.
- Mock runtime and real NeoForge runtime now cover the same-process
  `body_lifecycle` replay through public MCP dynamic tools. `body.freeze`
  reports `body_status=frozen`, cancels an active submitted action with
  `body_frozen`, and preserves that failure on `action.status`; a frozen body
  rejects world-changing `action.move` with `body_frozen`; `body.restore`
  reports `restore_scope=same_process` and allows movement again; `body.remove`
  reports `body_status=removed`, releases the owner active-body count, and
  makes later `observe.self` return `agent_not_born`.
- Current same-process lifecycle evidence is written by
  `.minelink-dev/body-lifecycle-acceptance/mock-body_lifecycle/reports/body_lifecycle-result.json`,
  `.minelink-dev/body-lifecycle-acceptance/neoforge-body_lifecycle/reports/body_lifecycle-result.json`,
  `.minelink-dev/body-lifecycle-acceptance/soak-neoforge/soak-report.json`,
  and `.minelink-dev/reports/artifacts/body-lifecycle/acceptance.mp4`.
- The real NeoForge guard fixture also proves that a fixture-hidden
  `minecraft:diamond_ore` is absent from `observe.scene` while the intervening
  `minecraft:stone` wall and reachable `minecraft:white_bed` are visible.
- This is not the full Gate 2 release surface yet. The remaining body lifecycle
  work is persistent restore after server restart, broader freeze/remove
  recovery semantics across reconnects, timed mining start/stop/cancel state,
  and complete body-state parity. Same-process `body.restore` must not be
  counted as persistent recovery evidence.

### Gate 3: Limited Perception

Required:

- `observe.self`, `observe.scene`, and `observe.inventory` work against real server state.
- `observe.scene` returns visible surfaces with short-lived refs, not raw chunk data.
- Perception uses Minecraft/NeoForge block state, shape, raycast, and configurable MineLink vision tags.
- Transparent/decorative/partial occluder blocks are represented structurally.
- Return size, radius, and frequency are bounded.

Evidence:

- Fixture worlds for opaque wall, glass, leaves, torch, fence, water, and tree.
- Assertion reports prove hidden blocks are not returned.

Current status:

- `guard_boundaries` provides a real NeoForge hidden-block negative: the
  opaque-wall fixture observes the wall and bed but does not return the diamond
  ore behind the wall.
- `perception_shapes` adds repeatable mock and real NeoForge evidence for
  visible non-opaque classifications: glass and oak leaves carry
  `minelink:vision_translucent`, torch carries
  `minelink:vision_decorative`, water carries `minelink:vision_fluid`, oak
  fence carries `minelink:vision_partial_occluder`, stone carries
  `minelink:vision_opaque` and `minelink:opaque_fixture`, and the diamond ore
  behind that stone wall remains absent from `observe.scene`.
- Real NeoForge decorative/fluid perception uses stable native block state:
  torch proves empty-collision decorative classification and water proves
  `FluidState` classification without relying on random world vegetation. The
  water fixture is isolated by native solid blocks so server fluid ticks cannot
  wash away the torch before observation.
- Regression note: GitHub Actions run `27923213057` exposed the original real
  NeoForge fixture bug where water at `base.south(3)` flowed into the torch at
  `base.south(2)` before observation. The fixture now boxes the water source
  with native solid blocks and moves the torch/fence outside the flow path.
  Local verification on 2026-06-22 passed
  `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 MINELINK_SKIP_BUILD=1 bash scripts/dev/e2e.sh perception_shapes`
  with `torch_is_classified_decorative`, `water_is_classified_fluid`, and
  `opaque_wall_hides_diamond_ore` all passing.
- This is not the full Gate 3 release surface yet. General raycast/shape-based
  occlusion for arbitrary block shapes, complex modded blocks, and long-running
  perception cache behavior remains to be implemented.

### Gate 4: MCP Host and Gateway

Required:

- Host supports MCP stdio for local Codex/Claude Code.
- Gateway supports MCP Streamable HTTP for remote agent platforms.
- Public MCP surface remains small:
  `minelink.ping`, `minelink.connect_server`, `minelink.birth`, `minelink.tool_list`, `minelink.tool_query`, `minelink.tool_execute`.
- Game capabilities are lazy dynamic tools.
- Connected runtimes are the authority for dynamic game tools: `tool.list`
  returns compact summaries with namespace/query/tag filters, and `tool.query`
  returns the full input schema, preconditions, and failure reasons for one
  tool.
- Reconnect to a new endpoint cannot leave stale socket/session state.
- Connected-runtime errors are not masked by local fallback.
- Host/Gateway logs include tool call, protocol request, protocol response, action id, failure reason, latency, and agent id.

Evidence:

- MCP stdio smoke.
- Streamable HTTP smoke.
- Reconnect regression test.
- Fault-injection test for tool catalog failure.

Current status:

- MCP stdio is implemented by `node packages/host/dist/index.js mcp`.
- Streamable HTTP Gateway is implemented by `node packages/host/dist/index.js http --host 127.0.0.1 --port 8765`.
- Automated tests cover HTTP health, MCP initialize/session negotiation, `tools/call`, reconnect, and connected-runtime tool catalog failure.
- The Codex JSON-RPC e2e harness can run existing gameplay scenarios through
  the Streamable HTTP Gateway with `MINELINK_MCP_TRANSPORT=http`; CI runs
  `mine_tree` through that path and uploads the separate
  `.minelink-dev/http-mine_tree` evidence. The real NeoForge workflow also runs
  `mine_tree` through the HTTP Gateway and uploads
  `.minelink-dev/neoforge-http-mine_tree` evidence.
- Connected Host sessions now forward `minelink.tool_query` to the runtime
  instead of relying on a static Host catalog. Runtime extension
  `minelink.tool_execute` calls are also forwarded after birth, so modded server
  capabilities can be added without preloading every schema into the Host.
- Mock and real NeoForge e2e reports now perform a catalog preflight before
  gameplay: default `tool.list` must return tools, `namespace=container` must
  return only `container.*`, `query=Create` must include
  `create.inspect_component`, `tool.query(container.move_stack)` must include
  an input schema plus `blocked` as an advertised failure reason, and
  `tool.query(debug.oracle)` must fail with `unknown_tool`.
- The Gateway now has a basic admission and abuse-control layer: optional
  `MINELINK_GATEWAY_TOKEN` Bearer auth, refusal to bind a non-loopback host
  without a token unless explicitly overridden for controlled tests,
  fixed-window request rate limiting, and an active MCP session cap.

### Gate 5: Agent RPC JSON, MCP Compatibility, and Local SDK

Required:

- Codex is the first verified agent runtime, but MineLink must stay MCP-compatible for Claude Code, OpenClaw, Hermes, and other mainstream agents.
- Agent decisions used in the default e2e harness come from JSON-RPC envelopes, not from a hardcoded MineLink policy script.
- The JSON-RPC runner accepts a real command through `MINELINK_CODEX_RPC_COMMAND` and a deterministic replay through `MINELINK_CODEX_RPC_REPLAY`.
- JSON-RPC decision payloads call only public MineLink MCP tools; they do not call runtime internals.
- TypeScript SDK and Python MCP client helpers expose observe/body/chat/container/craft/create wrappers.
- SDK wraps action handles, await/submit modes, polling/events, reconnect, and replay access.
- `examples/agents/codex_rpc_json_runner.py` creates an agent, consumes Codex-style JSON-RPC tool-call decisions, executes the calls through MCP, and writes assertions/evidence.
- Failed attempts are retried from structured failure reasons.
- Reports include agent id, final assertions, evidence paths, actions, final inventory, and trace path.
- Reports include catalog preflight evidence so every gameplay scenario proves
  lazy dynamic-tool discovery before agent decisions are replayed.

Evidence:

- `bash scripts/dev/e2e.sh mine_tree`
- `bash scripts/dev/e2e.sh create_smoke`
- `bash scripts/dev/e2e.sh craft_smoke`
- `bash scripts/dev/e2e.sh furnace_smoke`
- `bash scripts/dev/e2e.sh craft_negative`
- `bash scripts/dev/e2e.sh guard_boundaries`
- `bash scripts/dev/e2e.sh perception_shapes`
- `bash scripts/dev/e2e.sh portal_coop`
- `examples/codex-rpc/*.replay.jsonl`
- `.minelink-dev/reports/mine_tree-result.json`

Current status:

- The TypeScript SDK exposes typed observe/body/chat/container/craft/create
  wrappers over the generic dynamic-tool executor. Awaited wrappers preserve the
  raw MCP-compatible tool result path.
- The TypeScript SDK now also exposes submit-mode helpers for queueable
  body/chat actions and converts accepted responses into action handles with
  `actionId`, lifecycle status, tool name, and queue depth metadata where the
  runtime provides it. Backpressure and malformed submit responses remain
  structured failures instead of synthetic handles.
- Protocol and Host tests cover `mode: "submit"` parsing and forwarding through
  the public `minelink.tool_execute` path. The generic MCP surface remains the
  authority; SDK helpers do not call runtime internals.
- This is not the full Gate 5 release surface yet. Python helper parity,
  action polling/subscription helpers, reconnect ergonomics, replay access in
  the SDK, and semantic retry loops still need separate implementation and
  evidence.

### Gate 6: Container and Crafting

Required:

- `container.open`, `container.observe`, `container.move_stack`, `container.take_output` operate through server menu/slot rules.
- `craft.list_available` returns craftable recipes from current inventory/reachable stations.
- `craft.quick_craft` uses real server recipe and container rules.
- No `give`, synthetic item creation, or local-only recipe rewrite is allowed.

Evidence:

- Workbench fixture.
- Chest/furnace fixture.
- Negative tests for missing material, station too far, inventory full, invalid recipe, and stale slot ref.
- `bash scripts/dev/e2e.sh craft_smoke`
- `bash scripts/dev/e2e.sh furnace_smoke`

Current status:

- Mock runtime covers `craft_smoke` on CI.
- Mock runtime and real NeoForge runtime cover `craft_negative`, which asserts
  `station_too_far`, `missing_material`, `invalid_recipe`, empty output, and
  `stale_slot_ref` failure reasons through public MCP tools.
- Real NeoForge runtime now covers the first chest + crafting-table smoke:
  an oak log is seeded in a real chest block entity, moved through MineLink slot
  refs into the agent inventory, crafted through the server recipe registry into
  oak planks, taken from the output slot, and asserted by
  `observe.inventory`.
- Mock runtime and real NeoForge runtime cover `furnace_smoke`: raw iron and
  coal move from a visible chest into a visible furnace through public
  `container.move_stack` slot refs, dirt is rejected from the furnace fuel slot
  by server slot rules, the real NeoForge furnace processes through its vanilla
  block entity tick path, slot 2 is exposed only as an output slot, and
  `container.take_output` moves the resulting `minecraft:iron_ingot` into the
  FakePlayer-backed agent inventory.
- Mock runtime and real NeoForge `craft_smoke`, `furnace_smoke`,
  `create_smoke`, and `portal_coop` now assert that `container.open` first
  enters through the native `ServerPlayerGameMode.useItemOn` path for a recent
  visible reachable block ref before exposing the bounded MineLink slot
  snapshot. The reports also mark the body UI as `headless_server_agent`, so
  server_agent validation does not imply keyboard, mouse, screenshot, or
  client GUI perception.
- Mock runtime and real NeoForge `craft_smoke`, `furnace_smoke`,
  `create_smoke`, and `portal_coop` now assert that successful
  `container.move_stack` results include `slot_transfer.method` =
  `slot.safe_take_safe_insert`, proving this slice no longer writes source and
  destination slots only through MineLink-local `setItem` helpers. Furnace
  fuel moves additionally report `net.minecraft.world.inventory.FurnaceFuelSlot`,
  and furnace `container.take_output` reports
  `net.minecraft.world.inventory.FurnaceResultSlot` plus `slot.safe_insert`
  inventory insertion.
- Real NeoForge `craft_smoke` and `furnace_smoke` reports now include
  `inventory.source=fake_player` for the final inventory observation, proving
  that recipe output and furnace output are read back from the native
  server_agent body inventory rather than a Host-local or replay-local store.
- Real NeoForge `craft_negative` now fills all 36 FakePlayer inventory slots
  through public container slot refs before attempting `container.take_output`,
  and the output path returns structured `inventory_full` when no native player
  slot can accept the staged recipe output.
- Real NeoForge `craft_smoke` now stages `minecraft:oak_planks` by moving the
  selected ingredient from FakePlayer inventory slots into the opened native
  `CraftingMenu` grid slots through `Slot.safeTake`/`Slot.safeInsert`, refreshes
  the vanilla result slot, and exposes/takes the output through
  `net.minecraft.world.inventory.ResultSlot`. The replay asserts
  `crafting_transfer.output_source=native_crafting_result_slot`,
  `container.take_output.slot_transfer.source_slot_class=net.minecraft.world.inventory.ResultSlot`,
  and `slot.safe_take_inventory_safe_insert`.
- Real NeoForge `craft_smoke` now covers a repeated oak-planks path with
  `craft.quick_craft(count=2)`: the report records `planned_result_takes=2`,
  a native crafting grid stack of two `minecraft:oak_log`, two successful
  `ResultSlot`-backed `container.take_output` calls, the first take refreshing
  the output slot with one oak log still in the grid, and an intermediate
  FakePlayer inventory observation containing eight `minecraft:oak_planks`
  before the shaped stick recipe consumes two planks.
- Real NeoForge `craft_smoke` now also covers a shaped vanilla recipe after
  the repeated planks path: `minecraft:stick` is staged through Minecraft's
  `net.minecraft.recipebook.PlaceRecipe` placement logic, the native crafting
  grid records `minecraft:oak_planks` at grid indexes 1 and 4, the output is
  taken through `net.minecraft.world.inventory.ResultSlot`, and final
  FakePlayer inventory contains the shaped `minecraft:stick` output plus the
  remaining planks.
- Real NeoForge `craft_smoke` now also covers a bounded manual crafting-table
  click path after quick craft: public `container.click_slot` calls resolve
  recent inventory/grid slot refs, reject output-slot clicks, run
  `AbstractContainerMenu.clicked(..., ClickType.PICKUP, FakePlayer)`, expose
  the native menu cursor, place `minecraft:oak_planks` into grid indexes 1 and
  4 through `net.minecraft.world.inventory.CraftingMenu`, and take the
  resulting sticks through `net.minecraft.world.inventory.ResultSlot`.
- The real report records `native_interaction.menu_opened=false` and
  `native_interaction.menu_source=constructed_server_crafting_menu_after_use_item_on`
  for the headless crafting-table path: the visible/reachable block interaction
  still enters through `ServerPlayerGameMode.useItemOn`, but the server_agent
  does not claim a client GUI was opened.
- Real NeoForge `craft_negative` now observes the crafting table after a full
  inventory `container.take_output` failure and asserts that the oak-planks
  output remains observable, proving the failed take did not consume the native
  result slot output.
- This is not the full Gate 6 release surface yet. The native repeated
  crafting evidence currently covers oak-log to oak-planks and one vanilla
  shaped stick recipe, with bounded manual slot-click evidence only for the
  crafting table menu. Broader container/furnace menu click parity, shift-click
  and drag modes, modded recipe breadth, remainder item handling, and broader
  inventory-full edge cases still need separate implementation and real
  evidence.

### Gate 7: Create Adapter

Required:

- Create dependency remains optional for the core Mod but enabled for Create adapter test profile.
- `create.inspect_component` identifies depot, belt, press, shaft, cogwheel, wrench-relevant faces, speed/stress hints, and common blockage reasons.
- Agent can legally use a wrench or item on one reachable component.
- Agent can place an iron ingot onto a visible depot through `action.use` and
  observe a powered mechanical press produce `create:iron_sheet`.
- Agent can use an empty hand on that visible depot and take the pressed sheet
  into its inventory through the native player inventory path.
- Adapter does not expose `auto_build_factory` or global oracle tools.
- Ponder/JEI/overlay limitations are documented and returned as `unsupported_capability` where applicable.

Evidence:

- `bash scripts/dev/e2e.sh create_smoke` against mock.
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 MINELINK_ENABLE_CREATE=1 bash scripts/dev/e2e.sh create_smoke` against a real Create dev server.
- Fixture world with a visible material chest, a visible build anchor, Create
  shaft/wrench/iron-ingot materials, visible cogwheel/depot/mechanical
  press/belt fixtures, a powered creative-motor-backed press above the depot,
  and a placed Create component produced through public MCP tools.

Current status:

- Partial real coverage exists for optional Create dependency loading, a real
  material chest containing Create items plus an iron ingot,
  chest-to-inventory transfer, native `block.place` of `create:shaft`, bounded
  semantic inspection for shaft, cogwheel, depot, mechanical press, and belt,
  unsupported client-only capability hints for `create_ponder_overlay`,
  `jei_recipe_overlay`, and `client_goggle_overlay`, wrench use through the
  same FakePlayer-backed vanilla interaction path as other item use, non-zero
  powered press speed, and a real pressing result observed as
  `create:iron_sheet` on the depot. The replay now asserts the `action.use`
  result payload for iron-ingot insertion into the depot and the empty-hand
  pickup payload before accepting FakePlayer inventory ownership of the sheet.
  The real NeoForge report includes `inventory.source=fake_player` with
  `create:iron_sheet` and `create:wrench` in hotbar slots after the run.
- This is not the full Gate 7 release surface yet. Belt transport behavior,
  multi-step Create recipes, broader kinetic-network diagnostics, and broader
  Create component parity still need separate implementation and evidence.

### Gate 8: Multi-agent, A2A, and Social Runtime

Required:

- Multiple server_agent bodies can coexist with human players.
- Nearby speech, shout, notice board, orders, letters/telegraph placeholders, and audit events are persisted.
- Distance discovery exposes only locally observable agents/events.
- A2A and social messages are rate-limited and attributable.
- Human player and agent chat interaction works in a real server.

Evidence:

- Two-agent fixture.
- Three-agent portal cooperation fixture.
- Human + agent coexistence demo.
- Event timeline and replay.

Current status:

- Mock runtime and real NeoForge runtime cover `portal_coop`, which births
  three `server_agent` sessions, opens one shared chest, moves obsidian and
  flint-and-steel through public MCP container tools, places a 14-block
  obsidian frame with `block.place`, ignites it with `action.use`, and asserts
  that one agent observes `minecraft:nether_portal`.
- The same portal cooperation smoke now also proves one nearby local social
  event path: `builder_a` emits `chat.say_local`, `builder_b` observes it
  through `observe.events`, and the runtime filters event visibility by agent
  distance rather than exposing a global timeline.
- The portal cooperation replay now also exercises a physical notice board:
  each participating agent must first observe a reachable `minelink:notice_board`
  block ref, `builder_a` posts through `notice.post`, and `builder_b` reads the
  same board through `notice.observe`. There is no global notice listing or
  Host-side mailbox.
- Public social event payloads expose coarse visibility cues only, such as
  `visibility` and `distance_band`; exact source coordinates, event radius, and
  observer distance remain runtime-internal. The replay assertions now verify
  that those coarse fields are present while position/radius/recipient internals
  are absent.
- Notice board payloads follow the same redaction rule: assertions require
  `visibility`, `distance_band`, and `board_id`, while forbidding source
  position, board position, radius, observer distance, and recipient internals.
- The portal cooperation replay also asserts that all three builders contribute
  successful `block.place` actions and that portal ignition reports
  `activated: "minecraft:nether_portal"` rather than relying only on a generic
  successful `action.use` call.
- This is not full Gate 8 acceptance yet. Human chat interaction, restart-durable
  A2A/social persistence, distance-limited social discovery, orders,
  letters/telegraph placeholders, and broader rate-limited agent-to-agent
  messaging still require separate implementation and evidence.

### Gate 9: Frontier Society and Director

Required:

- `/minelink birth [seed_prompt]` creates a body with initial profile, needs, beliefs, capabilities, and empty relationships.
- Director reads event timeline, agent locations, current goals, social graph, inventory/resource pressure, and replay.
- A small society can run without fixed job scripts and show at least one resource discovery -> communication -> response -> cooperation/trade chain.
- Roles are observed from behavior, not hardcoded at birth.

Evidence:

- 10-agent society run.
- Director replay artifact.
- Relationship/economy metrics export.

### Gate 10: Install and Product Packaging

Required:

- Server admin install: put Mod jar in `mods/`, configure endpoint/admission, start server.
- Agent user install: install Host, configure MCP stdio, connect to server.
- Local LAN install: put Mod in local Minecraft profile, explicitly enable LAN agent access, connect Host.
- Installer path is documented and later automated.
- Mod auto-launching Host is optional and must require explicit user consent.

Evidence:

- Fresh clone install test through `scripts/dev/install-smoke.sh`.
- Fresh server install test.
- MCP config snippet.
- Cross-platform path notes.

Current status:

- `scripts/dev/install-smoke.sh` clones the committed ref into a separate
  checkout, runs `npm ci`, runs `bash scripts/dev/verify-agent-task.sh --scope
  fast --base HEAD`, and writes
  `.minelink-dev/install-smoke/install-smoke-report.md`.
- `scripts/dev/bootstrap-prebuild.sh` is the shared devcontainer/Ona bootstrap
  entry point with `--prebuild` and `--light` modes. Ona cloud prebuilds invoke
  the prebuild mode through the `.ona/automations.yaml` `bootstrap-prebuild`
  task with `triggeredBy: prebuild` and `prebuildRequiresSuccess: true`; the
  devcontainer `postCreateCommand` uses `--light` so normal environment creation
  does not rerun the full NeoForge warmup before a Codex task can start. The
  bootstrap installs OS tools when missing, verifies
  Node/npm/Python/Java/ffmpeg/Xvfb, installs the X11/OpenGL/audio libraries
  needed by the Minecraft client recorder when apt is available, runs `npm ci`
  when needed, and writes ignored local
  `mod/neoforge/run/eula.txt` and `server.properties` files so the real server
  can start without another setup step. Prebuild mode additionally runs
  TypeScript build/typecheck and the NeoForge Gradle build so Java, Gradle,
  Minecraft, and NeoForge dependency caches are warm, then prunes
  checkout-local `.gradle` and `mod/neoforge/build` outputs before the Ona
  snapshot while preserving user-home npm/Gradle caches. It does not start the
  server or print secret values.
- The report records the sanitized remote, source ref and commit, dirty-source
  decision, Node/npm/Git/Java/OS versions, exact command exit codes, log path,
  and copied agent-task summary when available.
- `.github/workflows/install-smoke.yml` runs the same fresh-clone proof for
  install/workbench/bootstrap changes and uploads
  `minelink-install-smoke-evidence`.
- `.github/workflows/devcontainer-image.yml` builds `.devcontainer/Dockerfile`
  and publishes `ghcr.io/ninot1quyi/minelink-devcontainer` with Node 22, Java
  21, GitHub CLI, `ffmpeg`, `Xvfb`, recorder X11/OpenGL/audio libraries, npm
  cache, and Gradle user-home cache. Branch
  builds publish immutable `sha-*` tags plus sanitized branch tags; `main`
  additionally publishes `main` and `latest`. Immutable tags anchor evidence,
  while branch tags are moving cache sources for the matching work line. This
  is a reproducible cache-prewarm path, not a hand-uploaded local container.
  The image workflow trigger is limited to image-sensitive paths plus the image
  access checker, so ordinary agent-factory, Linear watcher, dispatch, or
  video-review script changes do not rebuild the GHCR image or force a new
  prebuild baseline. The image must not contain EULA files, tokens, secrets,
  `mod/neoforge/run` state, or local generated server output. Because NeoForge
  project-local `.gradle` and generated workspace outputs are
  checkout-sensitive, this image does not replace the Ona prebuild hard gate and
  can remain the default only while Docker smoke and Ona prebuild readback keep
  passing.
- `scripts/dev/check-devcontainer-image-access.sh` verifies the GHCR manifest
  path and optionally pulls/runs the published image with Docker to check Node,
  npm, Python, Java, `ffmpeg`, npm cache, and Gradle module cache availability.
  The devcontainer image workflow runs this checker with authenticated package
  access and `--docker-smoke` after publishing the immutable `sha-*` tag, then
  includes `.minelink-dev/reports/devcontainer-image-access.md` in the GitHub
  Step Summary. This proves image pull/runtime readiness for that environment;
  it does not prove Ona Platform Codex execution, Minecraft startup, or product
  install acceptance.
- `.github/workflows/ona-prebuild.yml` is the CI fallback for automatic
  environment baseline readiness. It runs on manual dispatch and
  environment-sensitive changes to `codex/minelink-mvp-engineering`, not on
  ordinary product-code, package, or source commits. The workflow cancels active
  stale project prebuilds, triggers a fresh Ona prebuild with a default 45-minute
  platform timeout, wraps individual Ona CLI calls in a short timeout, polls
  `ona prebuild get` until completion, writes phase-history and phase-duration
  summary artifacts, and uploads `minelink-ona-prebuild` evidence. It records
  the pre-refresh prebuild list and latest completed baseline before triggering
  a new refresh. If a new refresh fails or stalls after that point, the report is
  `partial` and the workflow exits successfully only when a completed baseline
  already exists; the failed refresh is not accepted as a new baseline. If no
  completed baseline exists, the workflow fails closed. Local readback on
  2026-06-21 showed completed baselines
  `019eeb54-6320-7a1c-ab91-be9544a5eb82`,
  `019eeb62-6201-70c9-8bfc-77e334213155`, and
  `019eebd9-8f2b-717b-8a71-f8275561edb3`. The current accepted CI refresh
  baseline is `019eec3a-85b2-75e7-a5f3-db79a7a2ce2c` from run
  `27919007816`; it completed with `PREBUILD_PHASE_COMPLETED:100`, a
  7.75 GB snapshot, and a 15m10s observed workflow duration. Overlapping manual
  prebuilds that were later cancelled, including
  `019eeb05-69dc-75d4-9ffa-a6769945ae50`, are not accepted as usable baseline
  evidence.
- Failed or timed-out `.github/workflows/ona-prebuild.yml` refreshes now call
  `scripts/dev/capture-ona-prebuild-logs.sh` before failing the workflow. The
  resulting `ona-prebuild-log-capture.md` records whether raw environment logs
  or the authenticated prebuild log URL were preserved before the transient Ona
  environment was removed. The workflow captures logs when stopping or
  snapshotting starts, keeps any successful early log capture if later
  cancellation makes the transient environment unavailable, and cancels
  snapshotting refreshes that exceed
  `MINELINK_ONA_SNAPSHOT_STALE_MINUTES` (15 minutes by default), so stuck
  platform snapshot saves become explicit evidence instead of hanging CI for
  the full prebuild timeout or a stuck Ona status-poll command.
- 2026-06-21 run `27915819949` / prebuild
  `019eebc5-23ae-754f-b0bf-6cec6de45668` showed the environment startup and
  bootstrap path were not the blocker: phase evidence recorded `running` for
  about 3m01s, `stopping` for about 1m02s, then `snapshotting` for about 13m06s
  with 0% snapshot progress before manual cancellation. This is prebuild
  stability evidence, not an accepted baseline.
- 2026-06-21 run `27916382301` / prebuild
  `019eebd9-8f2b-717b-8a71-f8275561edb3` passed on commit
  `59972e0f83b5ca0fa524ff50bca39b8b7af2e393`. The phase summary recorded about
  11m09s total observed time, including about 2m01s running, 2m03s stopping,
  and 6m04s snapshotting, with final `PREBUILD_PHASE_COMPLETED:100` and a
  6.22 GB snapshot. The workflow also preserved a 32 KB environment log capture
  while the transient environment was still available.
- 2026-06-21 run `27917165575` / prebuild
  `019eebf6-2c0c-7b40-8d59-7516ada89b62` reproduced the same platform-side
  snapshot stall after the GHCR image and devcontainer startup had already
  completed. Ona logs showed GHCR metadata resolution in about 0.3s, layer pull
  completing in about 20s, the derived devcontainer image build completing in
  about 1m31s, the devcontainer becoming ready in about 2m07s, and MineLink
  prebuild tasks completing before snapshot preparation. The prebuild then
  remained in `PREBUILD_PHASE_SNAPSHOTTING` and was cancelled as a stale
  refresh. This is negative stability evidence; the usable baseline remains
  `019eebd9-8f2b-717b-8a71-f8275561edb3` until a newer completed refresh is
  read back.
- 2026-06-21 run `27917523419` / prebuild
  `019eec03-390c-7b19-a819-e7e774e67a14` passed on commit
  `c7f538f1c141e833045300ebb1678641d47331d2`. The workflow completed in
  13m43s, the prebuild status completed at
  `2026-06-21T21:21:43.275840005Z`, and `ona prebuild get` reported
  `PREBUILD_PHASE_COMPLETED:100` with snapshot size `7756316672` bytes. This
  proves the manual/path-filtered CI refresh path can complete with timeout,
  phase history, artifact upload, and stale-refresh cancellation logic enabled.
- 2026-06-21 run `27918199396` / prebuild
  `019eec1c-2959-79b0-a2a0-bf598dae41db` failed on commit
  `dccd70d2992b88e8e2880eda12a6c271c4616c1e` after the workflow adopted the
  GHCR prewarmed devcontainer image. The Devcontainer Image workflow for the
  same commit built and pushed the image in about 5m20s and completed the Docker
  smoke pull/runtime check in about 36s. Ona logs then showed the prebuilt
  devcontainer was used, container startup took about 42s, MineLink prebuild
  tasks finished, and snapshot preparation took about 0.36s. The failing phase
  was platform snapshot storage: the refresh stayed at
  `PREBUILD_PHASE_SNAPSHOTTING:0` for about 15m10s before stale-refresh
  cancellation. This is negative prebuild refresh evidence; the accepted
  baseline remains `019eec03-390c-7b19-a819-e7e774e67a14`.
- 2026-06-21 run `27919007816` / prebuild
  `019eec3a-85b2-75e7-a5f3-db79a7a2ce2c` passed on commit
  `efbbdb0a1c7cb2611d8dadec1bf35593f7e472be` with the completed-baseline
  fallback logic present. The run first recorded existing baseline
  `019eec03-390c-7b19-a819-e7e774e67a14`, then completed the new refresh with
  `PREBUILD_PHASE_COMPLETED:100`, `snapshotSizeBytes=7751598080`, and
  completion time `2026-06-21T22:23:43.281513712Z`. The phase summary observed
  about 15m10s end to end: about 5m03s running, 1m33s stopping, and 7m04s
  snapshotting. This is the current accepted Ona prebuild baseline evidence.
- `scripts/dev/check-platform-codex-evidence.mjs` is the evidence check for Ona
  Platform Codex readbacks, and `scripts/dev/run-agent-factory-stage.mjs` is
  the Ona finalizer wrapper. Public Ona automation `agent` steps currently start
  the default Ona Agent (`Ai-Automations Action Execution`) rather than the
  Codex conversation-menu option, so the checked-in Ona AI automation now fails
  closed unless a separate proven Platform Codex session has already written
  platform selector/API evidence. The grouped task wrappers still run guarded
  stage lists sequentially and write per-stage reports. Missing implementation
  or verifier readback, stale readback, or readback bound to the wrong
  task/branch/commit writes
  `platform-codex-evidence.md` plus an
  `agent-factory-stage-<stage>.md` blocked report and exits 0 so the Ona
  execution can terminate with readable evidence instead of lingering in a
  failed Codex task loop. The wrappers still skip validation, acceptance video
  rendering, video release, Linear final status, PR creation, and final chain
  reporting until the required Platform Codex readbacks pass. This is
  automation-chain evidence only and does not upgrade MineLink product gates.
- `.devcontainer/devcontainer.json` now uses
  `ghcr.io/ninot1quyi/minelink-devcontainer:codex-minelink-mvp-engineering` as
  the default image and uses `scripts/dev/bootstrap-prebuild.sh --light` for
  normal `postCreateCommand` startup. The full Node/TypeScript and NeoForge
  Gradle warmup remains the Ona prebuild hard gate, not a per-task startup cost.
  Run `27919007816` is the current fresh Ona prebuild readback for this path.
- `.ona/automations.yaml` now provides Ona-native environment tasks for docs,
  fast verification, real NeoForge guard smoke, and acceptance artifact
  rendering plus video-review request preparation and a separate video-release
  check.
  `ona/ai-automations/minelink-agent-factory.yaml` defines the Ona CLI
  implementation/verifier handoff plus guarded finalizers for Linear status
  sync, verification, evidence summaries, acceptance video rendering, video
  review request preparation, release gating, and PR creation after the
  implementation work is performed by a proven Ona Platform Codex session and
  the MP4 is reviewed by a separate Platform Codex verifier.
- The finalizer now fails closed before validation/PR finalization unless
  `scripts/dev/report-agent-factory-chain.mjs` can read accepted implementation
  evidence from `.minelink-dev/reports/ona-codex-implementation-session.md`.
  The readback must identify `Agent mode: Ona Platform Codex`,
  `Identity: I am Codex running in Ona Platform Codex`, `Platform evidence`, a
  `Session id`, `Result: passed`, `Task id`, `Branch`, and `Commit`; generic
  Ona automation, SSH, task, stale local artifact, wrong branch, wrong commit,
  self-reported identity, or default-agent output is not accepted for the
  implementation edge. The identity line is a liveness diagnostic for the Ona
  Platform Codex session, not acceptance evidence by itself. The separate video
  verifier must likewise provide task/branch/commit-bound
  `.minelink-dev/reports/ona-codex-video-verifier-session.md` in addition to
  the hash-checked `video-review.md` and release gate.
  A 2026-06-22 policy retest disabled the default Ona Agent and reran a minimal
  read-only `ona ai automation execute` canary. The CLI still called
  `AgentService/StartAgent` with agent id
  `00000000-0000-0000-0000-000000007100` and name
  `Ai-Automations Action Execution`, then failed with
  `failed_precondition: agent is disabled by organization policy`. This is
  negative launch evidence: policy gating does not switch public automation
  agent steps to Codex.
  `scripts/dev/start-ona-platform-codex.mjs` now captures the documented Ona
  AgentService candidate path for programmatic Codex launch: `StartAgent` with
  an explicit Codex `agentId` and `codexSettings`, `SendToAgentExecution` for
  the task prompt through `userInput.inputs[]` plus a deprecated
  `userInput.text` compatibility mirror, and `GetAgentExecution` for
  `spec.agentId` plus
  Codex-settings readback. The launcher now requests `AGENT_MODE_GOAL`, the
  explicit persistent Goal selector; generated task readbacks
  must include `Agent execution mode: AGENT_MODE_GOAL`, while one-shot
  `AGENT_MODE_EXECUTION` evidence remains insufficient for factory delivery.
  A Goal-mode readback that remains `PHASE_PENDING` is now a blocked
  handoff, not accepted launch evidence. It proves only that AgentService has an
  execution record; it does not prove that Codex has started executing the
  task prompt. A successful prompt-send response is also not enough. For
  Goal-mode prompt sends, the launch readback must show token usage,
  iteration count, current activity, or current operation before it is treated
  as a live Codex handoff. If `GetAgentExecution` reports an LLM provider or
  unauthenticated-provider warning, the edge is blocked and downstream branch,
  finalizer, verifier, and PR steps must not be used as release evidence. Task
  modes now publish this early blocker as `blocked-platform-codex-auth` for
  unauthenticated Codex LLM failures or `blocked-platform-codex-launch` for
  other Platform Codex launch/readback failures, then refresh the chain report
  and status writeback before any finalizer or video publication step can run.
  consumption still ultimately requires the task-bound branch/report readback.
  When a Goal-mode session reaches active readback but no task report appears,
  the workflow now creates an AgentService conversation token and uploads
  sanitized Ona conversation/transcript diagnostics via
  `scripts/dev/fetch-ona-agent-execution-readback.mjs`. Those diagnostics are
  blocker-localization evidence only, not accepted implementation evidence.
  Empty transcript readback is blocked evidence, not a pass. The task-report
  fetcher now also checks the recorded Ona environment for the expected report,
  worktree changes, and active Minecraft/NeoForge/validation/recording
  processes; if all three remain absent for the no-progress window, the
  workflow fails closed instead of waiting for the full branch timeout.
  This is not accepted product evidence yet. It does not replace the
  task-bound implementation and verifier readback files required by the
  finalizer. The launcher now ignores stopped historical Ona
  environments unless `MINELINK_ONA_ENVIRONMENT_ID` explicitly names one; without
  a running environment, canary workflows create a task environment from the
  completed project/prebuild baseline and wait for it to reach running before
  calling `StartAgent`. GitHub Actions run
  `27928149039` proved the
  repository-secret `ONA_TOKEN` path, policy readback, `StartAgent`,
  `SendToAgentExecution`, and `GetAgentExecution` for the allowed Codex app
  agent id. The readback reported a matching `spec.agentId`, present
  `codexSettings`, `PHASE_STOPPED`, `SUPPORTED_MODEL_OPENAI_AUTO`,
  conversation URLs, and token-usage counters. It did not expose structured
  `status.outputs`, so this upgrades only the `platform_codex_launch` chain
  edge; the downstream implementation session, validation, acceptance MP4
  review, PR finalization, and status writeback remain unaccepted.
  The next probe slice adds `implementation-canary` mode to
  `.github/workflows/ona-platform-codex-probe.yml`. That mode sends a
  docs-only task to the accepted AgentService Codex execution, expects the
  session to push only `docs/agent-factory-canaries/<task>.md` on a
  task-bound branch, and then runs
  `scripts/dev/fetch-platform-codex-canary.mjs` to combine the API readback,
  remote branch head commit, and canary markers into the canonical
  `.minelink-dev/reports/ona-codex-implementation-session.md`. This is still
  chain handoff evidence only; it does not prove a MineLink product feature,
  video review, PR release, or `product-accepted` gate. The canary file alone
  must not be used as the final readback because the canonical `Commit:` value
  is the fetched branch head.
  GitHub Actions run `28068769134` exposed a delivery-chain blocker in this
  slice: the Platform Codex environment started from the project default branch
  instead of the task target branch, so the branch readback timed out and the
  guarded salvage correctly refused to push from the wrong branch. The workflow
  now prepares the target branch from the source commit before launch, and the
  launcher aligns new Ona task environments to that branch before `StartAgent`.
  This branch preparation is only a handoff anchor, not implementation evidence.
  If Goal-mode Codex writes the exact canary file or task report but does not
  commit/push, the fetcher can recover only that evidence file from the
  recorded Ona environment after checking the expected branch, task, session,
  Goal-mode, pass, validation, and boundary markers. Task-report salvage refuses
  unexpected changed files outside the expected report path and agent-factory
  canary notes, and the acceptance evidence ledger after expanding untracked
  directories to concrete file paths; deletions are refused. The recovered state
  is accepted only after the GitHub branch readback succeeds; this recovery does
  not release arbitrary product code, video evidence, or a product acceptance
  gate.
  The next canary slice adds `full-chain-canary` to the same workflow. It runs
  the implementation canary, renders trace-driven acceptance artifacts, starts
  a separate Platform Codex `video-verifier-canary` session, fetches
  `docs/agent-factory-canaries/<task>-video-verifier.md`, and uses
  `scripts/dev/fetch-platform-codex-video-verifier.mjs` to write
  `.minelink-dev/reports/ona-codex-video-verifier-session.md` plus the local
  hash-checked `video-review.md`. This can upgrade only the
  `acceptance_video -> video_verifier` automation-chain edge for a canary task;
  it does not prove real product implementation, real Minecraft behavior, or
  any `product-accepted` gate. The same workflow can now be run with
  `create_pr=true` to prove the next automation-chain edge: after the release
  gate passes, it calls `scripts/dev/create-agent-factory-pr.mjs`, creates or
  updates a draft PR from the canary branch, writes
  `.minelink-dev/reports/agent-factory-pr.{md,json}`, and refreshes the chain
  report with `--pr-url`. That edge requires the `AGENT_FACTORY_GITHUB_TOKEN`
  repository secret because the default Actions `GITHUB_TOKEN` can be blocked
  from creating pull requests. The workflow then calls
  `scripts/dev/wait-agent-factory-pr-ci.mjs` to wait for the PR check rollup,
  writes `.minelink-dev/reports/agent-factory-pr-ci.{md,json}`, and refreshes
  the chain report with `--ci-url`. The PR CI wait path now de-duplicates
  repeated check runs by workflow/check name and keeps the latest run, so stale
  push-event checks for the same head commit are reported as ignored duplicates
  instead of blocking the PR edge. That remains chain evidence only; status
  writeback and human acceptance are separate downstream gates.
  After uploading the fail-closed automation spec, remote canary execution
  `019eed14-ed44-7df4-9212-8e1122a7858c` completed with
  `WORKFLOW_EXECUTION_PHASE_COMPLETED`, `doneActionCount=1`, and task-only
  steps. That proves the guard no longer starts the disabled default Agent, but
  it remains chain evidence only and does not prove Platform Codex
  implementation.
- `.github/workflows/agent-factory-dispatch.yml` provides the repository source
  dispatcher for agent-ready GitHub issues plus a scheduled/manual Linear
  polling fallback. It uses `scripts/dev/dispatch-agent-factory.mjs` and
  `scripts/dev/watch-linear-agent-tasks.mjs` to start the shared Ona
  automation, wait briefly for `ona ai automation executions get`, and write
  `.minelink-dev/reports/ona-automation-execution.{md,json}` when an execution
  id is available. The workflow now also passes
  `--cancel-ona-execution-on-timeout`, so a non-terminal Ona execution after the
  bounded readback window is cancelled and recorded as `timed_out_cancelled`
  only when no action is actively running. If an agent action is still running,
  the execution is recorded as `timed_out`, the exposed session id is preserved,
  and the agent remains alive for follow-up monitoring. GitHub Actions run `27920128911`
  proved this GitHub issue
  entry path against issue #7: Ona execution
  `019eec65-c9d3-740c-ba01-2460c0b5bb24` completed with
  `WORKFLOW_EXECUTION_PHASE_COMPLETED`, `failedActionCount=0`, session
  `3bdd290e-1ae4-4b5c-b4ee-b6ee14114c23`, and chain progress 31%. This
  upgrades the repository-to-Ona execution edge to real automation evidence;
  it does not prove the required Ona Platform Codex implementation session.
  `scripts/dev/report-agent-factory-chain.mjs` records the issue-to-PR nodes,
  edges, first blocker, and remaining percentage. `completed_with_failed_actions`
  is partial bridge evidence only:
  it proves the guarded Ona finalizer ran and failed closed, not that Ona
  Platform Codex implemented the task. This is delivery-chain evidence only and
  does not prove Minecraft product behavior.
- `scripts/dev/setup-linear-agent-factory.mjs` is the repeatable Linear setup
  entry point for the `MineLink` project, required agent-factory labels, and
  workflow states. Local readback on 2026-06-21 created the Linear project
  `https://linear.app/ninotquyi/project/minelink-163d36d60652`, the missing
  `gate:*` and evidence-status labels, and workflow states from `Triage` through
  `Blocked`; the report is
  `.minelink-dev/reports/linear-agent-factory-setup.md`.
- The Linear watcher now treats `blocked` as a real dispatch blocker instead of
  dropping that label when it calls the shared dispatcher. Local negative
  readback against `NIN-7` wrote
  `.minelink-dev/reports/linear-watch-nin7-blocked.md` with `Skipped count: 1`,
  `reason=blocked_label`, and `Dispatched count: 0`.
  GitHub Actions schedule run `27920492296` proved the Linear path can select
  `NIN-8` and start Ona execution `019eec73-6138-7929-ae90-06039b6a90d3`, but
  also exposed that repeated schedules can duplicate unresolved dispatches and
  that a 120-second readback window can time out before the guarded finalizer
  reaches its terminal phase. Direct Ona readback later showed that execution
  completed with `failedActionCount=1`, which is expected until Platform Codex
  implementation evidence exists. The watcher now skips started/In Progress/In
  Review issues and, after a successful non-dry-run dispatch, writes an
  `In Progress` Linear status plus a dispatch-boundary comment. That prevents
  schedule spam while preserving the fail-closed Platform Codex readback guard
  for validation, video release, PR, and product acceptance.
  GitHub Actions run `27920695755` proved the Linear status writeback path:
  `NIN-8` was updated from `Ready for Agent/unstarted` to `In Progress`, with
  comment `78d49cc3-6bb6-4fd4-b0d9-61d708fdc6d5`, after dispatching Ona
  execution `019eec7b-5a90-7ee8-a7d9-83ec135f759f`. That execution started a
  workflow environment from accepted prebuild
  `019eec3a-85b2-75e7-a5f3-db79a7a2ce2c` and a Codex Exec Agent session, but
  the conversation log showed the Platform Codex evidence gate failing because
  `.minelink-dev/reports/ona-codex-implementation-session.md` was missing. Ona
  did not close the automation execution after that failed command, so it was
  cancelled and the workflow environment was stopped after evidence capture.
  Follow-up run `27920953104` proved duplicate prevention: `NIN-8` was skipped
  with `reason=active_state_In_Progress`, `Candidate count: 0`, and
  `Dispatched count: 0`.
  GitHub Actions run `27921207270` then proved the GitHub dispatcher can start
  the updated guarded finalizer, but its 240-second CI readback timed out while
  the Ona execution was still running. Direct Ona readback showed execution
  `019eec8e-b2d5-7d05-8197-ce41b7f8ec48` finished about 4m43s after start with
  `WORKFLOW_EXECUTION_PHASE_COMPLETED` and `failedActionCount=0`. The
  dispatcher readback window is now 600 seconds. That follow-up used a single
  `--stage all` task to reduce repeated task scheduling overhead while
  preserving per-stage fail-closed evidence reports.
  GitHub Actions run `27921514822` proved that follow-up path on commit
  `6c642e8`: issue #7 dispatch completed in about 1m13s, Ona execution
  `019eec9a-4d83-7d71-91a9-615fb2c5722c` reached
  `WORKFLOW_EXECUTION_PHASE_COMPLETED` with `failedActionCount=0`, and
  `.minelink-dev/reports/ona-automation-execution.md` recorded 12 readbacks.
  The resulting chain report was still correctly blocked at
  `ona_automation -> implementation_codex` because no accepted
  `.minelink-dev/reports/ona-codex-implementation-session.md` was present.
  A later issue #7 canary exposed an execution/session but the Ona UI showed the
  running action was the default Agent backed by Claude, not Codex. That is
  negative launch evidence: a default agent can echo the Codex identity line but
  must not satisfy the Platform Codex edge. After the default Ona Agent policy
  was disabled, a new CLI canary failed at `StartAgent` with
  `agent is disabled by organization policy`, proving the policy does not make
  automation fallback to Codex. The current factory slice therefore removes
  generic automation agent launch from the acceptance path and keeps the chain
  blocked until a documented or externally verified Codex launch writes platform
  evidence. Remote execution `019eed14-ed44-7df4-9212-8e1122a7858c` proves the
  updated fail-closed remote factory can complete task-only wrappers without
  starting the disabled default Agent. This is still not product-accepted until
  a real dispatch proves implementation, validation, MP4, separate verifier,
  release gate, PR, CI, and status writeback edges end to end. The current
  follow-up adds `scripts/dev/sync-github-status.mjs` and the workflow status
  sync steps so a GitHub-only canary is no longer blocked by an absent Linear
  issue; linked GitHub+Linear tasks still require both writeback reports. The
  final status is not written before PR video publication: the chain has a
  separate `pr_video_evidence` node, and missing GitHub user-attachments MP4
  playback writes `blocked-final-video-publication` instead of an optimistic
  final status.
- `scripts/dev/sync-github-status.mjs` writes
  `.minelink-dev/reports/github-status.{md,json}` and comments the linked
  GitHub issue or PR with the final or blocked chain evidence paths without
  exposing token values.
- `scripts/dev/trigger-agent-factory-full-chain.mjs` reads
  `.minelink-dev/reports/agent-factory-dispatch.json` and starts
  `.github/workflows/ona-platform-codex-probe.yml` in `full-chain-task` mode
  for the accepted issue task, preserving the issue-derived task requirements,
  validation scope, and scenarios. This is the current bridge from a GitHub or
  Linear issue source event into the guarded Platform Codex/video/PR/CI/status
  task chain. `full-chain-canary` remains available only for bounded
  diagnostics. The trigger must pass the issue-derived `validationScope` and
  `scenarios` into the full-chain workflow so NeoForge-required tasks produce
  NeoForge-backed video evidence instead of a docs-only finalizer run.
- The full-chain workflow now re-anchors reused task branches with
  `git push --force-with-lease` before launching Platform Codex, so stale
  canary or task-report evidence from an older AgentService execution cannot
  satisfy a new run. The launcher has a guarded `--task-implementation` prompt
  surface that requires explicit task requirements and writes
  `docs/agent-factory-task-reports/<task>.md`. The matching
  `scripts/dev/fetch-platform-codex-task-report.mjs` gate accepts real issue
  implementation evidence only when the report matches the current task,
  branch, AgentService session id, Goal mode, `Result: passed`, `Validation
  result: passed`, and the task-implementation boundary, with separate API
  evidence proving the configured Codex agent id and `codexSettings`.
- `scripts/dev/sync-linear-status.mjs` writes
  `.minelink-dev/reports/linear-sync.md` and lets Ona update Linear issues
  without exposing the key value in logs or repository files.
- `scripts/dev/render-acceptance-video.mjs` generates a trace-driven composite
  `.minelink-dev/reports/artifacts/acceptance-summary.md` and
  `.minelink-dev/reports/artifacts/acceptance.mp4` when explicitly requested.
  The MP4 must contain task evidence, not a static placeholder: the current
  renderer shows MineLink server-observation/assertion evidence on the left and
  command paths, tool timelines, and terminal log excerpts on the right. The
  renderer also writes `acceptance-video-origin.{json,md}`. A
  `github-actions-canary` producer is chain evidence only; ordinary GitHub CI
  no longer publishes PR video evidence. Final task acceptance requires the MP4
  to be produced in the Ona task/finalizer environment with producer
  `ona-task-finalizer`; the release gate must require that producer and the
  verifier must review that exact hash.
  For Minecraft/NeoForge product-video tasks, trace-driven MP4s remain
  diagnostic only. The accepted path is `MINELINK_RECORD_CLIENT=1` with a real
  NeoForge `runClient` recorder and
  `scripts/dev/render-client-capture-video.mjs`, which writes
  `clientGuiCapture=true`, `minecraftClientPanel=true`, and
  `mcpTerminalLogPanel=true` in `acceptance-video-origin.json`. These markers
  mean the final MP4 is the accepted 1280x720 composite: the left panel is the
  normal Minecraft client capture and the right third is terminal evidence from
  the matching MCP/server/agent logs. The composite is split-capture evidence:
  during the scenario the harness records only the Minecraft client window and
  writes MCP/server/client logs to files, then after the Java processes stop it
  renders those logs into the right-side terminal panel and combines both tracks
  into the final `acceptance.mp4`. This keeps terminal rendering and final MP4
  encoding from competing with the Minecraft client while the task is running.
  The recorder must also wait for the
  client-side `MineLink recorder client in world` marker and start ffmpeg after
  that marker, which records `clientWorldReady=true` and
  `captureStartedAfterWorldReady=true` in the origin and storage manifest. The
  server-side recorder helper must also log
  `MineLink recorder auto-follow active` after the spectator recorder is bound
  to the agent-following camera anchor; the renderer records this as
  `recorderAutoFollow=true`. The recorder client must also log
  `MineLink recorder client following server_agent` after it sees the visible
  `MineLink-*` player body. The default accepted view binds the client camera
  to that same player body in third person, rather than filming a proxy marker
  or a detached first-person recorder hand; the renderer records this as
  `recorderClientFollow=true`. The server-side recorder helper must
  log `MineLink recorder target moved server_agent` after the active
  `server_agent` visibly moves during the recorded scenario; the renderer
  records this as `recorderTargetMoved=true`. The recorder client must also log
  `MineLink recorder client target centered server_agent` after the recorder
  view has held the visible agent in frame; the renderer records
  this as `recorderClientTargetCentered=true`. The recorder client must also
  log `MineLink recorder client target visible server_agent` only after its
  selected camera mode is showing the visible `server_agent` player body; the
  renderer records this as `recorderClientTargetVisible=true`. The renderer
  must also set `recorderReadyBeforeScenario=true` before the first scenario
  work tool runs, so fast tasks cannot finish before the recorder has visibly
  locked onto the active `server_agent`. After the scenario passes, the harness
  must keep recording a visible work window and the renderer must set
  `recorderWorkCoverageAdequate=true` only when that window is at least the
  configured minimum. For submit-mode tools, the scenario report must also set
  `submittedActionsTerminalConfirmed=true`; a task submission or accepted action
  handle is not enough if the action remains queued or running. The renderer
  must also set `recorderWorkVisible=true`,
  derived from a passing scenario, at least one successful work tool
  (`action.*`, `container.*`, `craft.*`, `furnace.*`, or `create.*`), at least
  one passing final assertion, the recorder movement/follow/centered/visible
  markers, pre-scenario readiness, adequate work coverage, and terminal
  lifecycle confirmation for submitted actions. The renderer also writes
  `serverAgentTaskActionVisible=true` from the same condition, so merely seeing
  an idle `server_agent`, seeing the target only near the end, or submitting
  work without waiting for execution completion is not enough. For scenarios
  that complete `action.mine_visible_block`, the renderer also requires the
  server-side `MineLink recorder visible mining server_agent` marker and
  `recorderVisibleMiningMs >= recorderMinVisibleMiningMs` before it can set
  `recorderScenarioActionVisible=true`, so a clip that only shows the agent
  beside the final result, or only a sub-second mining flash, cannot pass as
  mining evidence. The video-oriented `mine_tree` replay still exercises
  container movement by taking the wooden axe from the shared chest, but submits
  the visible-log mining action with `tool_policy=empty_hand` and then verifies
  `action.status` reports terminal `completed`, `action_result.mined`, and
  `action_result.submitted_action=true`. This keeps the vanilla mining action
  visible in the final MP4 without extending the synchronous MCP request past
  its timeout-safe budget. The release gate
  must include
  `--require-client-gui-capture`; otherwise a static card, reports digest,
  server-observation-only video, loading screen, Mojang bootstrap capture,
  static/idle target, late-only target appearance, no-op task, occluded target,
  off-screen target following, or non-following client capture cannot be final
  acceptance evidence. The finalizer also produces `acceptance-storyboard.png` and
  `acceptance-storyboard.json` for model-readable visual QA, but those files
  are inspection aids only; the deliverable remains the playable
  `acceptance.mp4`.
  Headless recorder runs call `scripts/dev/ensure-client-recorder-deps.sh` when
  `ffmpeg`, `Xvfb`, or `python3-pil` is missing; this lets an older Ona task environment
  self-install recorder/storyboard packages when apt/sudo is available, or fail with an
  explicit recorder-dependency report instead of silently downgrading to a
  placeholder MP4. The recorder client resolves
  `MINELINK_RECORDER_CLIENT_GAME_DIR` to a task-local absolute path under the
  client-capture directory, writes a low-CPU recorder `options.txt` profile by
  default, and records the resolved width, height, fps, and profile in
  `logs/client-config.log`; this
  prevents NeoForge `runClient --gameDir` from depending on the Gradle working
  directory in Ona. The NeoForge run config must set ModDevGradle's
  `gameDirectory` property for that path instead of adding another
  `programArgument '--gameDir'`, because ModDevGradle already contributes the
  client gameDir argument.
- `scripts/dev/prepare-video-review-request.mjs` generates
  `.minelink-dev/reports/artifacts/video-review-request.md` with the current
  summary/MP4 hashes and the exact Ona Platform Codex verifier assignment. This
  request artifact is a handoff package only and does not release the task.
- `scripts/dev/run-ona-finalizer-artifacts.mjs` runs finalizer stages inside
  the Ona task environment, but after checking out the task branch it injects
  the current workflow/source-commit finalizer scripts. This keeps task content
  task-branch-bound while preventing stale orchestration scripts from producing
  mismatched review requests such as `Task id: local`. The injection also
  carries the matching `ARCHITECTURE.md` and client/server recorder helpers so
  architecture guard failures represent real task drift rather than a
  source-script/task-doc hybrid. The finalizer must pin the source ref to a
  commit before fetching the PR base or task branch, checkout the task branch
  at the full reviewed commit reported by the Platform Codex implementation
  readback, validate against the PR base branch rather than a hard-coded
  default, and return client-capture logs in its artifact bundle when video
  rendering fails. The injected recorder helper set includes the client
  recorder Java source and server recorder source so the in-world readiness
  marker, auto-follow marker, and stricter renderer checks are tested together.
  Video-required `neoforge` finalization avoids duplicate Minecraft startup:
  the `validate` stage runs fast repository checks, and the following
  client-recorder `render-video` stage produces the real NeoForge scenario
  report plus acceptance MP4 for that task. The recorder writes
  `logs/resource-snapshots.log` around dependency checks, client startup,
  ffmpeg startup, and shutdown so reviewers can diagnose CPU or process
  contention when the Minecraft capture is choppy.
  Following the reviewed commit is required for reused canary
  branches because the remote branch head can move after Goal-mode Codex
  finishes. Client-video failures must also write
  `reports/e2e-failure-log-tail.txt` with the recorder client config, client
  logs, and recorder logs last, so reviewers can diagnose Minecraft client
  startup failures from GitHub artifacts even when the stage output is
  truncated. The finalizer artifact bridge must use R2-first video transport
  when storage is configured: after `acceptance.mp4` is rendered inside Ona,
  the finalizer uploads it as candidate evidence, writes
  `.minelink-dev/reports/artifacts/video-storage-manifest.json`, and returns
  only small reports, logs, and manifests through the chunk bridge. The GitHub
  runner must download the MP4 from the manifest URL and fail closed unless
  the bytes match `mp4Sha256`. The fixed-size base64 chunk bridge remains for
  reports, client-capture logs, and no-R2 fallback; it is no longer the
  preferred large-`acceptance.mp4` transport. When a storage manifest exists,
  the chunk bridge must not include the final `acceptance.mp4`; a no-R2
  fallback may carry that final MP4 only under the chunk bridge byte cap. The
  chunk bridge must never include raw client MP4 files, recorder game
  directories, `node_modules`, `.git`, build/run outputs, or repository root
  files; those indicate a broken artifact boundary and must fail closed before
  long chunk downloads. Implementation finalization also
  runs `render-storyboard` after `render-video`; missing storyboard evidence
  blocks a client-GUI video review request, but storyboard evidence never
  releases a task without the MP4.
- Full-chain canaries must revalidate the implementation canary after the
  same-session video verifier writes its canary and before release upload. The
  current branch head must still contain current task/session-bound
  implementation evidence with `Result: passed`; a later Goal-mode overwrite to
  `Result: blocked`, stale markers, or mismatched session evidence must stop the
  release gate.
- NeoForge-backed `full-chain-task` runs must allow a longer
  implementation-report wait than docs-only tasks, because the Ona Platform
  Codex Goal session may still be reading MineLink context or running real
  Minecraft validation before it can push the report. A running session without
  branch evidence is not accepted as release evidence, but the runner must not
  stop it on the shorter docs timeout. A clean Ona environment with no expected
  report and no active validation or recording process is different from a
  slow NeoForge run; that is now treated as no-progress blocked evidence.
- The GitHub workflow uploads `acceptance-storyboard.png` and
  `acceptance-storyboard.json` as a separate small artifact for quick visual QA
  and model-readable frame inspection. That artifact is not a substitute for
  the final playable MP4.
- GitHub PR publication treats R2 as candidate video transport only. The
  final PR comment must use a `github.com/user-attachments/assets/...` MP4 URL
  so the GitHub page renders an inline video player. The optional
  `scripts/dev/upload-github-user-attachment.mjs` bridge requires
  `MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE`; if it is not configured, the
  workflow must record the skipped attachment upload and block the final PR
  video comment instead of publishing an R2-only link as final evidence. R2
  public URLs plus HTML `<video>` markup are not accepted as a substitute,
  because GitHub PR Markdown strips external video embeds. PATs and Actions
  tokens cannot be exchanged for a GitHub web session cookie; the bridge must
  either receive an explicit cookie secret or a pre-existing
  `github.com/user-attachments/assets/...` MP4 URL. The upload helper now
  receives the task PR URL, fetches that page with the explicit cookie secret to
  discover the issue/PR editor's upload-policy CSRF plus nonce values, uses
  repository-page `uploadToken` discovery only as a fallback, uses reusable
  multipart buffers for policy/object/finalize calls, avoids sending GitHub
  cookies to the object-store upload URL, does not treat ordinary page form
  authenticity tokens as upload-policy authority, and records retry attempts,
  cookie marker signals, page token signals, dynamic Chrome cookie readback
  signals, and a failure kind such as `github-web-cookie-rejected`,
  `github-attachment-upload-policy-csrf-missing`,
  `github-attachment-policy-failed`, or
  `github-attachment-finalization-failed` so this edge can be repaired without
  weakening the release gate. The upload step also prints the sanitized
  result, token-signal, cookie-signal, and HTTP-phase summary to the Actions log
  so the first blocker can be diagnosed even when the evidence artifact is hard
  to download. The supported refresh path is the local
  `npm run agent-factory:refresh-github-cookie -- --repository Ninot1Quyi/MineLink`
  helper, which opens a dedicated Chrome profile, waits for an explicit GitHub
  login, captures only `github.com` cookies from that profile, and writes the
  value directly to the GitHub repository secret without printing it. For
  PR-producing full-chain runs, the workflow also runs
  `scripts/dev/check-agent-factory-secrets.mjs` as an inline-video readiness
  report. The default `github_attachment_preflight=deferred` mode keeps this
  report non-blocking so finalizer/video-verifier evidence can still be
  produced before the final PR publication gate fails closed. Use
  `github_attachment_preflight=fail-fast` only when a cost-saving rehearsal
  should stop before Ona/Minecraft work if no attachment authority is available.
  `.github/workflows/github-user-attachment-smoke.yml` is the isolated CI
  transport smoke for this edge. It uploads a tiny diagnostic MP4 through the
  same user-attachment helper and can post the returned GitHub attachment URL to
  a PR. This smoke may prove refreshed cookie viability and GitHub player
  rendering, but it is not MineLink task acceptance evidence and cannot replace
  the Ona finalizer MP4 plus same-session Codex verifier gate.
- Minecraft client evidence must use the recorder `observer_follow` view by
  default, with enough distance and height to show the active `server_agent`
  performing the requested task. `target_third_person` is retained only as a
  diagnostic camera mode and must not be used as the default final PR evidence
  view, because it can make the video show an idle-looking body instead of the
  task work.
- `scripts/dev/check-video-review.mjs` blocks video publication unless a
  same-session Ona Platform Codex verifier subagent writes
  `.minelink-dev/reports/artifacts/video-review.md` with passing task/video
  match markers, the required Ona video producer, and current summary/MP4
  hashes. When a storage manifest is present, the gate also verifies the
  manifest hashes, producer, `clientGuiCapture`, `clientWorldReady`,
  `captureStartedAfterWorldReady`, `recorderAutoFollow`, and
  `recorderTargetMoved`, `recorderClientFollow`,
  `recorderClientTargetCentered`, `recorderClientTargetVisible`, and
  `recorderWorkVisible` markers. The gate
  fails final publication when the summary has `Scenario reports: 0`,
  `No scenario reports found`, no visible active-agent movement, no
  client-visible follow proof, no target-centered and target-visible framing
  proof, or no successful task work visible in the recorder-backed run; a pure text/card MP4 is never sufficient final evidence for
  video-required tasks. The gate writes
  `.minelink-dev/reports/artifacts/video-release-gate.md`.
- `scripts/dev/cleanup-ona-resources.mjs` stops task-bound Ona environments at
  terminal factory cleanup when they belong to the MineLink project and have no
  uncommitted workspace changes. The cleanup report is resource evidence only;
  it does not prove implementation correctness, video correctness, or product
  acceptance.
- Ona CLI bootstrap has been exercised against the MineLink cloud environment:
  `ona environment start`, `ona environment exec`, and
  `ona environment devcontainer rebuild` reached `/workspaces/MineLink` on
  branch `codex/minelink-mvp-engineering` and produced Node 22.16.0, npm 10.9.2,
  Python 3.12.13, and Java 21.0.11 inside the remote devcontainer. The first
  rebuild exposed a slow pinned-Python feature path, so the devcontainer and
  workbench guard now keep Python on the image or OS-provided path for future
  Ona rebuilds.
- This is real bootstrap evidence only. It does not prove server-admin mod
  installation, agent-user MCP configuration, LAN setup, cross-platform
  packaging, native Linear webhook enablement, a completed full-chain-task PR
  from a real issue, Ona native `pullRequest` success, acceptance MP4
  availability in every environment, same-session video verifier subagent
  completion, verifier access to the actual MP4 for real video-required tasks,
  inline GitHub user-attachment playback authority, or real NeoForge install
  acceptance.
- Earlier generic Ona Agent executions are process smoke only. They do not
  count as MineLink agent execution evidence because Ona work must select the
  Platform Codex agent mode.

### Gate 11: Security, Stability, and Release

Required:

- Public endpoints require admission, rate limit, max agents per owner, max total agents, audit, and revocation.
- No production endpoint is used by default; dev harness uses local worlds only.
- Dependency audit is clean or has explicit risk acceptance.
- Crash/failure modes produce structured reports, not only raw logs.
- Long-running soak test proves no unbounded action queue, runaway log growth, or orphan process leak.

Evidence:

- Security scan/audit output.
- Short mock and real NeoForge soak reports.
- Process cleanup report with post-run port checks.
- Queue/log-growth metrics report.
- PR checklist with all passing gates and known external blockers.

Current status:

- `scripts/dev/soak.sh` repeats selected e2e scenarios and writes
  `soak-report.json`, `process-cleanup.json`, and `queue-metrics.json`.
- Fast CI runs a short mock soak for `mine_tree`, `furnace_smoke`,
  `craft_negative`, `guard_boundaries`, `body_lifecycle`,
  `perception_shapes`, and `portal_coop`.
- The NeoForge workflow starts a real dedicated Minecraft server and runs a
  short real NeoForge soak for `furnace_smoke`, `craft_negative`,
  `guard_boundaries`, `body_lifecycle`, `perception_shapes`, and
  `portal_coop`.
- CI, Install Smoke, and NeoForge workflows run
  `scripts/dev/summarize-evidence.mjs` before artifact upload so PR reviewers
  can read `.minelink-dev/reports/ci-evidence-summary.md`, the install-smoke
  summary, and the GitHub Step Summary without manually traversing every report.
- Host tests cover Gateway token admission, public-bind startup refusal without
  a token, fixed-window rate limiting, and active MCP session caps.
- Runtime tests and the real `portal_coop` smoke cover the server-side
  per-owner `server_agent` cap: the fourth same-owner agent birth returns
  `agent_quota_exceeded` while the three-agent portal workflow remains valid.
- These reports are stability evidence, not full release acceptance. Gate 11
  still requires a longer real Minecraft soak profile before release.

## 3. Required Boundary Tests

Before a release tag, these must pass against mock and real runtime where applicable:

- Unknown dynamic tool returns `unknown_tool`.
- Unknown dynamic tool query returns `unknown_tool`.
- Runtime `tool.list` supports namespace/query filtering without leaking tools
  outside the requested namespace.
- Runtime `tool.query` returns full schema and failure reasons only for the
  requested tool.
- `online-mode=true` returns `unsupported_online_auth`.
- Mining without a current observation returns `unknown_or_unobserved_target`.
- Mining an expired ref returns `expired_ref`.
- Mining a visible but distant block returns `target_too_far`.
- Placing without inventory material returns `missing_material`.
- Daytime bed sleep through the native server path returns a structured
  rejection.
- Furnace output is exposed as an output slot and taken through
  `container.take_output`, not moved as a normal input/fuel slot.
- Furnace input/fuel slots reject items that the server slot rules do not allow.
- An opaque-wall fixture does not return the hidden diamond ore in
  `observe.scene`.
- Transparent, decorative, fluid, partial-occluder, and opaque fixture blocks
  carry expected vision tags without exposing the hidden diamond ore.
- Submitting too many concurrent actions returns `backpressure_queue_full`.
- Freezing a body cancels active submitted actions with `body_frozen`.
- A frozen body rejects world-changing actions while observation and lifecycle
  tools remain available.
- Restoring a frozen body is explicitly same-process and does not count as
  persistent restart recovery.
- Removing a body releases the owner quota and makes later self-observation
  return `agent_not_born`.
- Connected `tool_list` runtime failure is surfaced, not hidden by local fallback.
- Connected `tool_query` is forwarded to the runtime catalog, and runtime-only
  extension tool execution is forwarded after agent birth.
- Reconnecting to endpoint B stops using endpoint A.
- Create fixture returns structured component data or structured unsupported reason.
- Server log, Host log, agent log, and action trace are valid JSON/JSONL.

## 4. Current Baseline Evidence

The repository currently has an executable baseline for Gates 0, 3 partial,
4 partial, 5 partial, 6 mock/NeoForge partial, 7 mock partial,
8 portal-cooperation partial, and 11 dependency audit:

- `npm run build`
- `npm run typecheck`
- `npm test`
- `npm run ci`
- `bash scripts/dev/e2e.sh mine_tree`
- `MINELINK_MCP_TRANSPORT=http MINELINK_WORK_DIR=.minelink-dev/http-mine_tree bash scripts/dev/e2e.sh mine_tree`
- `bash scripts/dev/e2e.sh create_smoke`
- `bash scripts/dev/e2e.sh craft_smoke`
- `bash scripts/dev/e2e.sh craft_negative`
- `bash scripts/dev/e2e.sh guard_boundaries`
- `bash scripts/dev/e2e.sh body_lifecycle`
- `bash scripts/dev/e2e.sh perception_shapes`
- `bash scripts/dev/e2e.sh portal_coop`
- `bash scripts/dev/soak.sh --runtime mock --iterations 1 --scenarios mine_tree,furnace_smoke,craft_negative,guard_boundaries,body_lifecycle,perception_shapes,portal_coop`
- `npm_config_registry=https://registry.npmjs.org npm audit --audit-level=moderate`
- `./gradlew --no-daemon build` in `mod/neoforge`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh mine_tree`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 MINELINK_MCP_TRANSPORT=http MINELINK_WORK_DIR=.minelink-dev/neoforge-http-mine_tree bash scripts/dev/e2e.sh mine_tree`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 MINELINK_ENABLE_CREATE=1 bash scripts/dev/e2e.sh create_smoke`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh craft_smoke`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh furnace_smoke`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh craft_negative`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh guard_boundaries`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh body_lifecycle`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh perception_shapes`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh portal_coop`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/soak.sh --runtime neoforge --iterations 1 --scenarios furnace_smoke,craft_negative,guard_boundaries,body_lifecycle,perception_shapes,portal_coop`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 MINELINK_SKIP_BUILD=1 MINELINK_WORK_DIR=.minelink-dev/neoforge-catalog-furnace bash scripts/dev/e2e.sh furnace_smoke`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 MINELINK_MCP_TRANSPORT=http MINELINK_SKIP_BUILD=1 MINELINK_WORK_DIR=.minelink-dev/neoforge-catalog-http bash scripts/dev/e2e.sh mine_tree`
- `MINELINK_ACCEPT_EULA=1 MINELINK_SKIP_BUILD=1 bash scripts/dev/soak.sh --runtime neoforge --iterations 1 --work-dir .minelink-dev/soak/neoforge-catalog --scenarios create_smoke,portal_coop,guard_boundaries`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 MINELINK_ENABLE_CREATE=1 MINELINK_SKIP_BUILD=1 MINELINK_WORK_DIR=.minelink-dev/neoforge-native-inventory-create-rerun bash scripts/dev/e2e.sh create_smoke`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 MINELINK_SKIP_BUILD=1 MINELINK_WORK_DIR=.minelink-dev/neoforge-native-inventory-craft-negative-final bash scripts/dev/e2e.sh craft_negative`
- `MINELINK_ACCEPT_EULA=1 MINELINK_SKIP_BUILD=1 bash scripts/dev/soak.sh --runtime neoforge --iterations 1 --work-dir .minelink-dev/soak/neoforge-native-inventory-final --scenarios craft_smoke,furnace_smoke,create_smoke,portal_coop`
- `.minelink-dev/soak/<runtime>/soak-report.json`
- `.minelink-dev/soak/<runtime>/process-cleanup.json`
- `.minelink-dev/soak/<runtime>/queue-metrics.json`
- `.github/workflows/minecraft-neoforge.yml` starts a real NeoForge dedicated server for each real smoke scenario, runs a short real NeoForge soak, and uploads `.minelink-dev/` plus server logs.

Not yet accepted as full product:

- Persistent/restart-restorable server_agent lifecycle and human-player coexistence.
- Complete Create adapter behavior beyond the current real powered-press smoke.
- Production Gateway revocation, owner quota, and full audit hardening beyond
  the current token/rate-limit/session-cap baseline.
- Complete FakePlayer-backed container/crafting semantics on real server menus.
- Multi-agent social runtime.
- Director UI/service.
- Installer.
- Ona Platform Codex end-to-end task execution is not yet accepted. A real
  remote task still must prove the full issue -> dispatcher -> documented
  Platform Codex Goal launch with platform evidence -> task implementation
  report -> validation -> MP4 -> same-session verifier/subagent -> release gate
  -> PR -> inline playable video -> CI/status chain without manual repair.
- Long release-length soak/stability run on real Minecraft.
