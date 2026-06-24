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
`.github/workflows/ona-platform-codex-probe.yml` in `full-chain-task` mode for
the same task, branch, issue, optional Linear key, and serialized task
requirements. That second workflow is the guarded Platform Codex -> video -> PR
-> CI -> status path. `full-chain-canary` remains available for bounded
diagnostic probes, but GitHub/Linear issue dispatch uses the real task-report
path by default.
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
execution. The request uses the current `userInput.inputs[]` text-block shape
and keeps the deprecated `userInput.text` field only as a compatibility mirror;
a successful HTTP response alone is not accepted as proof that Codex consumed
the task prompt. MineLink tracks that experiment through
`scripts/dev/start-ona-platform-codex.mjs`, which refuses to omit `agentId` or
use the known default automation agent id. The launcher defaults to GPT-5.5,
`CODEX_REASONING_EFFORT_EXTRA_HIGH`, the fast service tier, and
`AGENT_MODE_GOAL`. The Ona AgentService `mode` field defaults to the one-shot
`AGENT_MODE_EXECUTION` path if omitted, so MineLink must pass
`AGENT_MODE_GOAL` explicitly for long-running factory tasks. The launcher
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
the generated task readback records `Agent execution mode: AGENT_MODE_GOAL`.
`.github/workflows/ona-platform-codex-probe.yml` runs the same probe inside
GitHub Actions with repository `ONA_TOKEN` access. Its job timeout is sized for
full-chain NeoForge client-video runs, because those runs must start Ona
Platform Codex, run the finalizer in the task environment, record a Minecraft
client MP4, request same-session verifier review, and optionally create a PR. Its default `discover` mode only proves token/API
policy readback and resolves organization context from
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
Before `implementation-canary`, `task-implementation`, `full-chain-canary`, or
`full-chain-task` starts the Platform Codex session, the workflow prepares the
target branch from the workflow source commit with `git push --force-with-lease`.
This intentionally re-anchors reused task branches to the current source commit
so stale canary/report files from an older AgentService execution cannot
satisfy a new run. That branch is only a handoff anchor: it is not
implementation evidence, does not satisfy the Platform Codex readback, and does
not replace the Codex-authored canary, task report, or product commit. After
the fresh Ona environment
reaches running state, `scripts/dev/start-ona-platform-codex.mjs` fetches and
checks out that target branch inside `/workspaces/MineLink` before calling
`StartAgent`; the API session report records `AlignEnvironmentBranch` and the
branch readback. This keeps `implementation_codex -> branch/commit readback`
and guarded salvage on the same branch instead of leaving new task environments
on the project default branch. Ona can return a newly created environment id
before `ona environment get` can read it back; the launcher treats only that
post-create `not_found: environment not found` response as a transient pending
readback and retries inside the normal environment wait window. Other
environment readback failures still fail closed.
`scripts/dev/start-ona-platform-codex.mjs --task-implementation` is the
non-canary prompt surface for real issue tasks. It requires explicit task
requirements, writes `docs/agent-factory-task-reports/<task>.md`, and tells
Codex to implement within the issue contract instead of editing only the canary
file. `scripts/dev/fetch-platform-codex-task-report.mjs` is the matching
task-report fetch/check gate: it reads the current branch report from GitHub,
requires the report task id, branch, session id, `AGENT_MODE_GOAL`, `Result:
passed`, and `Validation result: passed`, and combines that report with the
AgentService API readback proving the configured Codex agent id and Codex
settings. `full-chain-task` uses this task-report gate for real issue work;
canary fetchers remain bounded diagnostic proof only. NeoForge-backed
`full-chain-task` runs give this implementation-report edge a longer wait
window than docs-only tasks, because Goal-mode Codex may spend many minutes
reading MineLink context and running real Minecraft validation before it can
push the task report; a still-running implementation session is not accepted as
release evidence, but it also should not be interrupted by the shorter docs
timeout.
If Goal-mode Codex writes the exact task-bound canary or task report inside the
Ona environment but fails to push it, the fetcher may perform a guarded
salvage: it enters the recorded Ona environment, refuses any branch other than
the expected task branch, checks the current task/session/Goal-mode/pass
markers, stages only the expected canary file or
`docs/agent-factory-task-reports/<task>.md`, commits that evidence file, pushes
the branch, and then restarts the normal GitHub API readback. The task-report
salvage also refuses unexpected changed files outside the expected report path,
agent-factory canary notes, and the acceptance evidence ledger after expanding
untracked directories to concrete file paths. Deletions are refused. This
recovery path is evidence-only; it cannot publish arbitrary product code or
bypass downstream video gates.
When the canary path already exists from an earlier rehearsal, the fetcher must
keep polling until the file markers match the current AgentService execution,
task, branch, and Goal-mode request. Stale branch content is a pending async
state until timeout; it is never accepted as current evidence.
The same workflow has `full-chain-canary` and `full-chain-task` modes for the
next edge. After the implementation canary or task report exists, the runner runs
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
For `full-chain-canary`, the workflow re-fetches the implementation canary
after verifier evidence is fetched and before the release finalizer runs. For
`full-chain-task`, it re-fetches the task implementation report through
`fetch-platform-codex-task-report.mjs`. This guards against a long-running
Goal-mode session later overwriting the same branch with `Result: blocked` or
otherwise changing implementation evidence after its first accepted readback.
The release gate must fail closed unless the current branch head still contains
task/session-bound implementation evidence with `Result: passed`.
An execution that completes with failed actions proves the repository bridge
reached Ona and the guarded finalizer ran, but it is still only partial chain
evidence; accepted implementation evidence requires the task-bound Platform
Codex readback.

