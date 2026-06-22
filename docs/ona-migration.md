# MineLink Ona Migration Runbook

This runbook moves MineLink from a single local Codex thread toward bounded Ona
cloud worktrees without losing the anti-mock product boundary.

## Migration Goal

Ona is used as a cloud worktree platform for narrow, verifiable MineLink tasks.
MineLink agent work must use the **Ona Platform Codex** agent option. The Ona
CLI automation is a validation, artifact, PR, and status-sync runner; it is not
the implementation agent. Ona is not a replacement for the acceptance process.
The integration owner still checks the acceptance gate, local evidence, real
NeoForge evidence when needed, and remote CI before merging.

## Ona Environment Contract

One Ona environment maps to exactly one task:

```text
one environment = one issue = one branch = one PR
```

Every environment must start from a clean branch and read these files first:

- `AGENTS.md`
- `ARCHITECTURE.md`
- `docs/minelink-acceptance.md`
- `docs/agent-workbench.md`
- `docs/linear-ona-agent-factory.md`
- `docs/agent-task-queue.md`

Use `.devcontainer/devcontainer.json` for bootstrap. The default file uses the
MineLink GHCR cache-prewarmed image for the project work line:

```text
ghcr.io/ninot1quyi/minelink-devcontainer:codex-minelink-mvp-engineering
```

The image provides Node 22, Java 21, GitHub CLI, `ffmpeg`, image or OS provided
`python3`, npm cache, and Gradle user-home cache. It still runs
`scripts/dev/bootstrap-prebuild.sh` as the final setup and verification gate.
If Docker smoke or Ona prebuild readback fails, record the failure and fix the
image or temporarily return to the public Node 22 base image. Do not pin the
Python feature to a source-built version for Ona worktrees.

OpenAI subscription binding and Codex model selection belong to the Ona
Platform account/session. Do not add OpenAI API keys, proxy credentials, or
subscription tokens to the repository, task body, automation parameters, or
logs.

Use `ona/<task-name>` or `agent/<task-name>` branches for Ona-managed tasks.
GitHub Actions also accepts `codex/**` for local Codex worktrees.

## Task Intake

Only tasks with `agent-ready` scope are suitable for Ona. Each task must define:

- Task: the concrete requested outcome.
- Required agent mode: Ona Platform Codex.
- Scope: exact files or directories the agent may change.
- Forbidden changes: assertions, boundaries, or files that must not be weakened.
- Acceptance gate: the gate in `docs/minelink-acceptance.md`.
- Mock/smoke reduction: the assumption being converted toward real behavior.
- Validation: exact commands.
- Evidence: report paths and GitHub Action URLs.
- Acceptance video required: yes/no and expected artifact paths.
- Linked GitHub issue and linked Linear issue.
- Expected PR title and branch convention.
- Remaining gaps: what the task does not complete.

Use `.github/ISSUE_TEMPLATE/agent-task.yml` for new tasks and
`.github/pull_request_template.md` for PR evidence.

## Validation Matrix

| Task Class | Default Command | Required Escalation |
| --- | --- | --- |
| Docs/workbench | `bash scripts/dev/verify-agent-task.sh --scope docs` | none |
| Install/bootstrap | `bash scripts/dev/verify-agent-task.sh --scope install` | real NeoForge install for server/LAN packaging claims |
| CI/scripts | `bash scripts/dev/verify-agent-task.sh --scope fast` | runtime if scenario behavior changes |
| Host/Gateway | `bash scripts/dev/verify-agent-task.sh --scope runtime --scenarios mine_tree` | HTTP e2e for transport changes |
| SDK/protocol helpers | `bash scripts/dev/verify-agent-task.sh --scope runtime --scenarios guard_boundaries` | real NeoForge if game semantics change |
| Runtime gate slice | `bash scripts/dev/verify-agent-task.sh --scope neoforge --scenarios <scenario>` | short soak for stateful behavior |
| Release/stability | `bash scripts/dev/verify-agent-task.sh --scope all` | longer soak or self-hosted runner profile |

The default command writes:

```text
.minelink-dev/reports/agent-task-summary.md
```

Install/bootstrap tasks also write:

```text
.minelink-dev/install-smoke/install-smoke-report.md
.minelink-dev/install-smoke/install-smoke.log
```

