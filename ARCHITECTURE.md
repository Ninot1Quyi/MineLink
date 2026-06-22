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
    devcontainer-image.yml              GHCR prewarmed devcontainer image build
    agent-factory-dispatch.yml          GitHub/Linear -> Ona dispatch
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
  -> GitHub Actions dispatcher or Linear watcher
  -> Ona automation queue
  -> Ona Platform Codex API launch/readback
  -> Ona Platform Codex implementation agent
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
The source dispatcher is `.github/workflows/agent-factory-dispatch.yml`, backed
by `scripts/dev/dispatch-agent-factory.mjs`,
`scripts/dev/watch-linear-agent-tasks.mjs`, and
`scripts/dev/report-agent-factory-chain.mjs`.
After the source dispatcher accepts a GitHub issue, it writes
`.minelink-dev/reports/agent-factory-dispatch.json` and
`scripts/dev/trigger-agent-factory-full-chain.mjs` starts
`.github/workflows/ona-platform-codex-probe.yml` in `full-chain-canary` mode
for the same task, branch, issue, and optional Linear key. That second workflow
is the guarded Platform Codex -> video -> PR -> CI -> status path.
`scripts/dev/check-agent-factory-secrets.mjs` is the secret-safe preflight for
this bridge: it checks GitHub secret presence, local/runner `LINEAR_API_KEY`
presence, the `AGENT_FACTORY_GITHUB_TOKEN` PR-creation token, and Ona CLI
active-context status without printing credential values.
`scripts/dev/setup-linear-agent-factory.mjs` is the repeatable Linear setup
entry point for the `MineLink` project, required labels, and agent-factory
workflow states. It records setup evidence without printing `LINEAR_API_KEY`.
`scripts/dev/sync-github-status.mjs` and
`scripts/dev/sync-linear-status.mjs` are the final status-writeback surfaces:
they comment on the GitHub issue or PR, update/comment/attach the linked Linear
issue when present, and write secret-free reports consumed by the chain
tracker.
The Linear watcher passes the real Linear label set into the dispatcher and
skips `blocked` tasks by default; `--allow-blocked` is reserved for explicit
diagnostic dispatches. After a successful dispatch, the watcher marks the
Linear issue `In Progress` and comments with the dispatch boundary so the
scheduled poller does not repeatedly start the same unresolved task. Future
polls also skip started/In Progress/In Review issues until a human or a later
automation changes the state.

