# MineLink Agent Workbench

This document defines how Ona Platform Codex and other cloud worktree agents
should work on MineLink without relying on hidden thread context.

## Operating Model

Use limited parallelism until the acceptance gates and automation are stronger:

```text
one environment = one task = one branch = one PR
```

The local Codex thread remains the integration and acceptance owner. Cloud
agents should take narrow tasks with explicit write scopes and validation.
When the task runs in Ona, select the platform **Codex** agent in Goal mode.
The programmatic path requests that mode as `AGENT_MODE_GOAL`. The default Ona
Agent mode and one-shot `AGENT_MODE_EXECUTION` are not accepted as MineLink
implementation or verifier evidence. Self-reported identity is not enough: the
default Ona Agent can echo `Identity: I am Codex running in Ona Platform Codex`.
Accepted Ona evidence must include platform-side Codex selector/API evidence,
`Agent execution mode: AGENT_MODE_GOAL`, and task/branch/commit-bound readback.
Use `docs/ona-migration.md` for the migration runbook and
`docs/linear-ona-agent-factory.md` for the Linear/GitHub -> Ona agent factory.
Use `docs/agent-task-queue.md` for ready tasks.

## Task Classes

| Class | Parallel Safety | Typical Scope | Required Validation |
| --- | --- | --- | --- |
| Docs/architecture | high | `*.md`, `.github/ISSUE_TEMPLATE`, `.devcontainer` | `bash scripts/dev/verify-agent-task.sh --scope docs` |
| Install/bootstrap | high | `.devcontainer`, package lock, install docs, install workflow | `bash scripts/dev/verify-agent-task.sh --scope install` |
| CI/reporting | medium | `.github/workflows`, `scripts/dev`, report summarizers | `bash scripts/dev/verify-agent-task.sh --scope fast` |
| Host/Gateway | medium | `packages/host`, protocol forwarding tests | fast plus `mine_tree` HTTP e2e |
| SDK/helpers | medium | `packages/sdk`, examples docs | fast plus relevant mock e2e |
| Runtime gate slice | low | one gate, one runtime behavior | fast, mock e2e, real NeoForge e2e |
| NeoForge core runtime | single owner | `MineLinkEndpointBootstrap.java` and fixtures | targeted tests, real NeoForge e2e, short soak |

Do not run multiple agents against the same low-safety lane unless the write
sets are disjoint and a human or lead agent is integrating.

## Task Contract

Every agent-ready issue or PR must state:

- Task: the one-sentence outcome.
- Required agent mode: Ona Platform Codex Goal mode (`AGENT_MODE_GOAL`) for Ona tasks.
- Scope: exact modules or files the agent may change.
- Forbidden: assertions, boundaries, or files the agent must not weaken.
- Acceptance gate: which gate in `docs/minelink-acceptance.md` is affected.
- Mock/smoke reduction: which assumption is being replaced by real behavior.
- Validation: exact commands to run.
- Evidence: report paths and CI links to paste into the PR.
- Acceptance video required: yes/no, expected MP4 path, and required dedicated
  Codex video-review path.
- Linked GitHub issue and linked Linear issue, when applicable.
- Expected PR title and branch convention.
- Remaining gaps: what this task does not complete.

## Default Verification

Run the conditional verification entry point unless the issue provides a more
specific command:

```bash
bash scripts/dev/verify-agent-task.sh
```

Use explicit scopes when needed:

```bash
bash scripts/dev/verify-agent-task.sh --scope docs
bash scripts/dev/verify-agent-task.sh --scope fast
bash scripts/dev/verify-agent-task.sh --scope runtime --scenarios craft_smoke,craft_negative
bash scripts/dev/verify-agent-task.sh --scope neoforge --scenarios guard_boundaries
bash scripts/dev/verify-agent-task.sh --scope install
bash scripts/dev/verify-agent-task.sh --scope all
```

The summary file is written to:

```text
.minelink-dev/reports/agent-task-summary.md
```

Paste that summary into PRs together with any scenario report paths.

## Automatic and Conditional Triggers

Use automation to reduce agent memory load:

- Devcontainer bootstrap uses the MineLink GHCR cache-prewarmed image with Node
  22, Java 21, GitHub CLI, `ffmpeg`, image-provided `python3`, npm cache, and
  Gradle user-home cache. It still runs `scripts/dev/bootstrap-prebuild.sh`
  automatically when a cloud worktree is created.
- `install-smoke.sh` clones the committed ref into a separate checkout, runs
  `npm ci`, and records install evidence under `.minelink-dev/install-smoke/`.
- `.ona/automations.yaml` provides Ona-native environment tasks for docs, fast,
  NeoForge guard, and acceptance artifact commands.
- `ona/ai-automations/minelink-agent-factory.yaml` is the Ona CLI finalizer and
  fail-closed evidence gate for Linear sync, verification, evidence summaries,
  video-review request preparation, video-release gating, and PR creation after
  a proven Ona Platform Codex session does the bounded work and a separate
  Codex verifier reviews the MP4. Public Ona automation `agent` steps currently
  start the default Ona Agent, so they are not used as implementation evidence.
