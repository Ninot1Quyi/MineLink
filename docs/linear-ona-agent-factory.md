# MineLink Linear and Ona Agent Factory

This document defines the AI-native engineering delivery system used to develop
MineLink. MineLink remains the product. The factory below is the production
line that turns bounded Linear or GitHub tasks into Ona Platform Codex work,
PRs, CI evidence, and acceptance artifacts.

## Delivery Shape

```text
Linear issue or GitHub issue
  -> agent task contract
  -> Ona Platform Codex API launch/readback
  -> Ona Platform Codex implementation session
  -> one Ona environment / one branch
  -> validation and evidence automation
  -> acceptance MP4
  -> dedicated Ona Platform Codex video review
  -> draft GitHub PR
  -> CI, acceptance summary, release gate
  -> Linear/GitHub status update
```

The implementation agent must be selected as **Codex** in the Ona Platform UI.
Generic Ona Agent runs, manual `ona environment ssh`, and repository CLI
automation are debugging or validation surfaces only; they are not accepted as
final MineLink agent execution evidence.

The checked-in Ona CLI automation is a process runner: it syncs Linear status,
runs validation, summarizes evidence, prepares the video-review request, checks
the dedicated video-review report, and opens or updates the review PR. It does
not replace the Ona Platform Codex agent session, and it does not re-render the
MP4 after the verifier has reviewed it.

For GitHub-driven full-chain canaries, GitHub Actions uses
`scripts/dev/run-ona-finalizer-artifacts.mjs` after the Platform Codex
implementation readback exists. The script executes the validation, summary,
`render-video`, and `prepare-video` finalizer stages inside the same Ona task
environment with `ona environment exec`, copies `.minelink-dev/reports` back to
the runner, and requires the MP4 origin producer to be `ona-task-finalizer`.
This is artifact transport only; the accepted implementation and verifier
evidence remains the Platform Codex API readback plus task-bound branch commits.

The repository has two source dispatchers into that same downstream flow:

```text
GitHub issue event
  -> .github/workflows/agent-factory-dispatch.yml
  -> scripts/dev/dispatch-agent-factory.mjs
  -> ona ai automation start

Linear polling fallback
  -> .github/workflows/agent-factory-dispatch.yml schedule/manual
  -> scripts/dev/watch-linear-agent-tasks.mjs
  -> scripts/dev/dispatch-agent-factory.mjs
  -> ona ai automation start
```

Both dispatchers start the checked-in Ona automation and record its execution
id, but they do not wait for that generic automation to finish before
triggering the Platform Codex full-chain workflow. The automation execution is
node/edge evidence for the bridge only; implementation, video generation,
verification, PR publication, and status writeback are owned by the downstream
Platform Codex workflow and finalizer gates.

Both paths generate `.minelink-dev/reports/agent-factory-chain.md`, which lists
the end-to-end nodes, edges, evidence, first blocking edge, and remaining chain
percentage. That report is automation-chain evidence only; it does not upgrade
MineLink acceptance gates.

## Status Model

Use these statuses for the Linear board and GitHub issue/PR comments:

| Status | Meaning |
| --- | --- |
| `Triage` | Task is being shaped and is not ready for an agent. |
| `Ready for Agent` | Task contract is complete and labels include `agent-ready`. |
| `Agent Queued` | Ona automation was requested but has not started execution. |
| `Agent Running` | Ona Platform Codex is editing, validating, or preparing evidence. |
| `PR Open` | Draft PR exists and links the source task. |
| `CI Running` | GitHub Actions is running required checks. |
| `Video Rendering` | Acceptance summary/MP4 artifact generation is running. |
| `Video Review` | The implementation Ona Platform Codex session has launched a bounded native Codex verifier subagent to compare the task requirements against the MP4 and summary. |
| `Human Review` | Automation is done; reviewer must inspect evidence and gaps. |
| `Accepted` | Reviewer accepted the PR and updated gate evidence if applicable. |
| `Blocked` | Agent cannot continue without a real dependency or human decision. |

## Required Labels

- `agent-ready`: task contract is complete.
- `agent:ona`: task should be handled by Ona Platform Codex plus the checked-in validation automation.
- `real-neoforge-required`: product behavior requires real NeoForge evidence.
- `video-required`: PR must include an acceptance summary, acceptance MP4,
  dedicated Ona Platform Codex video review, and video release gate.
- `gate:0` through `gate:11`: acceptance gate touched by the task.
- `mock-only`, `smoke-only`, `real-partial`, `product-accepted`: current
  evidence class, matching `docs/minelink-acceptance.md`.
- `blocked`: current task cannot progress.
- `needs-human-review`: automation is complete but reviewer acceptance remains.

## Task Contract

Every Linear or GitHub task must include:

- Task: one sentence outcome.
- Required agent mode: Ona Platform Codex.
- Scope: exact files or modules the agent may change.
- Forbidden: assertions, boundaries, or files the agent must not weaken.
- Validation: exact commands the agent must run.
- Evidence: report paths, CI links, and artifact paths expected in the PR.
- Acceptance video required: yes/no and the reason.
- Remaining gaps: product scope this task does not complete.
- Linked GitHub issue and linked Linear issue.
- Expected PR title and branch convention.