Ona prebuild readiness is a parallel environment-baseline gate, not a required
per-task chain step. `.github/workflows/ona-prebuild.yml` refreshes that
baseline only for environment-sensitive changes or manual dispatch, records
phase polling history through `scripts/dev/summarize-ona-prebuild-phases.mjs`,
and uploads the summary so slow refreshes can be attributed before a Codex
implementation handoff. Failed or timed-out refreshes also run
`scripts/dev/capture-ona-prebuild-logs.sh` to preserve raw bootstrap logs when
Ona exposes them before the transient environment is removed. The workflow
captures logs at stopping/snapshotting entry and treats a snapshotting phase
longer than `MINELINK_ONA_SNAPSHOT_STALE_MINUTES` as a stale refresh to cancel
and retry rather than letting CI wait for the full prebuild timeout. Individual
Ona CLI calls are also wrapped in a short timeout so a stuck status poll fails
with evidence instead of holding the GitHub job open. The tracked default stale
window is 15 minutes, based on recent successful MineLink prebuilds completing
in roughly 11-17 minutes end to end. Early successful log captures are preserved
if a later cancellation makes the transient environment unavailable.
`report-agent-factory-chain.mjs` consumes that preflight JSON when present so
the chain report can name missing secret/context repair actions on the blocked
dispatcher edge.
The dispatcher keeps the Ona automation parameter map at 10 entries or fewer;
larger maps are rejected by the Ona automation API before the factory can start.
After a successful `ona ai automation start`, the dispatcher can also perform a
bounded `ona ai automation executions get` readback and write
`.minelink-dev/reports/ona-automation-execution.md` plus JSON. That readback
records the execution phase, session id when exposed, `runningActionCount`, and
`failedActionCount`.
The default readback window is 600 seconds so guarded finalizer failures are
captured as terminal `completed_with_failed_actions` evidence instead of
misleading short-window `timed_out` evidence. The GitHub dispatcher passes
`--cancel-ona-execution-on-timeout`; if the execution has no active running
action after the bounded readback window, it requests
`ona ai automation cancel-execution` and records the cancellation status in
`.minelink-dev/reports/ona-automation-execution.md`. If an Ona agent action is
still running, the dispatcher records `timed_out`, preserves the session id, and
leaves the agent alive for follow-up monitoring instead of killing active
implementation work. That cancellation prevents stale platform work from
looking like an active agent task, but it remains only partial bridge evidence
until a task-bound Platform Codex readback exists. Public Ona automation
`agent` steps currently start the default Ona Agent (`Ai-Automations Action
Execution`) rather than the Ona Platform Codex conversation selector. The
checked-in factory therefore fails closed: it first checks for an already
accepted Platform Codex readback with platform selector/API evidence, writes a
blocked readback if that evidence is absent, then runs the guarded
`implementation-finalize` and `release-finalize` task wrappers. Those wrappers
call `scripts/dev/run-agent-factory-stage.mjs`, write per-stage reports, and
skip side effects until real Platform Codex evidence exists. If a future Ona
CLI/API exposes a documented Codex automation provider, this fail-closed shim is
the place to replace with true Codex launch. Until then, the dispatcher timeout
cleanup is only the repository-side stale-work path after artifact capture,
while active agent sessions are kept for inspection. Public Ona API docs now
expose a narrower candidate launch path: `AgentService/StartAgent` accepts an
explicit `agentId`, `codeContext`, and `codexSettings`, and
`AgentService/SendToAgentExecution` can send the task prompt to the resulting
execution. MineLink tracks that experiment through
`scripts/dev/start-ona-platform-codex.mjs`, which refuses to omit `agentId` or
use the known default automation agent id. The launcher defaults to GPT-5.5,
`CODEX_REASONING_EFFORT_EXTRA_HIGH`, the fast service tier, and
`AGENT_MODE_RALPH`. Public Ona SDKs name the persistent Goal selector as
`AGENT_MODE_RALPH`; `AGENT_MODE_EXECUTION` remains the one-shot Agent selector
and is not accepted for MineLink long-running factory tasks. The launcher
allows environment overrides only for controlled diagnostics. Ona's current
`codexSettings` surface exposes model, reasoning effort, and service tier; the
visible context-window capacity is provided by the selected model rather than
by a separate launcher-side window-size knob. The repository also carries
`.codex/config.toml` to pin
trusted Codex clients to the GPT-5.5 project default, the current 258400-token
context window shown by the UI, and a high auto-compaction threshold; this is a
client preference, not a server-side Ona API override. This API path is not
accepted until a task-bound readback
from `AgentService/GetAgentExecution` proves `spec.agentId` is the configured
Codex agent id, `spec.codexSettings` or `status.codexSettings` is present, and
the generated task readback records `Agent execution mode: AGENT_MODE_RALPH`.
`.github/workflows/ona-platform-codex-probe.yml` runs the same probe inside
GitHub Actions with repository `ONA_TOKEN` access. Its default `discover` mode
only proves token/API policy readback and resolves organization context from
the logged-in Ona CLI config. When no explicit
`MINELINK_ONA_ENVIRONMENT_ID` is supplied, the probe uses that explicit
environment. Otherwise it auto-selects only a currently running MineLink
environment; stopped historical task environments are ignored so new Codex tasks
fall back to `projectId` and let Ona create or schedule a fresh environment from
the project baseline. Because `StartAgent` reports that in-environment agents
require environment context, canary workflows pass `--create-environment` when
they need a fresh task context: the launcher creates an Ona environment from the
project, waits until machine and devcontainer phases are running, then passes
that environment id to `StartAgent`. The API treats `projectId` and
`environmentId` as a oneof context, so the probe sends only `environmentId`
after a usable running environment is available. Its `identity-canary` mode is
required to prove programmatic Codex launch and still needs a real
`MINELINK_ONA_CODEX_AGENT_ID` or workflow input for the Codex app agent id.
While this pilot branch is active, push-triggered probe runs use
`identity-canary` so launch proof can be collected before the workflow exists
on the default branch; this still does not count as task implementation
evidence. GitHub Actions run `27928149039` is the current accepted launch-edge
proof for this API path: it completed policy readback, `StartAgent`,
`SendToAgentExecution`, and `GetAgentExecution` with the requested Codex agent
id, Codex settings, `PHASE_STOPPED`, `SUPPORTED_MODEL_OPENAI_AUTO`,
conversation URLs, and token-usage readback. `status.outputs` was still empty,
so the next edge must be a task-bound Platform Codex implementation session
that writes durable workspace/branch/PR evidence, not another launch canary.
.github/workflows/ona-platform-codex-probe.yml now has an explicit
`implementation-canary` mode for that edge. It sends a docs-only task prompt to
the accepted AgentService Codex execution, requires the session to push only
`docs/agent-factory-canaries/<task>.md` on a task-bound branch, then
`scripts/dev/fetch-platform-codex-canary.mjs` combines the AgentService API
readback with the remote branch head commit and canary markers into the normal
`.minelink-dev/reports/ona-codex-implementation-session.md` file. The canary
file alone is not accepted readback, because the final `Commit:` marker comes
from the GitHub branch head fetched by the workflow.
When the canary path already exists from an earlier rehearsal, the fetcher must
keep polling until the file markers match the current AgentService execution,
task, branch, and Goal-mode request. Stale branch content is a pending async
state until timeout; it is never accepted as current evidence.
The same workflow now has a `full-chain-canary` mode for the next edge. After
the implementation canary branch exists, the runner runs
`scripts/dev/run-ona-finalizer-artifacts.mjs` inside the same Ona task
environment to render the trace-driven acceptance summary/MP4 and prepare
`video-review-request.md`. That finalizer checks out the task branch for task
content, then injects the current workflow/source-commit finalizer scripts so
stale task-branch orchestration cannot rewrite the review request with old
defaults such as `Task id: local`. The runner then sends
`--video-verifier-canary` back to the same implementation AgentService
execution and waits for that session's bounded verifier subagent to write
`docs/agent-factory-canaries/<task>-video-verifier.md` on the same task branch.
`scripts/dev/fetch-platform-codex-video-verifier.mjs` combines the
implementation AgentService readback, review request hashes, and the remote
verifier canary
into `.minelink-dev/reports/ona-codex-video-verifier-session.md` and materializes
the local `.minelink-dev/reports/artifacts/video-review.md` consumed by the
release gate. Existing verifier canary files are treated the same way as
implementation canaries: the fetcher waits for current task, branch, reviewed
commit, implementation session id, Goal-mode marker, summary hash, MP4 hash,
and video producer before passing. This proves only the bounded
`acceptance_video -> video_verifier` chain handoff for a canary task; it does
not prove real product implementation or human acceptance.
An execution that completes with failed actions proves the repository bridge
reached Ona and the guarded finalizer ran, but it is still only partial chain
evidence; accepted implementation evidence requires the task-bound Platform
Codex readback.