- `.github/workflows/agent-factory-dispatch.yml` is the GitHub/Linear source
  dispatcher. It validates agent-ready GitHub issues, polls Linear as a
  fallback source, starts the shared Ona automation, and uploads dispatch plus
  chain reports. For GitHub issues it also triggers the Platform Codex
  full-chain workflow after dispatch acceptance.
- `dispatch-agent-factory.mjs`, `watch-linear-agent-tasks.mjs`, and
  `report-agent-factory-chain.mjs` keep the full issue-to-PR automation chain
  visible as nodes, edges, blockers, and remaining percentage.
- `trigger-agent-factory-full-chain.mjs` connects an accepted source dispatch
  to `ona-platform-codex-probe.yml` in `full-chain-canary` mode.
- `sync-github-status.mjs` and `sync-linear-status.mjs` are the final
  status-writeback surfaces after PR CI. GitHub-only tasks require GitHub
  comment evidence; linked Linear tasks also require Linear sync evidence.
- `check-agent-factory-secrets.mjs` records secret-safe credential and Ona
  context preflight evidence before dispatcher and Linear watcher runs. It
  reports presence and active-context status only, never credential values.
  The chain reporter consumes that JSON to surface concrete next actions on the
  blocked dispatcher edge.
- `sync-linear-status.mjs` lets Ona write Linear status/comments/evidence links
  through `LINEAR_API_KEY` without exposing the key in logs.
- `verify-agent-task.sh` auto-classifies changed files and chooses docs, fast,
  runtime, or NeoForge checks.
- `check-agent-workbench.sh` verifies that Ona migration docs, task queue,
  issue template, PR template, devcontainer, and install smoke entry points
  stay present, and blocks Python feature pins that slow Ona rebuilds.
- GitHub CI runs the fast contract suite on pushes and PRs.
- `summarize-evidence.mjs` writes `.minelink-dev/reports/ci-evidence-summary.md`
  and appends the same evidence index to the GitHub Step Summary.
- `render-acceptance-video.mjs` writes trace-driven acceptance artifact
  summaries and optional MP4 files under `.minelink-dev/reports/artifacts/`.
- `.ona/automations.yaml` keeps rendering and release checking as separate
  tasks so the video verifier can inspect the actual MP4 before publication.
- `prepare-video-review-request.mjs` writes the current artifact hashes and
  verifier assignment into `.minelink-dev/reports/artifacts/video-review-request.md`.
- `check-video-review.mjs` fails release unless the implementation session's
  native Codex verifier subagent has compared the task requirements against the
  summary and MP4.
- The install smoke workflow uploads `minelink-install-smoke-evidence` for
  install/workbench/bootstrap changes.
- The heavy NeoForge workflow is skipped for docs-only and workbench-only
  changes, but still runs for code, runtime, scripts, and workflow changes.
- The real NeoForge workflow also runs on a daily schedule and manual dispatch.

Automation must not reduce acceptance truth. A skipped heavy workflow means the
change did not need that class of evidence, not that the related product gate is
accepted.

## Recommended Ona Tasks

Use `docs/agent-task-queue.md` as the source of truth for ready work. Good
parallel tasks should stay in docs/architecture, CI/reporting, install proof,
or one narrow runtime gate slice.

Avoid:

- Multiple agents editing `MineLinkEndpointBootstrap.java` at once.
- Broad protocol, mock runtime, and replay rewrites without one owner.
- Claims that mock, replay, or smoke evidence completes a product gate.
- Any task that adds new public game power without server-side guard checks.

## PR Evidence Template

```md
Acceptance gate:

Mock/smoke assumption reduced:

Files changed:

Validation:
- [ ] `bash scripts/dev/verify-agent-task.sh ...`
- [ ] real NeoForge e2e, if product behavior changed

Evidence paths:
- `.minelink-dev/reports/agent-task-summary.md`
- `.minelink-dev/reports/ci-evidence-summary.md`
- `.minelink-dev/reports/linear-sync.md`, when a Linear issue is linked
- `.minelink-dev/reports/artifacts/acceptance-summary.md`
- `.minelink-dev/reports/artifacts/acceptance.mp4`
- `.minelink-dev/reports/artifacts/video-review.md`
- `.minelink-dev/reports/artifacts/video-release-gate.md`
- `.minelink-dev/install-smoke/install-smoke-report.md`, for install/bootstrap tasks
- `.minelink-dev/<scenario>/reports/<scenario>-result.json`

Remaining product gaps:
```

## Next Runtime Slice Queue

Keep this queue narrow and update it after each accepted slice:

1. Gate 2 action lifecycle: public status/poll/cancel tools with real NeoForge
   queued, completed, cancelled, expired evidence. Completed in the current
   branch; next Gate 2 work is persistent body lifecycle plus `running` and
   `failed` states.
2. Gate 10 install: fresh clone plus Ona/devcontainer proof for mock CI and
   documented NeoForge smoke.
3. Gate 11 stability: longer real NeoForge soak profile with process and queue
   metrics.
4. Gate 8 social persistence: restart-durable local events and notice board
   evidence.
5. Gate 7 Create breadth: belt transport and broader kinetic diagnostics.