Use these branches:

```text
codex/lin-123-short-task
codex/gh-45-short-task
```

## GitHub Entrypoint

Use `.github/ISSUE_TEMPLATE/agent-task.yml` for GitHub tasks. The issue is ready
only when it has `agent-ready` and all required fields are filled.

GitHub Actions owns the repository-side issue dispatcher:

```text
.github/workflows/agent-factory-dispatch.yml
scripts/dev/dispatch-agent-factory.mjs
```

It triggers on `issues` events and manual dispatch. The dispatcher validates the
task contract, checks `agent-ready` and `agent:ona`, starts the Ona automation
through `ona ai automation start`, optionally performs a bounded
`ona ai automation executions get` readback, writes
`.minelink-dev/reports/agent-factory-dispatch.md` and
`.minelink-dev/reports/agent-factory-dispatch.json`, regenerates
`.minelink-dev/reports/agent-factory-chain.md`, and comments on the GitHub
issue. It requires `ONA_TOKEN` in GitHub secrets to start Ona from CI; missing
Ona authentication is recorded as a blocked edge instead of being treated as a
MineLink validation failure.
After a successful GitHub dispatch, the workflow calls
`scripts/dev/trigger-agent-factory-full-chain.mjs`, which starts
`.github/workflows/ona-platform-codex-probe.yml` with
`mode=full-chain-canary`, `create_pr=true`, the accepted task id, target
branch, GitHub issue URL, and optional Linear issue. This is the current bridge
from `GitHub issue -> dispatcher` into the Platform Codex implementation,
video verifier, PR, CI, and status-writeback chain.

When readback is enabled, the dispatcher also writes
`.minelink-dev/reports/ona-automation-execution.md` and JSON with the Ona
execution phase, running action count, failed action count, exposed session id,
and polling attempts.
The GitHub/Linear dispatcher workflows enable `--cancel-ona-execution-on-timeout`
so a run that stays non-terminal after the bounded readback window is cancelled
through `ona ai automation cancel-execution` only when no action is actively
running. If an agent action is still running, the dispatcher records
`timed_out`, preserves the exposed session id, and leaves the agent alive for
inspection or a follow-up monitor. That prevents stale Ona work from consuming
the active task slot without killing active implementation work, but it is still
only partial bridge evidence.
If the execution finishes with failed actions, that is treated as partial bridge
evidence: the dispatcher reached Ona and the guarded finalizer ran, but the
chain must still stop at the missing Ona Platform Codex implementation readback
instead of pretending the task was implemented.

Before debugging a failed dispatcher run, run the secret-safe preflight:

```bash
npm run agent-factory:secrets -- --require-github-secrets --require-ona-context
```

The preflight checks only credential presence and Ona CLI context. For full PR
canaries it expects `ONA_TOKEN`, `LINEAR_API_KEY`, and
`AGENT_FACTORY_GITHUB_TOKEN`; it never prints those values or any other secret.

Manual pilot command:

```bash
ona ai automation start <automation-id> \
  --project 019ee8ed-9e1b-7cd8-9b1b-af0c8ee27edb \
  --param task_id=gh-45 \
  --param linear_issue=NIN-7 \
  --param github_issue=https://github.com/Ninot1Quyi/MineLink/issues/45 \
  --param branch=codex/gh-45-short-task \
  --param pr_title="Advance MineLink task gh-45" \
  --param acceptance_gate="Gate 2" \
  --param validation_scope=docs \
  --param scenarios=none \
  --wait
```

Webhook or GitHub Actions dispatch can call the same command after validating
the issue body. Do not paste tokens into shell history; use Ona/GitHub secret
storage for any dispatcher credentials.
Keep the dispatch map at 10 parameters or fewer; Ona rejects larger parameter
maps.

## Linear Entrypoint

Configure a Linear project named `MineLink` with a board grouped by Status.
The repeatable repository setup command is:

```bash
npm run agent-factory:setup-linear -- --require-key
```

It requires `LINEAR_API_KEY`, creates missing agent-factory labels, creates the
recommended workflow states, ensures the `MineLink` project exists, and writes
`.minelink-dev/reports/linear-agent-factory-setup.md`. Use `--dry-run` first
when auditing a new workspace.
Recommended filters:

- Project is `MineLink`.
- Labels include `agent-ready` and `agent:ona`.

Display properties:

- Assignee
- Labels
- PRs
- Due date
- Project
- Status

Each card should show or link:

- Current status.
- Current Ona Platform Codex session id and validation automation id.
- GitHub issue.
- Branch.
- PR.
- CI run.
- Acceptance video URL and artifact bundle.
- Blocker or remaining gaps.

Linear webhook integration is not enabled by this repository alone. Until an
organization-level Linear webhook or app is configured, use the repository
Linear watcher:

```bash
node scripts/dev/watch-linear-agent-tasks.mjs --max-starts 1
```

The GitHub Actions `Agent Factory Dispatch` workflow also runs this watcher on
a schedule and through manual dispatch with `source=linear`. The watcher uses
`LINEAR_API_KEY`, finds open MineLink issues labeled `agent-ready` and
`agent:ona`, extracts the linked GitHub issue when present, and dispatches the
same Ona automation as the GitHub issue path. This is a polling fallback, not
proof that a native Linear webhook to Ona has been enabled.
Tasks labeled `blocked` are skipped by default and recorded in the watcher
report; `--allow-blocked` is only for explicit diagnostics and is wired through
the manual GitHub Actions input.