The final flow must use the Ona Platform Codex agent option for implementation,
then a same-session native Codex verifier subagent for video review, not the
default Ona Agent and not manual
SSH. GitHub Actions may store or publish CI MP4 artifacts, but final
task-acceptance video evidence must identify the video producer. A
`github-actions-canary` video proves only the automation chain; a final
task-acceptance video must be produced in the Ona task/finalizer environment
with producer `ona-task-finalizer`, then verified by hash against that exact
artifact with `check-video-review.mjs --require-producer ona-task-finalizer`.
PR-visible video evidence must include a public playable MP4 URL, preferably
from the configured external video store. Actions artifact zip links are useful
for logs and reports, but they are not accepted as the visible video surface by
themselves, and automated PR video comments skip or fail when the playable URL
is missing. The external video upload belongs to the verifier-approved Ona
release finalizer; the GitHub runner may comment with the returned URL, but it
must not re-render or substitute the final task video.
Manual `ona environment ssh`
remains useful for debugging or verification,
but it is not the product delivery path. Self-reported identity is not accepted:
the default Ona Agent can echo `Identity: I am Codex running in Ona Platform
Codex`, so the readback must include platform-side evidence such as a readable
Codex selector/API field or a reviewed UI capture showing the session was
created with Codex selected. The Ona UI can create Codex sessions for this
project, and current project/environment metadata shows the
`codex/minelink-mvp-engineering` clone target plus a project-scoped
`codex_auth` secret. That proves the project can be prepared for Codex work,
but it is not enough to prove the automated chain unless the task run records
the specific Codex session and platform-mode evidence. The implementation
finalizer renders the trace-driven MP4 before the verifier runs; the release
finalizer must not re-render the MP4 after video review. It checks the existing
artifact hashes. In GitHub-driven full-chain canaries, the runner uses
`scripts/dev/run-ona-finalizer-artifacts.mjs` to execute the validation,
summary, `render-video`, and `prepare-video` finalizer stages inside the same
Ona task environment through `ona environment exec`, then copies
`.minelink-dev/reports` back for verifier prompting. After the same Platform
Codex implementation execution writes `video-review.md`, the runner calls the
same bridge again with `release-upload`; that release finalizer checks the
existing MP4/review hashes, uploads the verified MP4 to external storage, and
copies the upload report back for PR commenting. The bridge fetches finalizer
scripts from the workflow/source ref inside the Ona environment instead of
injecting large script bodies through `ona environment exec`, because the Ona
exec path is shell-mediated and has practical argument-size limits. This bridge
also deletes stale verifier/release/upload artifacts before the implementation
finalizer stages so old `video-review.md` files cannot be mistaken for the
current same-session verifier result, runs the upload step directly after the
release gate so old task-branch stage runners cannot block the uploader, and
reports extracted files only after the current tarball is decoded successfully.
This bridge is accepted only as
finalizer/artifact transport; Platform Codex API readback and task-bound branch
commits remain the implementation and verifier evidence.
Terminal factory paths run
`scripts/dev/cleanup-ona-resources.mjs` after success or failure so task
environments are stopped automatically when they are in the MineLink project
and have no uncommitted workspace changes. Cleanup is resource hygiene only; it
does not change task acceptance, and Ona CLI stop-watch messages are reported
as cleanup output or warnings rather than validation errors when the final
environment readback is stopped. The source dispatcher starts the checked-in
Ona automation as an observable bridge node, records its execution id, and then
continues to the Platform Codex workflow without waiting for generic Ona
automation actions to finish. This keeps the public Ona automation node visible
while avoiding the default automation action lifecycle as a bottleneck before
the Codex-specific implementation and verifier sessions. The GitHub Actions
`full-chain-canary` can also run the
release-gate-to-PR edge when `create_pr=true`; it calls
`scripts/dev/create-agent-factory-pr.mjs`, records
`.minelink-dev/reports/agent-factory-pr.{md,json}`, and refreshes the chain
report with the created draft PR URL. That edge requires the
`AGENT_FACTORY_GITHUB_TOKEN` repository secret because repository policy can
block the default Actions `GITHUB_TOKEN` from creating pull requests. When the
PR is open, `scripts/dev/wait-agent-factory-pr-ci.mjs` waits for the GitHub PR
check rollup, then `scripts/dev/sync-github-status.mjs` comments the linked
GitHub issue or PR with the final evidence summary and
`scripts/dev/sync-linear-status.mjs` comments/attaches the linked Linear issue
when one was supplied. The refreshed chain report marks
`ci -> status_writeback` as passed only for the task sources that exist: a
GitHub-only task requires GitHub writeback, a Linear-only task requires Linear
sync evidence, and a linked GitHub+Linear task requires both. Linear sync uses
`LINEAR_API_KEY` from the environment; the key must never be committed, passed
as a parameter, or printed.
If Ona repository webhooks are unavailable for the account, the GitHub Actions
dispatcher and scheduled Linear watcher are the active automation bridge. If
Ona Platform Codex cannot be started automatically or rejects LLM
authentication, the chain report must stop at that edge and record the blocker
instead of falling back to generic Ona Agent evidence.
Disabling the default Ona Agent in organization policy does not currently make
public automation `agent` steps select Codex; a read-only canary still called
`StartAgent` for agent id `00000000-0000-0000-0000-000000007100` and failed
with `agent is disabled by organization policy`. Treat that as a blocked launch
edge, not as a Codex execution.
The next actionable blocker is to supply an Ona personal access token through
`GITPOD_API_KEY` or `ONA_TOKEN` and the Codex app agent id through
`MINELINK_ONA_CODEX_AGENT_ID`, then run:

