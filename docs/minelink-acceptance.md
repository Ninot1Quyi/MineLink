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
| Gate 2: server_agent Body and Guard Pipeline | real-partial | Real guard, queue, FakePlayer inventory, movement, mining, and owner quota evidence exists; restore/freeze/remove, cancellation, expiry, and full body parity remain incomplete. |
| Gate 3: Limited Perception | real-partial | Real fixture evidence covers occlusion and selected shape classifications; generic raycast/block-shape visibility and long-running perception cache behavior remain incomplete. |
| Gate 4: MCP Host and Gateway | real-partial | MCP stdio, Streamable HTTP, reconnect, catalog preflight, token/rate/session checks, and real HTTP gateway smoke exist; full hosted gateway operations remain incomplete. |
| Gate 5: Agent RPC JSON, MCP Compatibility, and Local SDK | real-partial | Codex JSON-RPC replay and generic MCP dynamic tools are verified; Python helper parity, polling/subscription helpers, reconnect ergonomics, replay SDK, and semantic retries remain incomplete. |
| Gate 6: Container and Crafting | real-partial | Real chest, crafting table, furnace, native `useItemOn` container entry, server `Slot.safeTake/safeInsert` transfer evidence, slot refs, recipe registry, native oak-planks `ResultSlot` evidence, and FakePlayer inventory evidence exists; full server menu click parity, repeated crafting, recipe breadth, and remainder parity remain incomplete. |
| Gate 7: Create Adapter | real-partial | Real Create fixture proves visible component inspection, native item/wrench use, powered press processing, and inventory pickup; complete Create semantics and broader mod compatibility remain incomplete. |
| Gate 8: Multi-agent, A2A, and Social Runtime | real-partial | Real three-agent portal cooperation, local chat, physical notice board, redacted payloads, and owner quota evidence exists; human interaction, durable social persistence, orders, letters, telegraph, and broader A2A remain incomplete. |
| Gate 9: Frontier Society and Director | missing | No accepted 10-agent society, Director replay, relationship/economy metrics, or emergent-role evidence yet. |
| Gate 10: Install and Product Packaging | missing | Developer scripts exist, but fresh server/user/LAN installer flows and cross-platform packaging evidence are not accepted yet. |
| Gate 11: Security, Stability, and Release | real-partial | Short mock/real soaks, cleanup reports, gateway admission tests, and owner quota evidence exist; long real Minecraft soak and release security evidence remain incomplete. |

No gate is currently `product-accepted`. A full-product completion claim requires
every gate above to move to `product-accepted` with repeatable real evidence.

### Gate 0: Repository, Install, and Baseline Harness

Required:

- `npm install` from a clean clone sets up Host, SDK, mock runtime, tests, and scripts.
- `npm run build`, `npm run typecheck`, `npm test`, and `npm run ci` pass.
- CI runs build, tests, mock `mine_tree`, `create_smoke`, `craft_smoke`,
  `furnace_smoke`, `craft_negative`, `guard_boundaries`,
  `perception_shapes`, and `portal_coop`, plus real NeoForge smoke for those
  scenarios, and uploads `.minelink-dev/` evidence.
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
  `craft_negative`, `guard_boundaries`, `perception_shapes`, and
  `portal_coop` on push, pull request, manual dispatch, and daily schedule;
  full release acceptance still requires the later complete Create, social
  runtime, install, security, and release-length soak gates.

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
- The guard replay also exercises `mode=submit` for real NeoForge actions:
  accepted action handles return `status=accepted`, `lifecycle_status=queued`,
  and an `action_id`, while excess submissions return
  `backpressure_queue_full` instead of allowing unbounded per-agent queue
  growth.
- Mock runtime and real NeoForge runtime enforce the advertised
  `max_agents_per_owner=3` admission limit with `agent_quota_exceeded`; the
  three-agent portal cooperation replay proves exactly three same-owner agents
  can cooperate while a fourth same-owner birth is rejected server-side.
- The real NeoForge guard fixture also proves that a fixture-hidden
  `minecraft:diamond_ore` is absent from `observe.scene` while the intervening
  `minecraft:stone` wall and reachable `minecraft:white_bed` are visible.
- This is not the full Gate 2 release surface yet. The remaining body lifecycle
  manager, persistent restore/freeze/remove, cancellation/expiry state
  transitions, timed mining start/stop/cancel state, and complete body-state
  parity still require separate implementation and evidence.