The final flow must use the Ona Platform Codex agent option for implementation,
then a same-session native Codex verifier subagent for video review, not the
default Ona Agent and not manual
SSH. Ordinary GitHub CI may upload `.minelink-dev` reports and summarized
evidence, but it must not publish a PR comment that looks like final acceptance
video evidence. Final task-acceptance video must be produced in the Ona
task/finalizer environment with producer `ona-task-finalizer`, then verified by
hash against that exact artifact with
`check-video-review.mjs --require-producer ona-task-finalizer`.
PR-visible video evidence must include a public playable MP4 URL, preferably
from the configured external video store. Actions artifact zip links are useful
for logs and reports, but they are not accepted as the visible video surface by
themselves, and automated PR video comments skip or fail when the playable URL
is missing. The external video upload belongs to the Ona implementation
finalizer as candidate evidence transport; the GitHub runner may comment with
the returned URL only after downloading it from R2, verifying `mp4Sha256`, and
passing the same-session verifier release gate. It must not re-render or
substitute the final task video.
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
the specific Codex session and platform-mode evidence. Task environments can be
created with an explicit Ona environment class through
`MINELINK_ONA_ENVIRONMENT_CLASS_ID` or the `environment_class_id` workflow
input; video-required NeoForge/client recorder jobs should use Regular or
larger classes instead of relying on the default Small baseline. The requested
class must be configured for the MineLink Ona project, not merely visible in the
organization class list; otherwise Ona rejects environment creation before
Codex starts. The implementation
finalizer renders the trace-driven MP4 before the verifier runs; the release
finalizer must not re-render the MP4 after video review. It checks the existing
artifact hashes. In GitHub-driven full-chain canaries, the runner uses
`scripts/dev/run-ona-finalizer-artifacts.mjs` to execute the validation,
summary, `render-video`, and `prepare-video` finalizer stages inside the same
Ona task environment. The bridge starts a background runner through a short
`ona environment exec` call, polls it with short follow-up exec calls, and then
copies `.minelink-dev/reports` back for verifier prompting. This avoids the Ona
gateway timeout that can cut off long NeoForge/client video captures before
artifacts can be returned. When external video storage is configured, the
implementation finalizer uploads the freshly rendered `acceptance.mp4` directly
from the Ona environment to R2 as candidate evidence, then writes
`.minelink-dev/reports/artifacts/video-storage-manifest.json` and
`.minelink-dev/reports/video-storage-upload.json`. The GitHub runner copies
only small reports/manifests back through the chunk bridge, downloads the MP4
from the manifest URL, and verifies `mp4Sha256` before verifier prompting or PR
publication. After the same Platform Codex implementation execution writes
`video-review.md`, the runner calls the same bridge again with `release-upload`;
that release finalizer checks the existing MP4/review/manifest hashes and
copies the release report back for PR commenting. R2 upload is candidate
transport only: it does not bypass the same-session verifier or
`check-video-review.mjs`. The bridge fetches finalizer scripts from the
workflow/source ref inside the Ona environment instead of injecting large script
bodies through `ona environment exec`, because the Ona exec path is
shell-mediated and has practical argument-size limits. This bridge also deletes
stale verifier/release/upload artifacts before the implementation finalizer
stages so old `video-review.md` files cannot be mistaken for the current
same-session verifier result, runs candidate upload before verifier handoff so
old task-branch stage runners cannot block video transport, and reports
extracted files only after the current tarball is decoded successfully and any
manifest MP4 has been downloaded and hash-verified.
This bridge is accepted only as
finalizer/artifact transport; Platform Codex API readback and task-bound branch
commits remain the implementation and verifier evidence.
Terminal factory paths run
`scripts/dev/cleanup-ona-resources.mjs` after success or failure so task
environments are stopped automatically when they are in the MineLink project
and have no uncommitted workspace changes. Cleanup is resource hygiene only; it
does not change task acceptance, and Ona CLI stop-watch messages are reported
as cleanup output or warnings rather than validation errors when the final
environment readback is stopped. Stopped Ona environments still count against
the organization's total environment quota, so `full-chain-canary` and
`full-chain-task` also run a preflight prune that deletes stopped MineLink task
environments before creating a fresh Goal-mode task environment. This prune is quota hygiene only: it is
project-scoped, skips running or starting environments, records dirty-workspace
deletions in the cleanup report, and does not prove implementation,
verification, or product acceptance. The source dispatcher starts the checked-in
Ona automation as an observable bridge node, records its execution id, and then
continues to the Platform Codex workflow without waiting for generic Ona
automation actions to finish. This keeps the public Ona automation node visible
while avoiding the default automation action lifecycle as a bottleneck before
the Codex-specific implementation and verifier sessions. The GitHub Actions
`full-chain-canary` and `full-chain-task` modes can also run the
release-gate-to-PR edge when `create_pr=true`; it calls
`scripts/dev/create-agent-factory-pr.mjs`, records
`.minelink-dev/reports/agent-factory-pr.{md,json}`, and refreshes the chain
report with the created draft PR URL. That edge requires the
`AGENT_FACTORY_GITHUB_TOKEN` repository secret because repository policy can
block the default Actions `GITHUB_TOKEN` from creating pull requests. When the
PR is open, `scripts/dev/wait-agent-factory-pr-ci.mjs` waits for the GitHub PR
check rollup and de-duplicates repeated check runs by workflow/check name,
keeping the latest run so stale push-event checks for the same head commit do
not block the PR-only evidence edge. The final PR evidence edge is separate
from generic status writeback: `scripts/dev/comment-pr-evidence.mjs` must
publish a GitHub user-attachments MP4 URL before the chain can mark
`pr_video_evidence` passed.
Only after that edge runs does `scripts/dev/sync-github-status.mjs` comment the
linked GitHub issue or PR with either `final-video-published` or
`blocked-final-video-publication`, and `scripts/dev/sync-linear-status.mjs`
comments/attaches the linked Linear issue when one was supplied. The refreshed
chain report marks `pr_video_evidence -> status_writeback` as passed only for
the task sources that exist: a GitHub-only task requires GitHub writeback, a
Linear-only task requires Linear sync evidence, and a linked GitHub+Linear task
requires both. Linear sync uses
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
The CI static job resolves the guard base explicitly: pull requests use the PR
base SHA, while non-PR `codex/**` pushes prefer
`origin/codex/minelink-mvp-engineering` before falling back to `origin/main`.
This keeps canary branches aligned with the engineering baseline without
weakening the same-branch architecture-update requirement.

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
Java 21, GitHub CLI, `ffmpeg`, `Xvfb`, the X11/OpenGL/audio libraries required
by the Minecraft client recorder, npm cache, and the Gradle user-home cache. Branch
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
and terminal log excerpts. Ordinary GitHub CI may upload these reports only
when explicitly requested; it must not re-render or publish final PR video
evidence. Final task videos are generated in the Ona finalizer environment.
This trace-driven artifact is not proof of client GUI perception and not a
gate-status upgrade unless the task also supplies a real client-capture
artifact. For Minecraft/NeoForge product-video tasks, the finalizer must use
`MINELINK_RECORD_CLIENT=1`, which starts a real NeoForge `runClient`, records
the Minecraft window through Xvfb/ffmpeg, and then runs
`scripts/dev/render-client-capture-video.mjs` to compose the normal client view
with terminal evidence. Capture and terminal rendering are intentionally split:
while Minecraft is running, `e2e.sh` records only the client window and writes
MCP/server/client logs to files; after the scenario and Java processes stop,
the renderer turns those logs into the right-side terminal panel and composites
the final MP4. The `split-game-capture-post-terminal-composite` path keeps
terminal rendering and final encoding from competing with Minecraft client
rendering during the task. That renderer is the only path allowed to set
`clientGuiCapture=true`, and it must also set `minecraftClientPanel=true`,
`mcpTerminalLogPanel=true`, `clientWorldReady=true`,
`captureStartedAfterWorldReady=true`, `recorderAutoFollow=true`,
`recorderTargetMoved=true`, `recorderClientFollow=true`,
`recorderClientTargetCentered=true`, `recorderClientTargetVisible=true`,
`recorderWorkVisible=true`, and `serverAgentTaskActionVisible=true`;
`scripts/dev/check-video-review.mjs --require-client-gui-capture` rejects
trace-driven, loading-screen, pre-world, static, non-moving, occluded, and
non-following videos for these tasks. `minecraftClientPanel=true` means the
left side is the normal Minecraft client capture; `mcpTerminalLogPanel=true`
means the right third contains terminal evidence from the matching
MCP/server/agent logs. `recorderWorkVisible=true` and
`serverAgentTaskActionVisible=true` are derived from the same scenario report
and recorder evidence: the scenario must pass, at least one world-changing MCP
tool such as `action.*`, `container.*`, `craft.*`, `furnace.*`, or `create.*`
must succeed, at least one final assertion must pass, and the recorder must
confirm target movement, follow, centered framing, and visible target framing.
For scenarios that complete `action.mine_visible_block`, the
renderer additionally requires the server-side recorder marker
`MineLink recorder visible mining server_agent` and a
`recorderVisibleMiningMs >= recorderMinVisibleMiningMs` duration check before it
sets `recorderScenarioActionVisible=true`; this prevents a video that only shows
the agent standing near a finished result, or a sub-second mining flash, from
passing as mining evidence. The real NeoForge mining path must produce that
marker while driving `ServerPlayerGameMode.handleBlockBreakAction` and
`gameMode.tick()` for the visible `MineLink-*` FakePlayer body, so
video-required mining evidence comes from vanilla block-break progress rather
than a recorder-only hold followed by an instant `destroyBlock` call. The sync
mining budget is intentionally below the protocol request timeout, while
submit-mode `action.mine_visible_block` has a longer bounded mining budget and
must be proven through `action.status` before the scenario can pass. The
video-oriented `mine_tree` replay still retrieves a wooden axe from the shared
fixture chest through public container tools but submits the visible-log mining
action with `tool_policy=empty_hand`; the final assertions require the submitted
action to be accepted, terminal `completed`, and to report the mined oak log.
That keeps a human-readable vanilla mining window in the final MP4 without
turning the synchronous MCP request into a long-running background shortcut.
Agent
scenario reports also fail closed on unexpected `ok:false` tool results; a final
inventory assertion cannot mask a failed MCP action. The
finalizer also runs
`scripts/dev/render-video-storyboard.mjs` after MP4 rendering to create a
numbered frame grid for model-readable QA; that storyboard is never the final
deliverable and cannot replace the playable `acceptance.mp4`. The
video-required finalizer does not run the same NeoForge scenario twice: its
`validate` stage runs fast repository checks, and the recorder-backed
`render-video` stage is the real NeoForge scenario evidence for that task.
This preserves real Minecraft proof while avoiding duplicate server/client
startup and duplicate Java load. The
recorder path first runs `scripts/dev/ensure-client-recorder-deps.sh` when
headless capture dependencies are missing, so an older Ona prebuild can either
self-install `ffmpeg`, `Xvfb`, the required X11/OpenGL libraries, and
`python3-pil` with passwordless apt/sudo or fail early with
`.minelink-dev/reports/client-recorder-deps.{md,json}` identifying the missing
dependency edge. New prebuild images should still include those packages; the
self-bootstrap path is a compatibility guard for already-created task
environments, not a replacement for the prebuild baseline. The recorder client
uses a task-local absolute `MINELINK_RECORDER_CLIENT_GAME_DIR` under the
client-capture work directory and writes that resolved path to
`logs/client-config.log`, so NeoForge `runClient --gameDir` validation is not
dependent on the Gradle working directory inside Ona. The NeoForge client run
sets the ModDevGradle `gameDirectory` property for that path instead of
appending another `--gameDir` program argument; appending the argument would
collide with ModDevGradle's built-in client gameDir argument.
The Ona finalizer checks out the task branch for task content, then injects the
current workflow-source finalizer scripts, `e2e.sh`, client-video renderer,
recorder dependency bootstrap, and matching `ARCHITECTURE.md` from the pinned
source commit before running validation. The source ref must be resolved to a
commit SHA before the finalizer fetches the PR base or task branch, because
later fetches overwrite Git's transient `FETCH_HEAD`. Injecting the architecture map with the scripts
keeps `check-architecture-guard.sh` meaningful: the finalizer no longer tests a
hybrid worktree where architecture-sensitive scripts changed without their
source-commit architecture update. The finalizer also receives the full
reviewed commit from the Platform Codex implementation readback and checks out
the task branch at that exact commit before validation or video rendering.
This prevents reused or force-pushed canary branches from moving the finalizer
to a newer branch head that was not the commit reviewed by Goal-mode Codex. The
finalizer also receives the PR base branch and fetches it before running
`verify-agent-task.sh --base`, so canary branches are validated against the
branch they will actually target instead of falling back to `origin/main`. When a client-video run fails, the artifact
tarball includes `.minelink-dev/client-capture-*` logs in addition to
`.minelink-dev/reports`, and `e2e.sh` writes
`reports/e2e-failure-log-tail.txt` with `client-config.log`, client logs, and
recorder logs at the end so GitHub truncation still preserves the most useful
failure evidence. The recorder also writes `logs/resource-snapshots.log` around
dependency checks, client startup, ffmpeg startup, and recorder shutdown so
slow or choppy videos can be attributed to CPU, memory, or process contention
instead of guesswork. Stage
reports preserve both the head and tail of long command output so recorder,
Minecraft client, and MCP server failures can be diagnosed from GitHub
artifacts. For large MP4s, the default path is R2-first: the Ona finalizer
uploads candidate `acceptance.mp4` to the configured S3-compatible store,
writes `video-storage-manifest.json`, and excludes the MP4 from the chunked
report tarball. The GitHub runner downloads the MP4 from `videoUrl` and fails
closed unless its SHA-256 matches `mp4Sha256`. The artifact bridge still
prepares a remote manifest plus fixed-size base64 chunks under
`.minelink-dev/ona-finalizer-artifact-chunks` and verifies the tarball SHA-256
after downloading; that bridge is for reports, logs, manifests, and no-R2
fallbacks, not the preferred large-video transport. The chunk bridge is a
small-report allowlist: it may include `.minelink-dev/reports` and lightweight
`.minelink-dev/client-capture-*/{logs,reports}` files, but when a storage
manifest exists it must exclude the final `acceptance.mp4`; it must always
exclude raw client MP4s, recorder game directories, `node_modules`, `.git`,
build outputs, run directories, and repository-root files such as `AGENTS.md`,
`ARCHITECTURE.md`, or `package.json`. A no-R2 fallback may carry the final
`acceptance.mp4` only under the chunk bridge byte cap. A tarball that crosses
the boundary fails before GitHub Actions spends time fetching chunks. The
recorder client is an observer only: the server publishes the real
`MineLink-*` FakePlayer-backed `server_agent` as a visible ServerPlayer entity
and creates only an invisible camera anchor that continuously follows that body
for recording. The recorder must target a client-visible player entity, not an
ArmorStand or other proxy marker, and this recorder path does not add MCP
tools, world-query authority, materials, or any bypass around server-side
checks. The client recorder must
emit `MineLink recorder client in world` after the Minecraft client has a
world, player, and no blocking screen; `e2e.sh` starts ffmpeg only after that
marker and writes `clientWorldReady=true` plus
`captureStartedAfterWorldReady=true` into the capture metadata. The server
recorder helper must also emit `MineLink recorder auto-follow active` after the
recorder player is switched to spectator camera mode and bound to the
agent-following camera anchor; the renderer writes that as
`recorderAutoFollow=true`. The recorder client must also log
`MineLink recorder client following server_agent` after it sees the visible
`MineLink-*` player body and continuously steers the recorded view toward it; the renderer
writes that as `recorderClientFollow=true`. The server-side recorder helper
must log `MineLink recorder target moved server_agent` after the active
`server_agent` body visibly moves during the recorded scenario; the renderer
writes that as `recorderTargetMoved=true`. It must then log
`MineLink recorder client target centered server_agent` after the recorded
client camera has held a target-centered
view long enough for review; the renderer writes that as
`recorderClientTargetCentered=true`. The recorder must also log
`MineLink recorder client target visible server_agent` only after the chosen
camera mode is showing the visible `server_agent` player body; the renderer writes that as
`recorderClientTargetVisible=true`. The renderer then combines those recorder
markers with the scenario's successful work tools and final assertions to write
`recorderWorkVisible=true`. For video-required product gates, the Codex RPC
runner must wait for the recorder to report follow, visibility, and centered
framing after `agent.birth` and before the first work tool is executed; the
metadata records this as `recorderReadyBeforeScenario=true`. After the scenario
passes, `e2e.sh` must hold a visible post-scenario work window and the renderer
must record `recorderWorkCoverageAdequate=true` only when the hold is at least
the configured minimum. The scenario report must also confirm submit-mode
actions reached terminal lifecycle states; `submittedActionsTerminalConfirmed`
prevents a video from ending at action submission time when work is still
queued or running. For video-oriented mining, the accepted status payload must
also include the submitted action result (`action_result.mined`,
`action_result.submitted_action`, and `action_result.visible_mining_ms`) so the
summary, verifier request, and terminal panel can tie the visible client footage
to the completed server action. Release gates require all recorder markers
so loading screens, Mojang bootstrap footage, server-only camera intent,
static/idle targets, late-only target appearances, no-op tasks, occluded
targets, off-screen target following, or normal clients that are not visibly
following and framing the active `server_agent` before and during task work
cannot be published as final Minecraft product evidence.
Pull request workflows use
`scripts/dev/upload-acceptance-video-storage.mjs` inside the implementation
finalizer to upload candidate `acceptance.mp4` to the configured
S3-compatible video store, currently Cloudflare R2 via
`MINELINK_VIDEO_STORAGE_*` settings. The release finalizer does not re-upload
or re-render; it runs `check-video-review.mjs`, preserves the manifest, and lets
the GitHub runner re-download and verify the MP4 hash before
`scripts/dev/comment-pr-evidence.mjs` publishes PR evidence. GitHub issue and
PR Markdown strips external `<video>` embeds, so Cloudflare R2 URLs are
candidate transport links only. Final PR video evidence must use a GitHub
user-attachment MP4 URL such as `github.com/user-attachments/assets/...`; when
that URL is missing the release-to-PR edge must fail closed instead of
publishing an R2 link as playable evidence. MineLink can optionally create that
attachment with `scripts/dev/upload-github-user-attachment.mjs`, but that bridge
requires an explicit GitHub web attachment cookie secret
`MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE`; PATs and `GITHUB_TOKEN` can identify
the repository but do not create comment attachments by themselves, and they
cannot be exchanged for a GitHub web session cookie. The attachment bridge uses
the task PR URL to fetch the issue/PR editor's upload-policy authority for
`/upload/policies/assets`. It prefers a nearby `<file-attachment>`
upload-policy CSRF input, can fall back to a same-page authenticity token when
GitHub's current markup exposes the upload policy through the issue editor form
instead of a closed custom element, and uses repository-page `uploadToken`
discovery only as the last discovery path. Any rejected policy or finalization
request still fails closed. It then performs the policy, object upload, and
finalization calls with reusable multipart buffers so retries do not depend on
runtime-specific `FormData` behavior. Object-store uploads never receive the
GitHub cookie header. The bridge records sanitized cookie-signal and
page-token-signal reports plus
failure-kind classification so stale cookies, rejected web sessions, missing
page tokens, transient policy failures, object-upload failures, and
finalization failures are recorded as distinct blockers.
`scripts/dev/refresh-github-attachment-cookie.mjs`
provides the supported refresh path: a local operator opens a dedicated Chrome
profile, explicitly logs in to GitHub, and the helper writes only the resulting
`github.com` cookie header directly to the repository secret through
`gh secret set` without printing cookie values. It does not run in CI and does
not read the operator's normal browser profile. When the cookie is absent the
upload script writes a skipped report and the PR publication gate remains
blocked. Full-chain PR-producing workflows run an early
`scripts/dev/check-agent-factory-secrets.mjs` readiness report for GitHub
inline-video publication. The default `github_attachment_preflight=deferred`
mode records whether `MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE` or a manually
provided `github_attachment_video_url` is available, but still lets the
Platform Codex implementation, finalizer, PR, and CI edges run so the exact
remaining blocker is captured at `pr_video_evidence`. Operators can choose
`github_attachment_preflight=fail-fast` for cost-saving rehearsals that should
stop before Ona/Minecraft work when the attachment authority is missing. The
final publication step still fails closed without a GitHub user-attachments
MP4 URL; deferred mode is not permission to publish R2-only evidence. The
upload step also runs
`scripts/dev/upload-github-user-attachment.mjs --referer "$MINELINK_AGENT_FACTORY_PR_URL" --require-upload` so a skipped
attachment upload cannot be treated as releasable evidence. The GitHub Actions
artifact remains the raw evidence bundle. The older
`scripts/dev/publish-pr-video-evidence.mjs`
path is a manual fallback only and must not be used for final PR playback,
because video binaries must not be committed to the repository evidence branch.
These PR-visible links are review convenience only; the video producer metadata
still decides whether an artifact is GitHub canary evidence or final Ona task
evidence. Full-chain dispatches must pass the task's
validation scope and scenarios through to the Ona finalizer; they must not
silently downgrade a `neoforge` issue to `docs` or `none` before video
rendering. Client-backed finalizer video uses the recorder client's
`observer_follow` camera by default, with an elevated offset behind and beside
the `server_agent`; `target_third_person` remains a diagnostic option but is
not the default final PR evidence view because it can hide the task action by
framing the agent body too tightly. Video-required tasks must
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