Use the same preflight to distinguish a missing Linear secret from watcher
logic failures:

```bash
npm run agent-factory:secrets -- --require-linear-env
```

Current Ona repository webhooks are not assumed to be available. If
`ona webhook list` or `ona webhook create` returns an enterprise-only error,
keep the GitHub Actions dispatcher and Linear watcher as the active trigger
path and record the webhook path as blocked.

## Linear API Status Sync

Ona environments that need to write back to Linear must receive
`LINEAR_API_KEY` through Ona secret/environment configuration. Never pass the
key as an automation parameter, command argument, issue body, PR body, or log
line.

The repository sync entry point is:

```bash
node scripts/dev/sync-linear-status.mjs \
  --issue NIN-7 \
  --status "In Progress" \
  --comment "Ona automation started" \
  --attachment-title "MineLink source task" \
  --attachment-url https://github.com/Ninot1Quyi/MineLink/issues/3 \
  --require-key \
  --require-update
```

The script uses `LINEAR_API_KEY` to load the Linear issue, update its workflow
state, create comments, and attach source/evidence links. It writes
`.minelink-dev/reports/linear-sync.md` with key presence, operation summaries,
and sanitized errors. It never prints the key value.

The Ona CLI validation automation calls this script automatically:

- Before validation: move the Linear issue to `In Progress`.
- After validation and artifact rendering: move the Linear issue to
  `In Review` and comment with report paths.

If `linear_issue=none`, the script skips safely. If a real Linear issue is
provided and `LINEAR_API_KEY` is missing, the Ona automation fails before agent
work so the missing secret is visible.

## Ona Automation Contract

The repository automation spec lives at:

```text
ona/ai-automations/minelink-agent-factory.yaml
```

Create or update the remote Ona automation from the spec:

```bash
ona ai automation create ona/ai-automations/minelink-agent-factory.yaml
```

The checked-in spec uses a manual trigger. Repository issue events are converted
to that manual trigger by `.github/workflows/agent-factory-dispatch.yml`.
After native Ona repository/Linear webhooks are available in the organization,
add those triggers without changing the downstream evidence requirements.

The factory is intentionally sequential (`maxParallel: 1`). The desired product
shape keeps implementation and video review inside one Ona Platform Codex
implementation execution:

```text
implementation agent
  -> node scripts/dev/run-agent-factory-stage.mjs --stage implementation-finalize
  -> implementation agent launches native Codex verifier subagent
  -> node scripts/dev/run-agent-factory-stage.mjs --stage release-finalize
```

Current public Ona automation behavior does not yet prove that shape. The
public `agent` automation step starts the default Ona Agent session
(`Ai-Automations Action Execution`), not the UI Codex selector. The checked-in
spec therefore fails closed: it first runs deterministic tasks that check for an
already accepted Platform Codex readback, writes a blocked readback when that
platform evidence is absent, and only then runs the guarded finalizer wrappers.
This keeps GitHub/Linear -> Ona dispatch measurable without accidentally
accepting a default-agent run as Codex implementation evidence. Replace this
shim only after Ona exposes a documented automation YAML/CLI/API selector for
Ona Platform Codex or another readable provider-mode field.
Retest evidence after disabling the default Ona Agent policy did not change this
behavior: `ona ai automation execute` still called `AgentService/StartAgent`
with `agent_id:"00000000-0000-0000-0000-000000007100"` and
`name:"Ai-Automations Action Execution"`, then failed with
`failed_precondition: agent is disabled by organization policy`. That proves the
policy disables the default automation agent; it does not make automation
fallback to Codex.
Separate from the public automation YAML behavior, Ona's public AgentService API
now documents a lower-level candidate path for programmatic Codex launch:
`StartAgent` accepts an explicit `agentId`, `codeContext`, `codexSettings`,
`mode`, and `sessionId`; `SendToAgentExecution` sends the user prompt to that
execution; `GetAgentExecution` returns `spec.agentId`,
`spec.codexSettings`, `status.codexSettings`, conversation URLs, phase, and
failure details. MineLink captures this candidate path in:

```bash
npm run agent-factory:start-codex -- --start --identity-canary
```

Required environment:

```text
GITPOD_API_KEY or ONA_TOKEN          Ona personal access token
MINELINK_ONA_CODEX_AGENT_ID          Codex app agent id, never the default agent id
MINELINK_ONA_PROJECT_ID              Ona project id, defaults to the MineLink project
MINELINK_ONA_ENVIRONMENT_ID          Optional explicit running environment id
MINELINK_ONA_CREATE_ENVIRONMENT      Optional 1 to create a task environment
MINELINK_ONA_CODEX_REASONING_EFFORT  Optional override; default is EXTRA_HIGH
MINELINK_ONA_CODEX_AGENT_MODE        Optional override; default is AGENT_MODE_GOAL
```