```bash
npm run agent-factory:start-codex -- --start --identity-canary
```

That command writes
`.minelink-dev/reports/ona-platform-codex-api-session.{md,json}`. Passing it
only proves the programmatic Platform Codex launch/readback edge; it does not
prove MineLink task implementation, validation, video review, or product
acceptance.
If the UI can start Codex but CLI readback for sessions is disabled, the
blocked edge is `ready prebuild -> readable Platform Codex task session`, not
`Codex unavailable`.
`scripts/dev/report-agent-factory-chain.mjs` is the durable node/edge report
for that bridge. Its first blocked edge must carry the actionable blocker text
directly on the edge row, because later nodes can have valid local evidence
without the external chain having reached them.
The report models Ona prebuild as a parallel environment-readiness gate, not as
a child step of the issue dispatcher. The dispatcher can queue the task while
the project prebuild pipeline independently keeps a usable environment baseline
ready.
When the baseline is available, the prebuild edge is considered ready; the
first true blocker should then move to the automation-to-Platform-Codex handoff
unless a concrete Codex session readback exists. The chain reporter and Ona
finalizer require `.minelink-dev/reports/ona-codex-implementation-session.md`
to identify `Agent mode: Ona Platform Codex`, `Identity: I am Codex running in
Ona Platform Codex`, `Platform evidence`, a `Session id`, `Result: passed`, the
current `Task id`, the expected `Branch`, and the current `Commit` before
validation or PR finalization can be treated as downstream evidence. The
identity line is a liveness diagnostic, not acceptance by itself. Generic Ona
automation, SSH, task, stale readback, wrong branch, self-reported identity, or
default-agent output must not satisfy this implementation edge. The
same-session video-verifier subagent uses the same task/branch/commit-bound
pattern through
`.minelink-dev/reports/ona-codex-video-verifier-session.md` plus the
hash-checked video review artifacts.
For canary proof, that verifier readback is generated by
`scripts/dev/fetch-platform-codex-video-verifier.mjs`; for real tasks, the same
markers must come from the implementation execution's verifier subagent for the
task and reviewed commit. Reused canary paths are valid only after the fetch
step observes current markers; older branch contents remain stale evidence and
must not unblock PR publication.
`scripts/dev/check-platform-codex-evidence.mjs` is the fail-closed evidence
check for these readbacks. The checked-in Ona finalizer enters once through
`scripts/dev/run-agent-factory-stage.mjs --stage implementation-finalize` and
then through `--stage release-finalize`; each grouped wrapper runs its guarded
stage list and writes `agent-factory-stage-<stage>.md` reports. Missing
implementation or verifier evidence writes a blocked stage report and exits 0
so Ona can finish the automation with readable evidence instead of leaving a
long-running failed Codex task. The wrappers only run Linear sync, validation,
acceptance video rendering, video release, PR creation, and final chain
reporting after the required Platform Codex readbacks pass, so generic
automation output cannot satisfy later side effects. PR creation uses
`scripts/dev/create-agent-factory-pr.mjs` and environment GitHub CLI
authentication after both implementation and verifier readbacks pass; a missing
`gh` credential is reported as a blocked PR edge, not as product validation
evidence.
`.github/workflows/ona-prebuild.yml` is the CI fallback for that pipeline:
manual dispatches and environment-sensitive changes on
`codex/minelink-mvp-engineering` cancel active stale project prebuilds, trigger
a new Ona prebuild, poll it with `ona prebuild get` until
`PREBUILD_PHASE_COMPLETED` with 100% snapshot completion, and upload
`minelink-ona-prebuild` evidence. The workflow records the pre-refresh prebuild
list and latest completed baseline before it starts a new refresh. If the new
refresh later fails, times out, or stays in snapshotting, the workflow writes a
`partial` report and exits successfully only when a completed baseline already
exists; without a completed baseline it fails closed. The `partial` result does
not accept the new refresh. It only means the project still has a reusable
environment baseline while the failed refresh is investigated or retried.
Ordinary product-code commits should not force prebuild refresh; the workflow
intentionally does not auto-refresh on package or ordinary source changes
because new Codex environments can update source code with git while reusing
the prepared toolchain, dependency, Gradle, and Minecraft cache baseline.
Before Codex handoff, the report must require a completed Ona prebuild baseline
for the agent project. A newer background prebuild refresh may produce a
warning, but it must not block handoff while a completed baseline remains
usable. Manual overlapping prebuild clicks are discouraged because they create
redundant active snapshots; when that happens, cancel stale active prebuilds
and keep the latest completed baseline as the usable environment.
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

