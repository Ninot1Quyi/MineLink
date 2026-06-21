# MineLink Linear and Ona Agent Factory

This document defines the AI-native engineering delivery system used to develop
MineLink. MineLink remains the product. The factory below is the production
line that turns bounded Linear or GitHub tasks into Ona Platform Codex work,
PRs, CI evidence, and acceptance artifacts.

## Delivery Shape

```text
Linear issue or GitHub issue
  -> agent task contract
  -> Ona Platform Codex agent session
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
| `Video Review` | A separate Ona Platform Codex verifier is comparing the task requirements against the MP4 and summary. |
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
through `ona ai automation start`, writes
`.minelink-dev/reports/agent-factory-dispatch.md`, regenerates
`.minelink-dev/reports/agent-factory-chain.md`, and comments on the GitHub
issue. It requires `ONA_TOKEN` in GitHub secrets to start Ona from CI; missing
Ona authentication is recorded as a blocked edge instead of being treated as a
MineLink validation failure.

Before debugging a failed dispatcher run, run the secret-safe preflight:

```bash
npm run agent-factory:secrets -- --require-github-secrets --require-ona-context
```

The preflight checks only credential presence and Ona CLI context. It never
prints `ONA_TOKEN`, `LINEAR_API_KEY`, GitHub tokens, or any other secret value.

Manual pilot command:

```bash
ona ai automation start <automation-id> \
  --project 019ee8ed-9e1b-7cd8-9b1b-af0c8ee27edb \
  --param task_id=gh-45 \
  --param issue_url=https://github.com/Ninot1Quyi/MineLink/issues/45 \
  --param linear_issue=NIN-7 \
  --param github_issue=https://github.com/Ninot1Quyi/MineLink/issues/45 \
  --param branch=codex/gh-45-short-task \
  --param pr_title="Advance MineLink task gh-45" \
  --param acceptance_gate="Gate 2" \
  --param agent_instruction="Run a bounded validation pilot. Do not edit files unless validation fails." \
  --param validation_scope=docs \
  --param scenarios=none \
  --wait
```

Webhook or GitHub Actions dispatch can call the same command after validating
the issue body. Do not paste tokens into shell history; use Ona/GitHub secret
storage for any dispatcher credentials.

## Linear Entrypoint

Configure a Linear project named `MineLink` with a board grouped by Status.
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
- Acceptance video artifact.
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

The spec intentionally does not contain a generic `agent` step. Start the
implementation and video-verifier work in the Ona Platform UI with the Codex
agent option selected. The implementation Codex session must run validation and
render the acceptance MP4; the separate verifier Codex session must inspect
that MP4 and write `video-review.md`; the CLI automation then regenerates the
hash-based `video-review-request.md` without re-rendering the MP4, checks the
existing artifacts, and finalizes status/PR output. If
`.minelink-dev/reports/artifacts/video-review.md` is missing or does not
declare `Verifier: Ona Platform Codex`, the automation must fail before release.

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

Current conclusion: Linear issue management, validation automation
registration, `LINEAR_API_KEY`-backed status sync from inside Ona, GitHub PR
creation through the connector fallback, and CI evidence are proven. Earlier
generic Ona Agent executions are reclassified as process smoke only and are not
accepted as MineLink agent evidence because they did not use the Ona Platform
Codex option.

Current blocker: Ona Platform Codex launch reaches the Codex provider selection
surface but fails with `Codex authentication failed: the LLM request was
rejected as unauthenticated` before command execution. Until the Ona account's
Codex/OpenAI subscription binding is fixed and a new Codex session runs
validation, the factory is not end-to-end accepted.

Additional current blocker: The Ona CLI automation example exposes a generic
`agent` step, but the accepted MineLink path requires the Ona Platform Codex
agent option. Until Ona exposes a repository-configurable or API-visible way to
start that Codex option automatically, the dispatchers can queue the automation
and produce chain evidence but cannot prove the implementation-session edge.

The next factory slice must prove a full platform run: Linear task dispatch or
manual launch -> Ona Platform Codex implementation session -> validation
automation -> acceptance MP4 -> separate Ona Platform Codex video verifier ->
video release gate -> PR/CI/Linear status readback. The remaining gap after
that is webhook dispatch plus observable Ona-native `pullRequest` success.

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
video evidence, a separate Ona Platform Codex session must inspect that request,
the task requirements, `acceptance-summary.md`, and `acceptance.mp4`. It writes
`.minelink-dev/reports/artifacts/video-review.md` with these exact markers:

```text
Verifier: Ona Platform Codex
Release decision: pass
Task matched: yes
Video matched: yes
Summary sha256: <current acceptance-summary.md sha256>
MP4 sha256: <current acceptance.mp4 sha256>
```

Then run:

```bash
node scripts/dev/check-video-review.mjs --require-mp4
```

If the implementation and video do not match the task, the verifier must write
`Release decision: fail` or omit the pass markers, stop publication, and return
the task for another implementation iteration.

## Remaining Gaps

- Linear webhook creation and status sync are documented but not enabled by
  this repository alone. Status sync is executable through `LINEAR_API_KEY`
  when the secret is present in the Ona environment.
- GitHub issue-to-Ona dispatch still needs a secret-backed dispatcher or an Ona
  webhook/integration. The manual Ona automation can be created from the repo
  spec, but issue/PR triggers are not enabled by the repository alone.
- Ona Platform Codex launch and session readback still need observable evidence
  for the current PR. Generic Ona Agent evidence is not accepted for this gap.
- Ona native `pullRequest` step still needs observable success or actionable
  failure logs. Until then, the GitHub connector fallback can open the review
  PR, but it is a fallback and must be reported as such.
- Acceptance video is a trace visualization plus a dedicated Codex review gate.
  Real Minecraft GUI capture remains future observer-client work.
- Agent output still needs human review before a gate can become
  `product-accepted`.
