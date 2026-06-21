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
  ona-migration.md                      cloud worktree migration runbook
  linear-ona-agent-factory.md           Linear/GitHub -> Ona -> PR delivery flow
  agent-task-queue.md                   bounded agent-ready task queue
  github-labels.md                      issue/PR label taxonomy
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
  pull_request_template.md              required PR evidence template
.devcontainer/                          cloud worktree bootstrap
.ona/                                   Ona environment automations
ona/ai-automations/                     Ona validation automation specs
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

## Action Lifecycle

Submit-mode actions are public MCP action handles, not a bypass around tool
guards. The runtime records the requested tool arguments, exposes
`accepted/queued/running/completed/failed/cancelled/expired` through
`action.status`, and releases per-agent queue capacity only when the handle
reaches a terminal state.

When a submitted action finishes, the NeoForge runtime must call the same
server-side tool implementation used by `await_completion`: visibility,
observed-ref TTL, reachability, material, inventory, vanilla/NeoForge hooks,
and permission checks still decide success or failure. Failed submitted actions
must preserve the public tool failure reason. Mock runtime behavior may mirror
this lifecycle contract for fast replay, but real Gate 2 evidence requires a
NeoForge report.

## Body Lifecycle

`server_agent` lifecycle is exposed through public dynamic MCP tools:
`body.freeze`, `body.restore`, and `body.remove`. The Mod remains the authority
for body state. Freeze changes the body status to `frozen`, cancels active
submitted actions with `body_frozen`, and rejects world-changing tools while
leaving safe observation and lifecycle tools available. Restore changes the
same in-memory body back to `active`. Remove closes open containers, discards
the FakePlayer body, deletes the runtime agent record, and releases the owner
quota slot.

This is same-process lifecycle evidence only. It does not prove persistent body
restore after Minecraft server restart, full action replay recovery, or
human-player coexistence. Those remain separate acceptance gaps until a real
restart/reconnect report proves them.

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
- Ona migration truth: `docs/ona-migration.md`,
  `docs/linear-ona-agent-factory.md`, `docs/agent-task-queue.md`,
  `docs/github-labels.md`, `.github/pull_request_template.md`,
  `.ona/automations.yaml`, and `ona/ai-automations/`

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

## AI-Native Delivery Model

MineLink product work is fed by a repo-native delivery factory:

```text
Linear or GitHub task
  -> Ona Platform Codex agent
  -> branch
  -> validation automation
  -> acceptance MP4
  -> dedicated Ona Platform Codex video review
  -> PR
  -> CI/artifacts
  -> Linear/GitHub status
```

`docs/linear-ona-agent-factory.md` defines the status model, required task
fields, Linear board setup, GitHub issue mapping, and manual pilot commands.
The Ona CLI finalizer/validation automation spec is
`ona/ai-automations/minelink-agent-factory.yaml`. The local Ona environment
automation file is `.ona/automations.yaml`.

The final flow should use the Ona Platform Codex agent option for implementation
and the separate video-verifier pass, not the default Ona Agent and not manual
SSH. Manual `ona environment ssh` remains useful for debugging or verification,
but it is not the product delivery path. The finalizer must not re-render the
MP4 after video review; it checks the existing artifact hashes instead. Linear
status sync is handled by
`scripts/dev/sync-linear-status.mjs` using `LINEAR_API_KEY` from the Ona
environment; the key must never be committed, passed as a parameter, or printed.
If Linear or GitHub webhook dispatch cannot be verified in the current
environment, the repo must say so and keep the gap visible instead of
pretending automation is enabled.

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
- install: fresh committed checkout clone, `npm ci`, and fast verifier.
- all: full fast path plus real NeoForge smoke.

Use explicit scopes when the task carries product-risk:

```bash
bash scripts/dev/verify-agent-task.sh --scope runtime
bash scripts/dev/verify-agent-task.sh --scope neoforge --scenarios guard_boundaries
bash scripts/dev/verify-agent-task.sh --scope install
```