### Gate 3: Limited Perception

Required:

- `observe.self`, `observe.scene`, and `observe.inventory` work against real server state.
- `observe.scene` returns visible surfaces with short-lived refs, not raw chunk data.
- Perception uses Minecraft/NeoForge block state, shape, raycast, and configurable MineLink vision tags.
- Transparent/decorative/partial occluder blocks are represented structurally.
- Return size, radius, and frequency are bounded.

Evidence:

- Fixture worlds for opaque wall, glass, leaves, short grass, fence, water, and tree.
- Assertion reports prove hidden blocks are not returned.

Current status:

- `guard_boundaries` provides a real NeoForge hidden-block negative: the
  opaque-wall fixture observes the wall and bed but does not return the diamond
  ore behind the wall.
- `perception_shapes` adds repeatable mock and real NeoForge evidence for
  visible non-opaque classifications: glass and oak leaves carry
  `minelink:vision_translucent`, short grass carries
  `minelink:vision_decorative`, water carries `minelink:vision_fluid`, oak
  fence carries `minelink:vision_partial_occluder`, stone carries
  `minelink:vision_opaque` and `minelink:opaque_fixture`, and the diamond ore
  behind that stone wall remains absent from `observe.scene`.
- Real NeoForge decorative/fluid perception no longer depends on the exact
  seeded fixture coordinate for short grass: the mod now classifies decorative
  visible blocks from empty collision shape and fluid blocks from `FluidState`,
  which covers fixture drift such as water updates replacing the originally
  seeded grass block.
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
- The real report records `native_interaction.menu_opened=false` and
  `native_interaction.menu_source=constructed_server_crafting_menu_after_use_item_on`
  for the headless crafting-table path: the visible/reachable block interaction
  still enters through `ServerPlayerGameMode.useItemOn`, but the server_agent
  does not claim a client GUI was opened.
- Real NeoForge `craft_negative` now observes the crafting table after a full
  inventory `container.take_output` failure and asserts that the oak-planks
  output remains observable, proving the failed take did not consume the native
  result slot output.
- This is not the full Gate 6 release surface yet. The native crafting result
  evidence currently covers the oak-log to oak-planks fixture with `count=1`.
  Repeated result takes for `count>1`, shaped recipe breadth, modded recipe
  breadth, container-click parity, remainder item handling, and broader
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

- Fresh clone install test.
- Fresh server install test.
- MCP config snippet.
- Cross-platform path notes.

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
  `craft_negative`, `guard_boundaries`, `perception_shapes`, and
  `portal_coop`.
- The NeoForge workflow starts a real dedicated Minecraft server and runs a
  short real NeoForge soak for `furnace_smoke`, `craft_negative`,
  `guard_boundaries`, `perception_shapes`, and `portal_coop`.
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
- `bash scripts/dev/e2e.sh perception_shapes`
- `bash scripts/dev/e2e.sh portal_coop`
- `bash scripts/dev/soak.sh --runtime mock --iterations 1 --scenarios mine_tree,furnace_smoke,craft_negative,guard_boundaries,perception_shapes,portal_coop`
- `npm_config_registry=https://registry.npmjs.org npm audit --audit-level=moderate`
- `./gradlew --no-daemon build` in `mod/neoforge`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh mine_tree`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 MINELINK_MCP_TRANSPORT=http MINELINK_WORK_DIR=.minelink-dev/neoforge-http-mine_tree bash scripts/dev/e2e.sh mine_tree`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 MINELINK_ENABLE_CREATE=1 bash scripts/dev/e2e.sh create_smoke`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh craft_smoke`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh furnace_smoke`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh craft_negative`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh guard_boundaries`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh perception_shapes`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh portal_coop`
- `MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/soak.sh --runtime neoforge --iterations 1 --scenarios furnace_smoke,craft_negative,guard_boundaries,perception_shapes,portal_coop`
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

- Persistent/restorable server_agent lifecycle and human-player coexistence.
- Complete Create adapter behavior beyond the current real powered-press smoke.
- Production Gateway revocation, owner quota, and full audit hardening beyond
  the current token/rate-limit/session-cap baseline.
- Complete FakePlayer-backed container/crafting semantics on real server menus.
- Multi-agent social runtime.
- Director UI/service.
- Installer.
- Long release-length soak/stability run on real Minecraft.