`scripts/dev/e2e.sh` also wraps the agent execution phase with
`scripts/dev/run-with-timeout.py` so a stuck replay, MCP request, or agent
process fails with normal e2e logs instead of consuming the full workflow job
timeout. The wall-clock guard is configurable through
`MINELINK_AGENT_TIMEOUT_SECONDS` and does not change tool assertions or
Minecraft authority.

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
fast Ona bootstrap contract: MineLink GHCR cache-prewarmed image, Java 21,
GitHub CLI, `ffmpeg`, and image or OS provided `python3` instead of a pinned
source-built Python feature.

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

Ona prebuilds and normal devcontainer creation use the same bootstrap script
with different modes:

```bash
bash scripts/dev/bootstrap-prebuild.sh --prebuild
bash scripts/dev/bootstrap-prebuild.sh --light
```

The primary Ona prebuild path is the `.ona/automations.yaml`
`bootstrap-prebuild` task with `triggeredBy: prebuild` and
`prebuildRequiresSuccess: true`, so a failed MineLink bootstrap fails the
prebuild instead of producing a misleading snapshot. The devcontainer
`postCreateCommand` calls the same script with `--light` for normal environment
creation and local devcontainer rebuilds, so a task environment does not rerun
the full NeoForge warmup when it is not producing a prebuild snapshot.

