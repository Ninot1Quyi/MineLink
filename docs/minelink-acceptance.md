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

### Gate 0: Repository, Install, and Baseline Harness

Required:

- `npm install` from a clean clone sets up Host, SDK, mock runtime, tests, and scripts.
- `npm run build`, `npm run typecheck`, `npm test`, and `npm run ci` pass.
- CI runs build, tests, `mine_tree`, `create_smoke`, and `craft_smoke`, and uploads `.minelink-dev/` evidence.
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
  `mine_tree` and `craft_smoke` on push, pull request, manual dispatch, and
  daily schedule; full release acceptance still requires the later FakePlayer,
  Create, multi-agent, install, security, and soak gates.

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
- `create.*`, persistence, social runtime, complete server menu coverage, and a
  real FakePlayer body remain later gates; they must not be claimed by the
  smoke implementation.
- `online-mode=true` returns `unsupported_online_auth` and does not create an agent.
- `online-mode=false` supports open admission plus server-side rate and agent-count limits.
- Server logs and action trace survive clean server stop/restart.

Evidence:

- Java 21 build log.
- Dedicated server log.
- Real protocol trace.
- `MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh mine_tree`.
- `MINELINK_RUNTIME=neoforge bash scripts/dev/e2e.sh craft_smoke`.
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

### Gate 3: Limited Perception

Required:

- `observe.self`, `observe.scene`, and `observe.inventory` work against real server state.
- `observe.scene` returns visible surfaces with short-lived refs, not raw chunk data.
- Perception uses Minecraft/NeoForge block state, shape, raycast, and configurable MineLink vision tags.
- Transparent/decorative/partial occluder blocks are represented structurally.
- Return size, radius, and frequency are bounded.

Evidence:

- Fixture worlds for opaque wall, glass, leaves, grass, chain/fence, water, and tree.
- Assertion reports prove hidden blocks are not returned.

### Gate 4: MCP Host and Gateway

Required:

- Host supports MCP stdio for local Codex/Claude Code.
- Gateway supports MCP Streamable HTTP for remote agent platforms.
- Public MCP surface remains small:
  `minelink.ping`, `minelink.connect_server`, `minelink.birth`, `minelink.tool_list`, `minelink.tool_query`, `minelink.tool_execute`.
- Game capabilities are lazy dynamic tools.
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

Evidence:

- `bash scripts/dev/e2e.sh mine_tree`
- `bash scripts/dev/e2e.sh create_smoke`
- `bash scripts/dev/e2e.sh craft_smoke`
- `examples/codex-rpc/*.replay.jsonl`
- `.minelink-dev/reports/mine_tree-result.json`

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

Current status:

- Mock runtime covers `craft_smoke` on CI.
- Real NeoForge runtime now covers the first chest + crafting-table smoke:
  an oak log is seeded in a real chest block entity, moved through MineLink slot
  refs into the agent inventory, crafted through the server recipe registry into
  oak planks, taken from the output slot, and asserted by
  `observe.inventory`.
- This is not the full Gate 6 release surface yet. Furnace coverage, negative
  cases, complete server menu/slot rule parity, and FakePlayer-backed inventory
  semantics still need separate implementation and evidence.

### Gate 7: Create Adapter

Required:

- Create dependency remains optional for the core Mod but enabled for Create adapter test profile.
- `create.inspect_component` identifies depot, belt, press, shaft, cogwheel, wrench-relevant faces, speed/stress hints, and common blockage reasons.
- Agent can legally use a wrench or item on one reachable component.
- Adapter does not expose `auto_build_factory` or global oracle tools.
- Ponder/JEI/overlay limitations are documented and returned as `unsupported_capability` where applicable.

Evidence:

- `bash scripts/dev/e2e.sh create_smoke` against mock and real Create dev server.
- Fixture world with depot, belt, press, shaft, cogwheel, wrench, and material chest.

### Gate 8: Multi-agent, A2A, and Social Runtime

Required:

- Multiple server_agent bodies can coexist with human players.
- Nearby speech, shout, notice board, orders, letters/telegraph placeholders, and audit events are persisted.
- Distance discovery exposes only locally observable agents/events.
- A2A and social messages are rate-limited and attributable.
- Human player and agent chat interaction works in a real server.

Evidence:

- Two-agent fixture.
- Human + agent coexistence demo.
- Event timeline and replay.

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
- Soak report.
- Process cleanup report.
- PR checklist with all passing gates and known external blockers.

## 3. Required Boundary Tests

Before a release tag, these must pass against mock and real runtime where applicable:

- Unknown dynamic tool returns `unknown_tool`.
- `online-mode=true` returns `unsupported_online_auth`.
- Mining without a current observation returns `unknown_or_unobserved_target`.
- Mining an expired ref returns `expired_ref`.
- Mining a visible but distant block returns `target_too_far`.
- Submitting too many concurrent actions returns `backpressure_queue_full`.
- Connected `tool_list` runtime failure is surfaced, not hidden by local fallback.
- Reconnecting to endpoint B stops using endpoint A.
- Create fixture returns structured component data or structured unsupported reason.
- Server log, Host log, agent log, and action trace are valid JSON/JSONL.

## 4. Current Baseline Evidence

The repository currently has an executable baseline for Gates 0, 4 partial, 5 partial, 6 mock partial, 7 mock partial, and 11 dependency audit:

- `npm run build`
- `npm run typecheck`
- `npm test`
- `npm run ci`
- `bash scripts/dev/e2e.sh mine_tree`
- `bash scripts/dev/e2e.sh create_smoke`
- `bash scripts/dev/e2e.sh craft_smoke`
- `npm_config_registry=https://registry.npmjs.org npm audit --audit-level=moderate`
- `MINELINK_RUNTIME=neoforge bash scripts/dev/start-server.sh` fails correctly on this machine with a Java 21 prerequisite message because local `java -version` is OpenJDK 17.
- `mod/neoforge` is still a skeleton without a committed Gradle wrapper or real endpoint; real Minecraft local acceptance is blocked until those are added and Java 21 is available. The dev harness generates local `eula=true` and defaults `online-mode=false` before the Java/Gradle checks.

Not yet accepted as full product:

- Real NeoForge endpoint implementation.
- Real Minecraft server_agent body.
- Real Create adapter against Create.
- Production Gateway admission/rate-limit/auth hardening.
- Containers/crafting on real server menus.
- Multi-agent social runtime.
- Director UI/service.
- Installer.
- Soak/stability run on real Minecraft.