The script refuses to omit `agentId` and refuses the known default automation
agent id `00000000-0000-0000-0000-000000007100`. It writes
`.minelink-dev/reports/ona-platform-codex-api-session.{md,json}` and accepts a
launch probe only when `GetAgentExecution` reads back the requested Codex
`spec.agentId` plus `spec.codexSettings` or `status.codexSettings`. MineLink
requests `AGENT_MODE_GOAL`, the explicit persistent Goal selector, and task
readbacks must include
`Agent execution mode: AGENT_MODE_GOAL`. If `GetAgentExecution` also exposes a
mode field, it must match the requested mode. This proves only the programmatic
Platform Codex launch/readback edge. Because Goal-mode sessions may stay
running, launch/readback is allowed before the execution reaches a terminal
phase. It does not satisfy the implementation readback, acceptance MP4, video
verifier, PR, CI, or product acceptance gates until the task-bound Codex session
performs the work, writes the normal
`.minelink-dev/reports/ona-codex-implementation-session.md`, and the video
release gate passes.
When no explicit `MINELINK_ONA_ENVIRONMENT_ID` is supplied, the launcher must
ignore stopped historical task environments. It may pass an auto-discovered
environment only when that environment is currently running; otherwise it passes
the project id only for environment creation. Since `StartAgent` rejects
project-only context for in-environment agents, GitHub canary modes pass
`--create-environment`: the launcher creates a task environment from the
project/prebuild baseline, polls until the environment and machine are running,
and then calls `StartAgent` with that environment id. This avoids binding new
Codex executions to stale stopped environments whose old branch can leave the
agent execution pending.
The launcher uses the model's available context window and defaults the
configurable reasoning effort to `CODEX_REASONING_EFFORT_EXTRA_HIGH`; no
separate launcher-side context-window-size field is currently part of the
accepted `codexSettings` contract. `.codex/config.toml` pins trusted Codex
clients to the GPT-5.5 project default, the 258400-token context window visible
in the UI, and a high auto-compaction threshold. Treat that as a Codex client
preference only; the Ona API launch remains accepted only by `agentId` and
`codexSettings` readback.
GitHub Actions can run the same probe through
`.github/workflows/ona-platform-codex-probe.yml`. Use `mode=discover` to prove
the repository `ONA_TOKEN` can read Ona policy/API state. Use
`mode=identity-canary` only after supplying the real Codex app agent id through
workflow input or the `MINELINK_ONA_CODEX_AGENT_ID` repository secret. Remote
run `27928149039` proved the identity-canary launch/readback edge from GitHub
Actions: policy readback allowed the Codex app agent id, `StartAgent` and
`SendToAgentExecution` succeeded, and
`GetAgentExecution` returned the requested `spec.agentId`, `codexSettings`,
`PHASE_STOPPED`, `SUPPORTED_MODEL_OPENAI_AUTO`, conversation URLs, and
token-usage counters. The readback did not expose structured `status.outputs`,
so this still does not satisfy implementation, validation, video review, PR,
or product acceptance.
After the fail-closed spec was uploaded, remote canary execution
`019eed14-ed44-7df4-9212-8e1122a7858c` completed with
`WORKFLOW_EXECUTION_PHASE_COMPLETED`, `doneActionCount=1`, and a spec containing
only task steps. That is accepted evidence for the guardrail behavior: the
factory can still run deterministic wrappers, but it no longer starts the
disabled default automation agent.

The two task wrappers run guarded stage lists internally and each stage calls
`scripts/dev/check-platform-codex-evidence.mjs --implementation` or
`--implementation --verifier` with the expected task id, branch, and commit. If
the accepted readback is missing or bound to the wrong task/branch/commit, it
writes
`.minelink-dev/reports/platform-codex-evidence.md` and
`.minelink-dev/reports/agent-factory-stage-<stage>.md`, skips side effects, and
exits 0. Exiting 0 here is deliberate: it lets Ona terminate the automation
with readable blocked evidence instead of leaving a failed Codex task running.
It does not mark validation, video release, PR creation, or product acceptance
as passed.

The implementation gate is required before Linear status sync, validation,
evidence summary, acceptance-video rendering, and video-review request
generation. The verifier gate is additionally required before video release,
final Linear status sync, PR creation, and the final chain report. This
protects the chain if Ona continues later tasks after an earlier task cannot
proceed, and it prevents generic Ona automation output from satisfying the
required Codex agent work.

The spec no longer starts generic `agent` steps while public automation launch
is known to select the default Ona Agent. A true implementation session must be
started through a proven Ona Platform Codex surface, perform the bounded task,
run the requested validation, and write the implementation readback. The task
finalizer then re-runs validation and renders the acceptance MP4. The separate
verifier session must inspect that MP4 and write `video-review.md`; the release
finalizer checks the existing artifacts and finalizes status/PR output without
re-rendering the MP4. If
`.minelink-dev/reports/artifacts/video-review.md` is missing or does not
declare `Verifier: Ona Platform Codex`, the automation must fail before release.