CI, Install Smoke, and real NeoForge workflows also write an evidence index:

```text
.minelink-dev/reports/ci-evidence-summary.md
.minelink-dev/install-smoke/ci-evidence-summary.md
```

The guard commands also write:

```text
.minelink-dev/reports/architecture-guard.md
.minelink-dev/reports/agent-workbench-guard.md
```

Acceptance artifact generation writes:

```text
.minelink-dev/reports/artifacts/acceptance-summary.md
.minelink-dev/reports/artifacts/acceptance.mp4
.minelink-dev/reports/artifacts/video-review.md
.minelink-dev/reports/artifacts/video-release-gate.md
```

## Automatic Guards

MineLink uses automation to reduce agent memory load:

- `scripts/dev/check-architecture-guard.sh` prevents architecture-sensitive
  drift without a matching `ARCHITECTURE.md` update.
- `scripts/dev/check-agent-workbench.sh` keeps the Ona/agent entry points,
  templates, task queue, and fast devcontainer bootstrap contract present.
- `scripts/dev/verify-agent-task.sh` runs both guards before tests.
- `scripts/dev/install-smoke.sh` clones the committed ref into a separate
  checkout and proves `npm ci` plus fast verification from a clean install.
- `scripts/dev/summarize-evidence.mjs` aggregates scenario, soak, install, and
  stability reports into a Markdown index without changing workflow pass/fail
  semantics.
- `scripts/dev/render-acceptance-video.mjs` turns existing reports into a
  trace-driven acceptance summary and optional MP4 artifact.
- `scripts/dev/prepare-video-review-request.mjs` turns the current summary and
  MP4 hashes into a verifier handoff file for the separate Ona Platform Codex
  review step.
- `scripts/dev/check-video-review.mjs` blocks release unless a separate Ona
  Platform Codex verifier report confirms `Release decision: pass`,
  `Task matched: yes`, `Video matched: yes`, and current summary/MP4 SHA-256
  hashes against the rendered MP4.
- `scripts/dev/sync-linear-status.mjs` uses `LINEAR_API_KEY` from the Ona
  environment to update Linear issue status, comments, and evidence links
  without printing the secret.
- `.ona/automations.yaml` defines Ona-native environment tasks.
- `ona/ai-automations/minelink-agent-factory.yaml` defines the Ona CLI
  finalizer that should be started by manual pilot, GitHub dispatch, or Linear
  webhook integration. It now fails closed before implementation if the
  environment lacks a real Platform Codex readback with platform selector/API
  evidence.
- `.github/workflows/ci.yml` runs both guards on every push and PR.
- `.github/workflows/install-smoke.yml` uploads
  `minelink-install-smoke-evidence` for install/workbench/bootstrap changes.
- `.github/workflows/minecraft-neoforge.yml` runs real NeoForge smoke on code,
  script, workflow, and runtime changes.

These guards only protect process and evidence shape. They do not convert a gate
to `product-accepted`.

## CI Monitoring

Remote CI is a final confirmation layer. Prefer local validation for fast
iteration, then check GitHub Actions after push:

- Fast CI workflow: `.github/workflows/ci.yml`
- Real Minecraft workflow: `.github/workflows/minecraft-neoforge.yml`
- Install smoke workflow: `.github/workflows/install-smoke.yml`
- Evidence artifacts: `minelink-dev-evidence` and
  `minelink-neoforge-smoke-evidence`; install/bootstrap runs also upload
  `minelink-install-smoke-evidence`

Use the GitHub connector when available. If a local `gh` token is not already
configured, do not paste secrets into shell history just to fetch logs.

## Secrets Policy

Never commit or print:

- GitHub tokens.
- Admission tokens.
- Microsoft credentials.
- OpenAI/API keys.
- `LINEAR_API_KEY`.
- Minecraft `eula.txt`.
- Server secrets or non-loopback gateway bearer tokens.

Local validation may set `MINELINK_ACCEPT_EULA=1` because the repository owner
has authorized EULA acceptance for development testing. Do not commit generated
EULA files.

## Automation Readiness