Implementation, `full-chain-canary`, and `full-chain-task` dispatches use
`AGENT_MODE_GOAL`.
Because Goal-mode Codex sessions can remain in `PHASE_RUNNING` while pursuing
a persistent objective, `scripts/dev/start-ona-platform-codex.mjs` accepts an
active non-terminal Goal-mode readback only after AgentService proves the
requested Codex agent id, Codex settings, a non-pending execution phase, and
prompt-consumption progress when a prompt was sent. Token usage, iteration
count, current activity, or current operation is the handoff-progress signal;
an active Goal execution with none of those fields is blocked rather than
treated as a working Codex session.
`PHASE_PENDING` is explicitly blocked; it only proves that the platform has an
execution record, not that the Codex session can receive and run the task
prompt. After active readback, the prompt delivery still uses `userInput.inputs[]`
with a legacy `text` mirror; task consumption is proven only by durable
branch/report evidence. Task completion is then proven by the separate
task-bound branch/commit
readback from
`scripts/dev/fetch-platform-codex-canary.mjs` for canaries or
`scripts/dev/fetch-platform-codex-task-report.mjs` for real task work, not by
waiting for the Goal session to become terminal. Guarded evidence-only salvage
can recover a missing commit/push for the exact canary or task-report file from
the recorded Ona environment, but the accepted completion evidence is still the
post-salvage GitHub branch readback. For video-required work, the Goal-mode task
release gate is stricter than launch/readback: the Ona finalizer must produce
`acceptance.mp4`, the same implementation session must run the bounded Codex
verifier subagent, and `scripts/dev/check-video-review.mjs` must pass before PR
publication or status writeback can claim release evidence.
When a Goal session reaches active readback but does not produce the expected
branch report, `.github/workflows/ona-platform-codex-probe.yml` runs
`scripts/dev/fetch-ona-agent-execution-readback.mjs` with the repository Ona
token. The diagnostic script first creates a temporary
`CreateAgentExecutionConversationToken` and then uploads sanitized
conversation/transcript diagnostics with a bounded per-URL fetch timeout so
streaming `live` endpoints cannot stall cleanup or artifact upload. These
diagnostics are used only to localize prompt delivery, LLM-provider,
health-check, or session-entry failures; they are not accepted task, video,
verifier, or product evidence.
The task-report fetcher also probes the recorded Ona environment before
waiting for long-running NeoForge work. If the expected report is missing, the
worktree is clean, and no Minecraft/NeoForge/validation/recording process is
active for the configured no-progress window, the implementation edge fails
closed instead of waiting out the full branch timeout. Empty transcript
readback is likewise a blocker: it means AgentService accepted the Goal-mode
execution, but the session produced no visible conversation evidence for the
task.
If `GetAgentExecution` reports `Codex could not reach the LLM provider` or an
unauthenticated provider warning, the launch edge is blocked until Ona Platform
Codex can make a real model request.