For the current implementation-edge pilot, the supported bounded task is
`implementation-canary` in `.github/workflows/ona-platform-codex-probe.yml`.
It launches the configured Codex app agent through AgentService, sends a
docs-only prompt that may change only
`docs/agent-factory-canaries/<task>.md`, waits for the task branch to appear on
GitHub, and then runs `scripts/dev/fetch-platform-codex-canary.mjs`. The fetch
script is the canonical bridge: it requires the AgentService API readback to
show the configured Codex agent id plus `codexSettings`, requires the canary
file markers to match task, branch, session id, and docs validation, and writes
`.minelink-dev/reports/ona-codex-implementation-session.md` with the fetched
branch head as `Commit:`. The canary markdown file by itself is not accepted
implementation readback and this mode does not count as product acceptance.
`full-chain-canary` extends that pilot to the next edge. The workflow runs
`scripts/dev/run-ona-finalizer-artifacts.mjs` inside the implementation task's
Ona environment to render the trace-driven acceptance summary/MP4 and write the
video-review request. The finalizer checks out the task branch for task content
but injects the workflow/source-commit finalizer scripts after checkout, so an
old task branch cannot regenerate `video-review-request.md` with stale local
defaults. The workflow then sends `--video-verifier-canary` back to the same
implementation AgentService execution, waits for
`docs/agent-factory-canaries/<task>-video-verifier.md`, then runs
`scripts/dev/fetch-platform-codex-video-verifier.mjs`. The fetch script is the
canonical bridge for canary video review: it requires the verifier AgentService
API readback to show the configured Codex agent id, `AGENT_MODE_GOAL`, and
`codexSettings`, checks the verifier canary against the current task, branch,
reviewed commit, summary hash, MP4 hash, and video producer, writes
`.minelink-dev/reports/ona-codex-video-verifier-session.md`, materializes
`.minelink-dev/reports/artifacts/video-review.md`, and lets
`check-video-review.mjs --require-mp4` create the release gate. If the canary
path already exists from an earlier run, the fetch script polls until the file
contains the current Goal-mode execution id, reviewed commit, and artifact
hashes; stale branch content is a timeout failure, not release evidence. This
is still automation-chain evidence only; it does not prove product acceptance.
After the release gate, the Ona release finalizer uploads the verifier-approved
MP4 with `scripts/dev/upload-acceptance-video-storage.mjs` and copies the
upload report back. GitHub Actions writes that returned public MP4 URL into the
PR through `scripts/dev/comment-pr-evidence.mjs`; it must not re-render or
substitute the final task video. GitHub renders external MP4 URLs as links and
strips external `<video>` tags from issue/PR Markdown, so R2 proves public
playback but not GitHub-native inline playback. A directly playable GitHub PR
player requires a GitHub-uploaded attachment URL, which is a separate remaining
factory edge. GitHub Actions artifacts remain the raw
evidence bundle; the default chain must not commit the video binary to the
repository evidence branch when external storage is configured. When a
canary run renders the MP4 on the GitHub runner, the artifact origin must say
`github-actions-canary`; that video is acceptable for chain testing only. Final
task acceptance requires an Ona-produced video artifact, with
`acceptance-video-origin.json` showing producer `ona-task-finalizer`, the
release gate requiring that producer, and the verifier reviewing that exact MP4
hash. When a manual rehearsal needs to prove
`release_gate -> pr`, run the same workflow with
`mode=full-chain-canary` and `create_pr=true`. That optional step calls
`scripts/dev/create-agent-factory-pr.mjs`, creates or updates a draft PR from
the canary branch, writes `.minelink-dev/reports/agent-factory-pr.{md,json}`,
refreshes `agent-factory-chain.json` with the PR URL, then runs
`scripts/dev/cleanup-ona-resources.mjs --allow-dirty` before artifact upload so
any task environment created by the Platform Codex probe is stopped after the
terminal result is recorded, even when finalizer report files leave the task
workspace dirty. This PR edge requires the `AGENT_FACTORY_GITHUB_TOKEN`
repository secret; the default Actions `GITHUB_TOKEN` can be blocked by
repository policy from creating pull requests.
After the draft PR is open, `scripts/dev/wait-agent-factory-pr-ci.mjs` waits
for the PR check rollup, writes
`.minelink-dev/reports/agent-factory-pr-ci.{md,json}`, and the final chain
refresh records the PR checks URL for the `pr -> ci` edge. The next downstream
edge is Linear/GitHub status writeback, not product acceptance. The
`full-chain-canary` workflow now runs `scripts/dev/sync-github-status.mjs`
after PR CI, comments the linked GitHub issue or PR with the final evidence
paths, then runs `scripts/dev/sync-linear-status.mjs` for a linked Linear issue
when `linear_issue` was supplied. The chain report treats absent sources as
not-required: GitHub-only tasks need GitHub writeback, Linear-only tasks need
Linear sync evidence, and linked GitHub+Linear tasks need both.
Before validation or PR finalization, the CLI automation also requires an
implementation-session readback at:

```text
.minelink-dev/reports/ona-codex-implementation-session.md
```

That file must be produced by the implementation session and include:

```text
Agent mode: Ona Platform Codex
Identity: I am Codex running in Ona Platform Codex
Platform evidence: <Ona UI/API evidence that this session was created with Codex selected>
Session id: <Ona session id>
Result: passed
Task id: <current task id>
Branch: <expected branch>
Commit: <current commit>
```