Both modes install required OS tools such as `ffmpeg` when missing, verify Node,
npm, Python, Java 21, `gh`, and sanitized Linear secret presence, run `npm ci`
when `node_modules` is missing, and write ignored local files under
`mod/neoforge/run/`: `eula.txt` with `eula=true` and `server.properties` with
`online-mode=false`. The prebuild mode additionally builds and typechecks the
TypeScript workspace, runs the NeoForge Gradle build to warm Gradle, Minecraft,
and NeoForge dependency caches, runs docs guards, then prunes checkout-local
`.gradle` and `mod/neoforge/build` outputs before Ona snapshots the environment.
The warm user-home npm and Gradle caches remain in the image/prebuild, while
path-sensitive generated outputs do not bloat the snapshot. The script does not
start a long-running Minecraft server or write secret values. Set
`MINELINK_PREBUILD_SKIP_GRADLE=1` only when debugging a broken prebuild where the
Gradle cache warmup must be bypassed temporarily, and set
`MINELINK_PREBUILD_KEEP_OUTPUTS=1` only when investigating generated-output
reuse.

The reproducible prewarmed image path is `.github/workflows/devcontainer-image.yml`
plus `.devcontainer/Dockerfile`. GitHub Actions builds the image from a clean
checkout and pushes `ghcr.io/ninot1quyi/minelink-devcontainer` with Node 22,
Java 21, GitHub CLI, `ffmpeg`, npm cache, and the Gradle user-home cache. Branch
builds publish immutable `sha-*` tags plus sanitized branch tags; `main`
additionally publishes `main` and `latest`. Immutable tags are the evidence
anchor, while branch tags are the moving cache source for the matching work
line. After publishing, the workflow runs
`scripts/dev/check-devcontainer-image-access.sh` against the immutable `sha-*`
tag with authenticated GHCR access and Docker runtime smoke. The same checker
can be run with `--require-anonymous` when an unauthenticated Ona pull path is
being evaluated. The workflow trigger is intentionally limited to
image-sensitive paths plus the image access checker; ordinary agent-factory,
Linear watcher, dispatch, or video-review script changes should not rebuild the
GHCR image or force a new prebuild baseline. This is a cache distribution
mechanism only. It must not
contain committed EULA files, secrets, admission tokens, Microsoft credentials,
local `mod/neoforge/run` state, or a hand-uploaded local container snapshot. It
also cannot be treated as proof that NeoForge generated workspace outputs are
reusable in Ona, because project-local `.gradle` and generated source/build
directories are path- and checkout-sensitive. The default devcontainer uses the
`codex-minelink-mvp-engineering` GHCR branch tag after registry access and
Docker runtime smoke are proven. Ona prebuilds must still run
`scripts/dev/bootstrap-prebuild.sh` with `prebuildRequiresSuccess: true` as the
final hard gate before an agent environment is accepted. If Ona pull/start or
the post-publish Docker smoke fails, record the failure and fix the image or
temporarily return to the public Node 22 base image.

The MineLink default devcontainer pulls the moving branch cache
`ghcr.io/ninot1quyi/minelink-devcontainer:codex-minelink-mvp-engineering`.
Immutable `sha-*` tags from the same workflow are the audit anchors for image
evidence. The branch tag is used only to make Ona task environments fast to
start; it is not an acceptance artifact by itself.

Acceptance video artifacts are generated by:

