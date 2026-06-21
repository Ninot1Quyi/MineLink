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
| Gate 10: Install and Product Packaging | real-partial | Fresh committed checkout bootstrap is scriptable through `scripts/dev/install-smoke.sh`; the default devcontainer now uses a registry/Docker-smoked GHCR cache-prewarm image; GitHub issue and Linear polling dispatchers can queue the shared Ona automation and write chain reports; CI now has a manual/path-filtered Ona prebuild refresh fallback for `codex/minelink-mvp-engineering`, but automatic Ona Platform Codex implementation/verifier sessions are not fully proven end-to-end; server admin install, agent user install, LAN install, and cross-platform packaging evidence remain incomplete. |
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
  smoke for those scenarios, renders a required trace-driven acceptance MP4,
  and uploads `.minelink-dev/` evidence.
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
- `action.move` now uses native entity movement in the NeoForge runtime and the
  guard replay asserts movement collision feedback; the latest real guard run
  reported `collision=true` with `moved_distance` lower than
  `requested_distance`.
- `action.mine_visible_block` in the real NeoForge runtime now keeps the
  existing observed-ref, TTL, reach, and block-id guards, then mines through the
  FakePlayer `ServerPlayerGameMode.destroyBlock` path. Drops are collected only
  from newly spawned nearby item entities through vanilla/NeoForge pickup hooks,
  and unbreakable or unharvestable targets return structured `blocked` or
  `wrong_tool` failures instead of synthetic inventory credit.
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
  `FluidState` classification without relying on random world vegetation.
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
  bootstrap installs OS tools when missing, verifies Node/npm/Python/Java/ffmpeg,
  runs `npm ci` when needed, and writes ignored local
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
  21, GitHub CLI, `ffmpeg`, npm cache, and Gradle user-home cache. Branch
  builds publish immutable `sha-*` tags plus sanitized branch tags; `main`
  additionally publishes `main` and `latest`. Immutable tags anchor evidence,
  while branch tags are moving cache sources for the matching work line. This
  is a reproducible cache-prewarm path, not a hand-uploaded
  local container. It must not contain EULA files, tokens, secrets,
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
  summary artifacts, and uploads `minelink-ona-prebuild` evidence. Local
  readback on 2026-06-21 showed completed baselines
  `019eeb54-6320-7a1c-ab91-be9544a5eb82`,
  `019eeb62-6201-70c9-8bfc-77e334213155`, and
  `019eebd9-8f2b-717b-8a71-f8275561edb3`; the newest completed snapshot was
  about 6.22 GB and completed in about 11 minutes. Overlapping manual prebuilds
  that were later cancelled, including
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
  `019eebd9-8f2b-717b-8a71-f8275561edb3`.
- `scripts/dev/check-platform-codex-evidence.mjs` is the finalizer guard for
  Ona Platform Codex readbacks. The checked-in Ona AI automation runs
  sequentially and requires implementation readback before Linear status sync,
  validation, summary, and video-review request work; it requires both
  implementation and verifier readbacks before video release, final Linear
  status, PR creation, and final chain reporting. This is automation-chain
  evidence only and does not upgrade MineLink product gates.
- `.devcontainer/devcontainer.json` now uses
  `ghcr.io/ninot1quyi/minelink-devcontainer:codex-minelink-mvp-engineering` as
  the default image and uses `scripts/dev/bootstrap-prebuild.sh --light` for
  normal `postCreateCommand` startup. The full Node/TypeScript and NeoForge
  Gradle warmup remains the Ona prebuild hard gate, not a per-task startup cost.
  This change still needs a fresh Ona prebuild readback before it can be counted
  as platform-side bootstrap evidence.
- `.ona/automations.yaml` now provides Ona-native environment tasks for docs,
  fast verification, real NeoForge guard smoke, and acceptance artifact
  rendering plus video-review request preparation and a separate video-release
  check.
  `ona/ai-automations/minelink-agent-factory.yaml` defines the Ona CLI
  finalizer for Linear status sync, verification, evidence summaries, video
  review request preparation, release gating, and PR creation after the
  implementation work is performed by Ona Platform Codex and the MP4 is
  reviewed by a separate Platform Codex verifier.
- The finalizer now fails closed before validation/PR finalization unless
  `scripts/dev/report-agent-factory-chain.mjs` can read accepted implementation
  evidence from `.minelink-dev/reports/ona-codex-implementation-session.md`.
  The readback must identify `Agent mode: Ona Platform Codex`, a `Session id`,
  and `Result: passed`; generic Ona automation, SSH, task, stale local artifact,
  or default-agent output is not accepted for the implementation edge. The
  separate video verifier must likewise provide
  `.minelink-dev/reports/ona-codex-video-verifier-session.md` in addition to
  the hash-checked `video-review.md` and release gate.
- `.github/workflows/agent-factory-dispatch.yml` provides the repository source
  dispatcher for agent-ready GitHub issues plus a scheduled/manual Linear
  polling fallback. It uses `scripts/dev/dispatch-agent-factory.mjs` and
  `scripts/dev/watch-linear-agent-tasks.mjs` to start the shared Ona
  automation, then `scripts/dev/report-agent-factory-chain.mjs` records the
  issue-to-PR nodes, edges, first blocker, and remaining percentage. This is
  delivery-chain evidence only and does not prove Minecraft product behavior.
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
- `scripts/dev/sync-linear-status.mjs` writes
  `.minelink-dev/reports/linear-sync.md` and lets Ona update Linear issues
  without exposing the key value in logs or repository files.
- `scripts/dev/render-acceptance-video.mjs` generates a trace-driven
  `.minelink-dev/reports/artifacts/acceptance-summary.md` and
  `.minelink-dev/reports/artifacts/acceptance.mp4`; the real NeoForge GitHub
  workflow installs `ffmpeg` and runs the renderer with `--require-mp4`.
- `scripts/dev/prepare-video-review-request.mjs` generates
  `.minelink-dev/reports/artifacts/video-review-request.md` with the current
  summary/MP4 hashes and the exact Ona Platform Codex verifier assignment. This
  request artifact is a handoff package only and does not release the task.
- `scripts/dev/check-video-review.mjs` blocks video publication unless a
  separate Ona Platform Codex verifier writes
  `.minelink-dev/reports/artifacts/video-review.md` with passing task/video
  match markers and current summary/MP4 hashes. The gate writes
  `.minelink-dev/reports/artifacts/video-release-gate.md`.
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
  packaging, native Linear webhook enablement, Ona Platform Codex
  implementation/verifier launch and readback for the current PR, Ona native
  `pullRequest` success, acceptance MP4 availability in every environment,
  dedicated video verifier completion, or real NeoForge install acceptance.
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
- Ona Platform Codex end-to-end task execution remains blocked while the
  platform reports `Codex authentication failed` before repository commands run.
- Long release-length soak/stability run on real Minecraft.