Generic Ona automation, task, SSH, stale readback, wrong branch, wrong commit,
self-reported identity, or default-agent evidence must not satisfy this gate.
The identity line is a session-liveness diagnostic only; the default Ona Agent
can echo that line and still is not Codex. The readback still must include
platform-side Codex selector/API evidence, match the current task, branch, and
commit, and be followed by validation evidence. The chain reporter enforces this with
`--require-platform-codex-implementation`, and
`scripts/dev/run-agent-factory-stage.mjs` prevents every downstream finalizer
stage from producing green validation/PR evidence until the accepted Platform
Codex implementation session has written its task-bound readback.

The same-session video verifier subagent has the same explicit readback requirement:

```text
.minelink-dev/reports/ona-codex-video-verifier-session.md
```

It must identify `Agent mode: Ona Platform Codex`,
`Identity: I am Codex running in Ona Platform Codex`, `Platform evidence`, the
implementation/verifier `Session id`, `Result: passed`, `Task id`, `Branch`,
and `Commit`, in addition to the hash-checked
`.minelink-dev/reports/artifacts/video-review.md` markers.

The finalizer creates or updates the draft PR through
`scripts/dev/create-agent-factory-pr.mjs` after both Platform Codex gates pass.
That script uses GitHub CLI authentication from the environment, writes
`.minelink-dev/reports/agent-factory-pr.md`, and leaves PR creation as a
blocked edge if `gh` is not authenticated or the implementation branch has not
been pushed. The native Ona `pullRequest` step is not used in this factory spec
because it cannot be individually prefixed with the Platform Codex evidence
guard.

If the Ona session shows `Codex authentication failed: the LLM request was
rejected as unauthenticated`, stop the task as `Blocked`. This failure happens
before the Codex agent executes repository commands, so it is not MineLink code
evidence and not a validation failure. `LINEAR_API_KEY` only enables Linear
status sync; it does not authenticate the Ona Platform Codex LLM provider.
Reconnect or repair the Ona account's Codex/OpenAI subscription binding, start
a fresh Codex session, and attach the Ona support bundle if the platform keeps
rejecting the LLM request.

For local environment tasks, Ona discovers:

```text
.ona/automations.yaml
```

Validate it with:

```bash
ona automations validate .ona/automations.yaml
```

The current repository provides the spec and local validation path. It does not
prove that Linear webhooks, GitHub issue webhooks, or remote Ona automation
triggers are enabled in the user organization; those must be configured and
tested in the Ona and Linear UIs.

## Pilot Evidence

As of 2026-06-21, the factory has a real Linear issue, GitHub issue, Ona
automation, and draft PR evidence:

- Linear issue: <https://linear.app/ninotquyi/issue/NIN-7/agent-task-run-ona-agent-factory-pilot-for-minelink-delivery-flow>
- GitHub issue: <https://github.com/Ninot1Quyi/MineLink/issues/3>
- GitHub PR: <https://github.com/Ninot1Quyi/MineLink/pull/4>
- Ona automation: `019ee9f6-9adb-7c93-aaa6-c26337d2278b`
- Read-only Ona `execute` smoke completed against environment
  `019ee8fc-2d61-7dba-aed8-1dfc94d91fce`.
- Broad pilot run `019ee9f8-ea92-70fe-a6b9-d59258e9b976` was cancelled after
  the agent step stayed running too long.
- Bounded pilot run `019ee9ff-86d6-7071-ae45-93866a16e998` completed but
  reported `failedActionCount=1` and did not create a PR through the Ona
  `pullRequest` step.
- Local GitHub connector fallback created PR #4 so the evidence is reviewable.
- GitHub Actions CI run `27903350282` passed on PR #4.
- Ona prebuild readback on 2026-06-21 showed completed baselines
  `019eeb54-6320-7a1c-ab91-be9544a5eb82`,
  `019eeb62-6201-70c9-8bfc-77e334213155`, and
  `019eebd9-8f2b-717b-8a71-f8275561edb3`. The current accepted CI refresh
  baseline is `019eec3a-85b2-75e7-a5f3-db79a7a2ce2c` from GitHub Actions run
  `27919007816`; it completed with `PREBUILD_PHASE_COMPLETED:100`, a
  7.75 GB snapshot, and about 15m10s observed end-to-end time. Older
  overlapping or stale refresh prebuilds, including
  `019eeb05-69dc-75d4-9ffa-a6769945ae50`,
  `019eebf6-2c0c-7b40-8d59-7516ada89b62`, and
  `019eec1c-2959-79b0-a2a0-bf598dae41db`, were cancelled or failed and are not
  accepted as the ready baseline.
- Linear setup readback on 2026-06-21 ran
  `npm run agent-factory:setup-linear -- --require-key` and created the
  `MineLink` project at
  <https://linear.app/ninotquyi/project/minelink-163d36d60652>, missing
  gate/evidence labels, and the target workflow states from `Triage` through
  `Blocked`. The setup report is
  `.minelink-dev/reports/linear-agent-factory-setup.md`.
- Linear watcher negative readback on 2026-06-21 ran against `NIN-7` and
  recorded `Skipped count: 1`, `reason=blocked_label`, and `Dispatched count:
  0` in `.minelink-dev/reports/linear-watch-nin7-blocked.md`.