```bash
node scripts/dev/render-acceptance-video.mjs --require-mp4
node scripts/dev/prepare-video-review-request.mjs --require-mp4
```

The script writes a trace-driven composite
`.minelink-dev/reports/artifacts/acceptance-summary.md` and
`.minelink-dev/reports/artifacts/acceptance.mp4`. The MP4 is a report/log
visualization: the left panel renders MineLink server-observation and
assertion evidence, while the right panel renders command paths, tool timelines,
and terminal log excerpts. GitHub's real NeoForge workflow and the Ona Platform
Codex probe workflow install `ffmpeg` and require the MP4 before uploading
evidence, so missing video support is a workflow failure instead of a silent
`.unavailable` artifact. This artifact is not proof of client GUI perception and
not a gate-status upgrade unless the task also supplies a real client-capture
artifact. Pull request workflows call the Ona release finalizer, which runs
`scripts/dev/upload-acceptance-video-storage.mjs` inside the task environment
after `check-video-review.mjs` passes, to upload the verifier-approved
`acceptance.mp4` to the configured S3-compatible video store, currently
Cloudflare R2 via `MINELINK_VIDEO_STORAGE_*` settings. The GitHub runner then
calls `scripts/dev/comment-pr-evidence.mjs` with the returned public MP4 URL so
reviewers can open the exact Ona-produced video from the PR. GitHub issue and
PR Markdown strips external `<video>` embeds, so Cloudflare R2 URLs are durable
playback links, not guaranteed inline GitHub players. Inline playback on the
GitHub page requires a GitHub-uploaded attachment URL such as
`github.com/user-attachments/assets/...`; that upload path is a separate
remaining factory capability and must not be faked with HTML. The GitHub
Actions artifact remains the raw evidence bundle. The older
`scripts/dev/publish-pr-video-evidence.mjs` path is a manual fallback only and
must not be the default automated path when external video storage is
configured, because default automation should not commit video binaries to the
repository evidence branch. These PR-visible links are review convenience only;
the video producer metadata still decides whether an artifact is GitHub canary
evidence or final Ona task evidence. Full-chain dispatches must pass the task's
validation scope and scenarios through to the Ona finalizer; they must not
silently downgrade a `neoforge` issue to `docs` or `none` before video
rendering. Video-required tasks must
then send a verifier request back to the current Ona Platform Codex
implementation execution. That implementation
session must launch a bounded native Codex verifier subagent rather than
starting a second Ona agent session. The review request generator writes
`.minelink-dev/reports/artifacts/video-review-request.md` with the current
summary/MP4 paths, hashes, and exact verifier markers. The verifier must inspect
that request and write `.minelink-dev/reports/artifacts/video-review.md`,
followed by:

```bash
node scripts/dev/check-video-review.mjs --require-mp4
```

Implementation and `full-chain-canary` dispatches must use an AgentService
readback wait long enough for the Codex implementation execution to reach a
terminal phase. The workflow default is 600 seconds; a 30 second wait is only
appropriate for narrow identity probes and can falsely mark a healthy
Goal-mode Codex run as blocked while it is still in `PHASE_RUNNING`.

The release gate writes
`.minelink-dev/reports/artifacts/video-release-gate.md` and fails if the MP4 is
missing, the verifier is not marked `Ona Platform Codex`, or the task/video
match markers and summary/MP4 hashes are not passing. The release gate also
rejects zero-report placeholder videos: an `acceptance-summary.md` with
`Scenario reports: 0` or `No scenario reports found` cannot be final acceptance
evidence, even if a verifier report says `Release decision: pass`. A ready
`video-review-request.md` never releases a task by itself.

Gate 3 perception smoke uses stable vanilla fixture blocks for repeatable real
NeoForge evidence: glass/leaves for translucent, torch for empty-collision
decorative, water for fluid, fence for partial occluder, stone for opaque, and a
hidden diamond ore negative behind the stone. Avoid vegetation blocks for
decorative fixture assertions because vanilla/NeoForge neighbor updates can
make those blocks disappear before observation. Keep the water source boxed by
native solid blocks so fluid ticks cannot wash away adjacent decorative fixtures
before `observe.scene` runs.

## Current Product State

MineLink is not product-complete. The current acceptance document records
real-partial evidence across many gates, including fresh-clone bootstrap
evidence for Gate 10, but Gate 9 is still missing and no gate is currently
`product-accepted`. Treat each implementation as a measured conversion from
mock/smoke evidence toward real product behavior.