The release gate writes
`.minelink-dev/reports/artifacts/video-release-gate.md` and fails if the MP4 is
missing, the verifier is not marked `Ona Platform Codex`, or the task/video
match markers and summary/MP4 hashes are not passing. The release gate also
rejects zero-report placeholder videos: an `acceptance-summary.md` with
`Scenario reports: 0` or `No scenario reports found` cannot be final acceptance
evidence, even if a verifier report says `Release decision: pass`. A ready
`video-review-request.md` never releases a task by itself. For client GUI
captures, the same verifier canary and release gate must also carry
`Recorder ready before scenario: yes`, `Recorder work coverage adequate: yes`,
`Recorder visible mining: yes` and
`Recorder visible mining duration adequate: yes` when mining is required,
`Recorder scenario action visible: yes`,
`Submitted actions terminal confirmed: yes`, and
`Recorder work visible: yes`, proving that the video shows successful task work
by the followed `server_agent` rather than an idle target, an action submission
without completion, or a target that only appears in the final frames.
The GitHub workflow uploads `acceptance-storyboard.png` and its JSON metadata as
a separate small artifact for fast visual QA. That storyboard helps reviewers
and models inspect the MP4 content when large artifact or R2 downloads are slow,
but it is never accepted as the final video deliverable.

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