Current conclusion: Linear issue management, validation automation
registration, `LINEAR_API_KEY`-backed status sync from inside Ona, GitHub PR
creation through the connector fallback, and CI evidence are proven. Earlier
generic Ona Agent executions are reclassified as process smoke only and are not
accepted as MineLink agent evidence because they did not use the Ona Platform
Codex option.

Current blocker: the dispatchers can queue Ona automation and read back the
terminal workflow execution, but the next accepted MineLink edge is still a
programmatically launched or externally verified Ona Platform Codex
implementation session that writes
`.minelink-dev/reports/ona-codex-implementation-session.md` with `Agent mode:
Ona Platform Codex`, platform selector/API evidence, a session id, `Result:
passed`, the current task id, the expected branch, and the current commit. A
2026-06-22 UI canary proved that an automation `agent` step opens
`Ai-Automations Action Execution` with the bottom selector on default `Agent`
and model text `Claude 4.6 Sonnet`; that session can echo
`Identity: I am Codex running in Ona Platform Codex`, so identity self-report is
not evidence. A follow-up CLI canary after disabling the default Ona Agent
policy still attempted to start agent id
`00000000-0000-0000-0000-000000007100` and failed with
`agent is disabled by organization policy`; it did not start Codex. The
checked-in automation now avoids generic `agent` steps and
instead writes a blocked readback unless a separate proven Codex session has
already supplied accepted evidence. The guarded finalizer must stop before
validation, video release, PR creation, or acceptance claims whenever platform
Codex evidence is missing.
Remote execution `019eed14-ed44-7df4-9212-8e1122a7858c` proves the updated
factory shape on Ona: it completed through task-only wrappers and did not call
the disabled default agent. It still leaves the first real blocker at
`ona_automation -> implementation_codex`.
The guarded finalizer stops all later side effects when the Platform Codex
implementation or verifier readback is missing, stale, or bound to the wrong
task/branch/commit.
The finalizer is split into
`scripts/dev/run-agent-factory-stage.mjs --stage implementation-finalize` and
`--stage release-finalize`; missing implementation or verifier evidence writes
blocked stage reports and exits 0 so Ona can close the automation instead of
leaving a failed Codex task running.
The repository dispatcher now waits briefly for the Ona automation execution
readback in CI, so the artifacts can distinguish `queued`, `running`,
`completed`, and `completed_with_failed_actions` instead of flattening every
successful start into `queued`.
GitHub Actions run `27920128911` on `codex/minelink-mvp-engineering` proved
that readback path end to end for GitHub issue #7: dispatcher execution
`019eec65-c9d3-740c-ba01-2460c0b5bb24` reached
`WORKFLOW_EXECUTION_PHASE_COMPLETED` with `failedActionCount=0`, produced
`.minelink-dev/reports/ona-automation-execution.{md,json}`, and raised the
chain report to 31%. The first blocked edge then moved to
`ona_automation -> implementation_codex` because no accepted automated Ona
Platform Codex implementation-session readback was present.
Scheduled Linear watcher run `27920492296` then showed the duplicate-dispatch
hazard: `NIN-8` remained `agent-ready`, so the watcher started another Ona
execution `019eec73-6138-7929-ae90-06039b6a90d3`. The 120-second artifact
readback timed out, but direct Ona readback later showed the execution completed
with `failedActionCount=1`, matching the fail-closed Platform Codex evidence
guard. The dispatcher readback window was raised to 600 seconds after run
`27921207270` showed a guarded finalizer execution completing after about
4m43s while the 240-second CI readback had already timed out. The watcher also treats
started/In Progress/In Review issues as active and marks a successfully
dispatched Linear issue `In Progress` with a comment before the next schedule,
preventing repeated environments for the same unresolved task.
GitHub Actions run `27921514822` then proved the one-task finalizer and
600-second readback path on commit `6c642e8`: GitHub issue #7 dispatch completed
in about 1m13s, Ona execution `019eec9a-4d83-7d71-91a9-615fb2c5722c` reached
`WORKFLOW_EXECUTION_PHASE_COMPLETED` with `failedActionCount=0`, and the chain
report stopped at `ona_automation -> implementation_codex` because the accepted
Platform Codex implementation-session readback was still missing. A later #7
canary started execution `019eecff-dc81-7b0e-b598-d992be932641` and exposed
session `e2c917e1-6d18-4f64-9270-bb5de7b6fb6c`, but it timed out with an active
running action and the UI showed the action was the default Ona Agent rather
than Codex. That run is negative evidence for automatic Codex launch, not
MineLink implementation evidence.
GitHub Actions run `27920695755` proved the Linear dispatch status sync path
for `NIN-8`: the watcher selected the Ready for Agent issue, started Ona
execution `019eec7b-5a90-7ee8-a7d9-83ec135f759f`, updated Linear to
`In Progress`, and created comment `78d49cc3-6bb6-4fd4-b0d9-61d708fdc6d5`.
The corresponding Ona environment used accepted prebuild
`019eec3a-85b2-75e7-a5f3-db79a7a2ce2c` and started a Codex Exec Agent
conversation, but the conversation log showed the Platform Codex evidence gate
failing because the implementation readback was missing. Ona did not close that
automation after the failed command, so the execution was cancelled and the
workflow environment stopped after evidence capture. GitHub Actions run
`27920953104` then proved duplicate prevention after the status sync:
`NIN-8` was skipped with `reason=active_state_In_Progress`,
`Candidate count: 0`, and `Dispatched count: 0`.