Ona Platform Codex is the target execution surface for implementation and video
verification. `ona environment ssh` is only for debugging and readback. Public
Ona automation `agent` steps currently start the default Ona Agent, not the
Codex conversation-menu option, so the checked-in Ona CLI automation does not
try to perform implementation through a generic agent step. It first verifies
whether a separate Platform Codex session has already written task/branch/commit
bound readback with platform selector/API evidence; without that evidence it
writes `Result: blocked` and the guarded finalizers skip validation, video
release, and PR work. The implementation session must identify itself as
`Identity: I am Codex running in Ona Platform Codex`, include `Platform
evidence`, and then write task/branch/commit-bound Platform Codex readback
before validation or acceptance video rendering can run; the verifier session
must write matching identity/platform evidence/readback and `video-review.md`
before release/PR finalization can run. The identity line is a diagnostic signal
only: the default Ona Agent can echo it and still is not accepted as Codex. The
release finalizer does not re-render the MP4 after review. A valid validation
pilot starts
`ona/ai-automations/minelink-agent-factory.yaml` through:

```bash
ona ai automation create ona/ai-automations/minelink-agent-factory.yaml
ona ai automation start <automation-id> --project 019ee8ed-9e1b-7cd8-9b1b-af0c8ee27edb --param task_id=gh-45 --param linear_issue=NIN-7 --param github_issue=https://github.com/Ninot1Quyi/MineLink/issues/45 --param ona_automation=<automation-id> --param ona_project=019ee8ed-9e1b-7cd8-9b1b-af0c8ee27edb --param branch=codex/gh-45-short-task --param pr_title="Advance MineLink task gh-45" --param acceptance_gate="Gate 2" --param validation_scope=docs --param scenarios=none --wait
```

When `linear_issue` is a real key, the Ona environment must have
`LINEAR_API_KEY` set. The automation fails early if the key is missing, and the
sync script writes `.minelink-dev/reports/linear-sync.md` without exposing the
key value.

GitHub Actions dispatcher runs wait for a bounded Ona execution readback and
then pass `--cancel-ona-execution-on-timeout`. A timed-out execution is cancelled
with `ona ai automation cancel-execution` and recorded as `timed_out_cancelled`
only when no action is actively running. If an Ona agent action is still
running, the dispatcher records `timed_out`, preserves the session id, and
leaves the agent alive for follow-up monitoring. This is a stale-work cleanup
guard, not implementation evidence; the chain still requires the separate
Platform Codex implementation and video-verifier readbacks.

`LINEAR_API_KEY` does not authenticate the Codex LLM provider. If the Ona UI
shows `Codex authentication failed: the LLM request was rejected as
unauthenticated`, treat the environment as not started: no repository commands
ran, no agent evidence exists, and no acceptance video can be published from
that session. Fix the Ona account's Codex/OpenAI subscription binding, start a
new Platform Codex session, and use the platform support bundle if retrying the
fresh session still fails.

Linear or GitHub issue webhooks are not proven enabled until a real issue
creates or links a documented Ona Platform Codex session, writes Linear status
from inside Ona, checks the acceptance MP4 through a separate Codex video
verifier, and opens a draft PR without manual SSH.
The checked-in Ona AI automation uses a manual trigger because Ona rejects PR
triggers until a webhook or integration is configured in the organization.

Generic Ona Agent runs are not accepted as MineLink agent evidence. If a pilot
uses `Ai-Automations Action Execution`, the default `Agent` selector, or a
Claude-backed Ona Agent instead of Platform Codex, record it as process smoke or
negative launch evidence only. Self-reported identity is not enough; rerun the
task from a proven Codex surface or wait for a documented automation Codex
selector/API.
Disabling the default Ona Agent in organization policy is not enough by itself:
the public automation `agent` step still requests the default automation agent
id and fails with `agent is disabled by organization policy` instead of
falling back to Codex.

Scheduled or bulk Ona automation should wait until all of these are true:

- The task queue has at least five bounded `agent-ready` items.
- Each item has scope, forbidden changes, validation, and evidence.
- The workbench guard passes in CI.
- The architecture guard passes in CI.
- A maintainer is prepared to review and merge one PR per task.

Until then, use limited parallelism: two or three Ona environments at a time.

## Current Migration State

MineLink is ready for limited Ona Platform Codex parallelism, not broad
automatic issue draining. The next useful step is to open narrow PRs from
`docs/agent-task-queue.md`, starting with install proof, artifact summaries,
stability reporting, and one real runtime gate slice at a time.