The script writes a summary to
`.minelink-dev/reports/agent-task-summary.md` for PR evidence.

Workflow evidence is indexed by:

```bash
node scripts/dev/summarize-evidence.mjs
```

The index summarizes scenario reports, soak reports, process cleanup, queue
metrics, and install smoke output under
`.minelink-dev/reports/ci-evidence-summary.md` or the install-smoke artifact
directory. GitHub workflows append the same Markdown to `$GITHUB_STEP_SUMMARY`
before artifact upload. This is an evidence index only; it does not change gate
status or workflow pass/fail semantics.

Linear task status is synchronized by:

```bash
node scripts/dev/sync-linear-status.mjs --issue NIN-7 --status "In Review"
```

The script calls Linear with `LINEAR_API_KEY`, writes
`.minelink-dev/reports/linear-sync.md`, and records only sanitized operation
summaries. It is process evidence, not Minecraft product evidence.

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

The agent workbench guard is:

```bash
bash scripts/dev/check-agent-workbench.sh
```

It runs locally through `scripts/dev/verify-agent-task.sh` and in GitHub CI. It
keeps the Ona migration runbook, ready task queue, label taxonomy, PR template,
issue template, devcontainer, install smoke workflow, and verification entry
points present with required anchors. The devcontainer guard also protects the
fast Ona bootstrap contract: prebuilt Node 22 image, Java 21 feature, and
image or OS provided `python3` instead of a pinned source-built Python feature.

The install smoke verifier is:

```bash
bash scripts/dev/install-smoke.sh --scope fast
```

It clones the committed ref into a separate checkout, runs `npm ci`, runs the
fast agent-task verifier, and records the sanitized source remote, source
commit, dirty-source decision, environment versions, command exit codes, and
report paths under `.minelink-dev/install-smoke/`. Dirty-source runs are local
debugging only, not acceptance evidence. The paired GitHub workflow uploads
`minelink-install-smoke-evidence` for install/workbench/bootstrap changes.

Ona prebuilds run the devcontainer `postCreateCommand`, which calls:

```bash
bash scripts/dev/bootstrap-prebuild.sh
```

The bootstrap installs required OS tools such as `ffmpeg`, verifies Node, npm,
Python, Java 21, `gh`, and sanitized Linear secret presence, runs `npm ci`,
builds and typechecks the TypeScript workspace, and runs the NeoForge Gradle
build to warm Gradle, Minecraft, and NeoForge dependency caches. It does not
accept the Minecraft EULA, start a long-running Minecraft server, or write
secret values. Set `MINELINK_PREBUILD_SKIP_GRADLE=1` only when debugging a
broken prebuild where the Gradle cache warmup must be bypassed temporarily.

Acceptance video artifacts are generated by:

```bash
node scripts/dev/render-acceptance-video.mjs --require-mp4
```

The script writes a trace-driven
`.minelink-dev/reports/artifacts/acceptance-summary.md` and
`.minelink-dev/reports/artifacts/acceptance.mp4`. GitHub's real NeoForge
workflow installs `ffmpeg` and requires the MP4 before uploading evidence, so
missing video support is a workflow failure instead of a silent `.unavailable`
artifact. This artifact is a review visualization, not proof of client GUI
perception and not a gate-status upgrade. Video-required tasks must then run a
separate Ona Platform Codex verifier that writes
`.minelink-dev/reports/artifacts/video-review.md`, followed by:

```bash
node scripts/dev/check-video-review.mjs --require-mp4
```

The release gate writes
`.minelink-dev/reports/artifacts/video-release-gate.md` and fails if the MP4 is
missing, the verifier is not marked `Ona Platform Codex`, or the task/video
match markers and summary/MP4 hashes are not passing.

## Current Product State

MineLink is not product-complete. The current acceptance document records
real-partial evidence across many gates, including fresh-clone bootstrap
evidence for Gate 10, but Gate 9 is still missing and no gate is currently
`product-accepted`. Treat each implementation as a measured conversion from
mock/smoke evidence toward real product behavior.