The next factory slice must prove a full platform run: Linear task dispatch or
manual launch -> documented Ona Platform Codex session launch with platform
selector/API evidence -> validation automation -> acceptance MP4 -> separate
Ona Platform Codex video verifier -> video release gate -> PR/CI/Linear status
readback. The remaining gap after that is webhook dispatch plus observable
Ona-native `pullRequest` success.

## Acceptance Video

The initial video artifact is trace-driven, not a Minecraft client recording.
It is generated from reports under `.minelink-dev/` and must not be described
as `server_agent` screenshot or GUI evidence.

Generate artifacts:

```bash
node scripts/dev/render-acceptance-video.mjs \
  --task-id gh-45 \
  --branch codex/gh-45-short-task \
  --pr-url https://github.com/Ninot1Quyi/MineLink/pull/45 \
  --task-requirements "quoted task requirements" \
  --require-mp4
```

Outputs:

```text
.minelink-dev/reports/artifacts/acceptance-summary.md
.minelink-dev/reports/artifacts/acceptance.mp4
.minelink-dev/reports/artifacts/video-review-request.md
.minelink-dev/reports/artifacts/video-review.md
.minelink-dev/reports/artifacts/video-release-gate.md
```

If `ffmpeg` is unavailable, the script still writes the summary and records why
MP4 rendering was skipped. For `video-required` tasks, rerun on a host or CI
image with `ffmpeg`; `--require-mp4` must fail the task if MP4 cannot be
created.

After rendering, run:

```bash
node scripts/dev/prepare-video-review-request.mjs --require-mp4
```

This writes `.minelink-dev/reports/artifacts/video-review-request.md` with the
current artifact hashes and verifier assignment. Before publishing or merging
video evidence, the current Ona Platform Codex implementation session must
launch a bounded native Codex verifier subagent to inspect that request, the
task requirements, `acceptance-summary.md`, and `acceptance.mp4`. It writes
`.minelink-dev/reports/artifacts/video-review.md` with these exact markers:

```text
Verifier: Ona Platform Codex
Release decision: pass
Task matched: yes
Video matched: yes
Summary sha256: <current acceptance-summary.md sha256>
MP4 sha256: <current acceptance.mp4 sha256>
```

The full-chain canary may embed the review-request hashes directly so it can
prove the same-session subagent handoff without moving large media through the
repository. Real video-required tasks still need the verifier subagent to have
access to the actual MP4, either because the implementation session rendered it
in the same workspace or because the workflow published a downloadable artifact
URL before the verifier runs. Hash-only canary evidence must not be called real
video inspection.

Then run:

```bash
node scripts/dev/check-video-review.mjs --require-mp4
```

If the implementation and video do not match the task, the verifier must write
`Release decision: fail` or omit the pass markers, stop publication, and return
the task for another implementation iteration.

After the release gate passes, publish the MP4 for PR review from the Ona task
environment:

```bash
node scripts/dev/run-ona-finalizer-artifacts.mjs --stage-group release-upload --environment-id <ona-env> --task-id gh-123 --branch codex/gh-123-task
node scripts/dev/comment-pr-evidence.mjs --repository owner/repo --pr 123 --video-url URL --artifact-url URL
```

The release finalizer calls
`scripts/dev/upload-acceptance-video-storage.mjs --require-upload` inside the
same Ona task environment and copies the upload report back. GitHub comments
with that returned public URL; it does not generate or replace the final task
video. External storage URLs are not GitHub-native attachment URLs, so they are
clickable playback links in PR Markdown. Inline playback on the GitHub page
requires a later programmatic GitHub attachment upload path.

`MINELINK_VIDEO_STORAGE_ACCESS_KEY_ID` and
`MINELINK_VIDEO_STORAGE_SECRET_ACCESS_KEY` must be configured only as GitHub or
Ona secrets. Non-secret settings such as provider, endpoint, bucket, public base
URL, and prefix can be repository or Ona variables. A GitHub Actions artifact
URL is still included for the evidence zip, but it is not the playable review
surface.

## Remaining Gaps

- Linear webhook creation and status sync are documented but not enabled by
  this repository alone. Status sync is executable through `LINEAR_API_KEY`
  when the secret is present in the Ona environment.
- GitHub issue-to-Ona dispatch still needs a secret-backed dispatcher or an Ona
  webhook/integration. The manual Ona automation can be created from the repo
  spec, but issue/PR triggers are not enabled by the repository alone.
- Ona Platform Codex launch and session readback still need observable evidence
  for the current PR. Public automation `agent` steps currently launch the
  default Ona Agent, so generic Agent/Claude sessions and self-reported identity
  are not accepted for this gap.
- The guarded GitHub CLI PR step still needs observable success or actionable
  failure logs from a real Ona Platform Codex implementation branch. Until
  then, the GitHub connector fallback can open the review PR, but it is a
  fallback and must be reported as such.
- Acceptance video is a trace visualization plus a dedicated Codex review gate.
  Real Minecraft GUI capture remains future observer-client work.
- Agent output still needs human review before a gate can become
  `product-accepted`.
