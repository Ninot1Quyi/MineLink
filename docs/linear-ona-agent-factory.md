# MineLink Linear and Ona Agent Factory

This document defines the AI-native engineering delivery system used to develop
MineLink. MineLink remains the product. The factory below is the production
line that turns bounded Linear or GitHub tasks into Ona agent work, PRs, CI
evidence, and acceptance artifacts.

## Delivery Shape

```text
Linear issue or GitHub issue
  -> agent task contract
  -> Ona AI automation
  -> one Ona environment / one branch
  -> validation and evidence artifacts
  -> draft GitHub PR
  -> CI, acceptance summary, optional acceptance MP4
  -> Linear/GitHub status update
```

Manual `ona environment ssh` is a debugging tool only. The durable flow should
use `ona ai automation start` or a UI/webhook integration that starts the same
automation with task parameters.

## Status Model

Use these statuses for the Linear board and GitHub issue/PR comments:

| Status | Meaning |
| --- | --- |
| `Triage` | Task is being shaped and is not ready for an agent. |
| `Ready for Agent` | Task contract is complete and labels include `agent-ready`. |
| `Agent Queued` | Ona automation was requested but has not started execution. |
| `Agent Running` | Ona agent is editing, validating, or preparing evidence. |
| `PR Open` | Draft PR exists and links the source task. |
| `CI Running` | GitHub Actions is running required checks. |
| `Video Rendering` | Acceptance summary/MP4 artifact generation is running. |
| `Human Review` | Automation is done; reviewer must inspect evidence and gaps. |
| `Accepted` | Reviewer accepted the PR and updated gate evidence if applicable. |
| `Blocked` | Agent cannot continue without a real dependency or human decision. |

## Required Labels

- `agent-ready`: task contract is complete.
- `agent:ona`: task should be handled by Ona AI automation.
- `real-neoforge-required`: product behavior requires real NeoForge evidence.
- `video-required`: PR must include an acceptance video artifact or an explicit
  reason why MP4 could not be rendered.
- `gate:0` through `gate:11`: acceptance gate touched by the task.
- `mock-only`, `smoke-only`, `real-partial`, `product-accepted`: current
  evidence class, matching `docs/minelink-acceptance.md`.
- `blocked`: current task cannot progress.
- `needs-human-review`: automation is complete but reviewer acceptance remains.

## Task Contract

Every Linear or GitHub task must include:

- Task: one sentence outcome.
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

Manual pilot command:

```bash
ona ai automation start <automation-id> \
  --project 019ee8ed-9e1b-7cd8-9b1b-af0c8ee27edb \
  --param task_id=gh-45 \
  --param issue_url=https://github.com/Ninot1Quyi/MineLink/issues/45 \
  --param linear_issue=none \
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
- Current Ona automation or agent execution id.
- GitHub issue.
- Branch.
- PR.
- CI run.
- Acceptance video artifact.
- Blocker or remaining gaps.

Linear webhook integration is not enabled by this repository alone. Until an
organization-level Linear webhook or app is configured, create a matching
GitHub issue from the Linear card and start the Ona automation with the Linear
issue key in `--param linear_issue=LIN-123`.

## Ona Automation Contract

The repository automation spec lives at:

```text
ona/ai-automations/minelink-agent-factory.yaml
```

Create or update the remote Ona automation from the spec:

```bash
ona ai automation create ona/ai-automations/minelink-agent-factory.yaml
```

The checked-in spec uses a manual trigger because the current Ona CLI rejects
pull-request triggers unless an Ona webhook or integration already exists.
After that integration is configured, add a repository trigger in Ona UI or in
an organization-specific automation spec.

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

As of 2026-06-21, the GitHub side of the factory has a real pilot issue:

- GitHub issue: <https://github.com/Ninot1Quyi/MineLink/issues/3>
- Ona automation: `019ee9f6-9adb-7c93-aaa6-c26337d2278b`
- Read-only Ona `execute` smoke completed against environment
  `019ee8fc-2d61-7dba-aed8-1dfc94d91fce`.
- Broad pilot run `019ee9f8-ea92-70fe-a6b9-d59258e9b976` was cancelled after
  the agent step stayed running too long.
- Bounded pilot run `019ee9ff-86d6-7071-ae45-93866a16e998` completed but
  reported `failedActionCount=1` and did not create a PR through the Ona
  `pullRequest` step.

Current conclusion: Ona AI automation registration and execution are proven,
but the full issue-to-Ona-to-PR chain is not accepted yet. The next factory
slice must make the PR step observable and reliable, or replace it with a
documented GitHub connector fallback until the Ona PR step failure mode is
understood.

Linear remains unproven in this environment: no Linear CLI, connector, or API
token was available when the pilot was run.

## Acceptance Video

The initial video artifact is trace-driven, not a Minecraft client recording.
It is generated from reports under `.minelink-dev/` and must not be described
as `server_agent` screenshot or GUI evidence.

Generate artifacts:

```bash
node scripts/dev/render-acceptance-video.mjs \
  --task-id gh-45 \
  --branch codex/gh-45-short-task \
  --pr-url https://github.com/Ninot1Quyi/MineLink/pull/45
```

Outputs:

```text
.minelink-dev/reports/artifacts/acceptance-summary.md
.minelink-dev/reports/artifacts/acceptance.mp4
```

If `ffmpeg` is unavailable, the script still writes the summary and records why
MP4 rendering was skipped. For `video-required` tasks, rerun on a host or CI
image with `ffmpeg`, or pass `--require-mp4` and fail the task if MP4 cannot be
created.

## Remaining Gaps

- Linear webhook creation and status sync are documented but not enabled by
  this repository alone.
- GitHub issue-to-Ona dispatch still needs a secret-backed dispatcher or an Ona
  webhook/integration. The manual Ona automation can be created from the repo
  spec, but issue/PR triggers are not enabled by the repository alone.
- Acceptance video is a trace visualization. Real Minecraft GUI capture remains
  future observer-client work.
- Agent output still needs human review before a gate can become
  `product-accepted`.
