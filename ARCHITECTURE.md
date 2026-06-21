# MineLink Architecture

MineLink is a two-process Minecraft agent runtime. The repository is organized
so agents can navigate from a small context entry point into deeper product,
runtime, and validation documents without relying on chat history.

## System Shape

```text
Codex / Claude Code / OpenClaw / Hermes
  -> MineLink Host or Gateway
  -> MineLink Protocol
  -> MineLink Mod / MineLink Runtime
  -> server_agent body in Minecraft
```

The public agent surface is MCP. The game authority is the Minecraft Mod. Agent
logic stays outside the Minecraft JVM and uses public MCP tools, including lazy
dynamic tool discovery through `minelink.tool_list` and `minelink.tool_query`.

## Repository Map

```text
AGENTS.md                               short operating contract and map
ARCHITECTURE.md                         this structure and boundary map
README.md                               user-facing quick start
SECURITY.md                             security reporting and posture
docs/
  minelink-acceptance.md                product acceptance gates and evidence
  minelink-plan.md                      product and society vision
  minelink-mod-mcp-architecture.md      Mod / Host / MCP split design
  development.md                        commands, evidence layout, local flows
  codex-rpc-agent.md                    Codex JSON-RPC agent contract
  agent-workbench.md                    Ona/Codex task workflow
packages/
  protocol/                             MineLink Protocol types and schemas
  host/                                 MCP stdio Host and HTTP Gateway
  sdk/                                  agent-local TypeScript helpers
  mock-runtime/                         deterministic contract runtime
mod/neoforge/                           real Minecraft/NeoForge Mod runtime
examples/
  agents/                               JSON-RPC e2e runner and examples
  codex-rpc/                            replay decisions for scenarios
scripts/dev/                            build, server, e2e, soak, verification
.github/
  workflows/                            CI and real NeoForge smoke automation
  ISSUE_TEMPLATE/                       agent-ready task templates
.devcontainer/                          cloud worktree bootstrap
```

## Authority Boundaries

- `mod/neoforge` is the only layer allowed to make authoritative Minecraft
  decisions about world state, visibility, reachability, inventory, containers,
  crafting, Create interactions, social events, guard checks, and audit.
- `packages/host` owns MCP transports, session routing, Gateway admission,
  reconnect behavior, logging, and protocol forwarding. It must not mutate game
  state directly.
- `packages/protocol` defines the internal Host-to-runtime contract. It should
  stay compact and versioned.
- `packages/sdk` is convenience only. It cannot call runtime internals or weaken
  MCP/tool boundaries.
- `packages/mock-runtime` is a fast contract harness. It is not product evidence
  for real Minecraft behavior.
- `examples/agents/codex_rpc_json_runner.py` drives public MCP tools from
  Codex-style JSON-RPC decisions. It must not call runtime internals.

## Layering Rules

Allowed dependency direction:

```text
protocol <- host
protocol <- sdk
protocol <- mock-runtime
Host/Gateway -> MineLink Protocol -> Mod runtime
examples -> SDK/MCP public tools
scripts/dev -> package CLIs and Mod dev server
```

Disallowed shortcuts:

- Host, SDK, examples, or tests must not become world-state authorities.
- Public tools must not expose oracle queries, global chunk scans, `give`,
  `setBlock`, arbitrary NBT edits, teleport shortcuts, or hidden coordinates.
- `server_agent` work must not be replaced by a hand-written toy agent and
  counted as product evidence.
- A mock assertion must not replace a real NeoForge assertion for an acceptance
  claim.

## Knowledge System

`AGENTS.md` is the short context map. The deeper system of record is:

- Product truth: `docs/minelink-acceptance.md`
- Architecture truth: `ARCHITECTURE.md` and
  `docs/minelink-mod-mcp-architecture.md`
- Development truth: `docs/development.md` and `scripts/dev/`
- Parallel task truth: `docs/agent-workbench.md` and
  `.github/ISSUE_TEMPLATE/agent-task.yml`

When a durable rule appears in review, chat, CI, or an issue, promote it into
one of these files or into an executable check. Avoid relying on unstated
thread memory.

## Acceptance Model

Every gate in `docs/minelink-acceptance.md` must use exactly one status:

- `mock-only`
- `smoke-only`
- `real-partial`
- `product-accepted`
- `missing`

No gate is full-product complete until it is `product-accepted` with repeatable
real evidence. Real NeoForge reports outrank mock and replay reports for game
behavior claims.

## Parallel Development Model

Use one environment per bounded task:

```text
one Ona/Codex environment = one task = one branch = one PR
```

Safe parallel lanes:

- Documentation and architecture maps.
- Devcontainer and bootstrap scripts.
- CI evidence summaries and report collection.
- One acceptance gate with a narrow write scope.
- Verification-only review or CI monitoring.

High-conflict lanes that need a single owner:

- `mod/neoforge/src/main/java/net/minelink/neoforge/server/MineLinkEndpointBootstrap.java`
- Protocol schema plus mock runtime plus replay changes in one feature.
- Broad runtime refactors.
- Any task described as "finish MineLink".

Each task must declare scope, forbidden changes, validation commands, evidence
paths, and remaining gaps. Use `docs/agent-workbench.md` for the full template.

## Conditional Verification

The default agent verification entry point is:

```bash
bash scripts/dev/verify-agent-task.sh
```

The script classifies the current diff and runs the smallest useful check:

- docs-only: whitespace and shell syntax checks.
- fast: build, typecheck, unit tests.
- runtime: fast checks plus selected mock e2e scenarios.
- neoforge: selected real NeoForge e2e scenarios.
- all: full fast path plus real NeoForge smoke.

Use explicit scopes when the task carries product-risk:

```bash
bash scripts/dev/verify-agent-task.sh --scope runtime
bash scripts/dev/verify-agent-task.sh --scope neoforge --scenarios guard_boundaries
```

The script writes a summary to
`.minelink-dev/reports/agent-task-summary.md` for PR evidence.

## Architecture Maintenance Guard

Architecture-sensitive changes must keep this file current. The guard is
implemented by:

```bash
bash scripts/dev/check-architecture-guard.sh
```

The guard runs locally through `scripts/dev/verify-agent-task.sh` and in GitHub
CI. It always checks that `AGENTS.md` and `ARCHITECTURE.md` retain the required
context anchors. When protocol, host, SDK, mock runtime, NeoForge runtime,
agent runner, replay, dev scripts, workflows, or package structure changes, it
also requires `ARCHITECTURE.md` to change in the same branch unless a reviewed
false-positive override is set with `MINELINK_ARCH_GUARD_ALLOW_NO_UPDATE=1`.

The guard is intentionally lightweight. It does not prove the architecture is
correct; it prevents silent architecture drift and makes context maintenance a
normal part of CI.

## Current Product State

MineLink is not product-complete. The current acceptance document records
real-partial evidence across many gates, but Gates 9 and 10 are still missing
and no gate is currently `product-accepted`. Treat each implementation as a
measured conversion from mock/smoke evidence toward real product behavior.
