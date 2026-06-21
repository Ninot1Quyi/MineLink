# MineLink Ona Migration Runbook

This runbook moves MineLink from a single local Codex thread toward bounded Ona
cloud worktrees without losing the anti-mock product boundary.

## Migration Goal

Ona is used as a cloud worktree platform for narrow, verifiable MineLink tasks.
It is not a replacement for the acceptance process. The integration owner still
checks the acceptance gate, local evidence, real NeoForge evidence when needed,
and remote CI before merging.

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
- `docs/agent-task-queue.md`

Use `.devcontainer/devcontainer.json` for bootstrap. It installs Node 22,
Java 21, Python, GitHub CLI, runs `npm ci`, and performs a docs-scope
verification on attach.

Use `ona/<task-name>` or `agent/<task-name>` branches for Ona-managed tasks.
GitHub Actions also accepts `codex/**` for local Codex worktrees.

## Task Intake

Only tasks with `agent-ready` scope are suitable for Ona. Each task must define:

- Scope: exact files or directories the agent may change.
- Forbidden changes: assertions, boundaries, or files that must not be weakened.
- Acceptance gate: the gate in `docs/minelink-acceptance.md`.
- Mock/smoke reduction: the assumption being converted toward real behavior.
- Validation: exact commands.
- Evidence: report paths and GitHub Action URLs.
- Remaining gaps: what the task does not complete.

Use `.github/ISSUE_TEMPLATE/agent-task.yml` for new tasks and
`.github/pull_request_template.md` for PR evidence.

## Validation Matrix

| Task Class | Default Command | Required Escalation |
| --- | --- | --- |
| Docs/workbench | `bash scripts/dev/verify-agent-task.sh --scope docs` | none |
| CI/scripts | `bash scripts/dev/verify-agent-task.sh --scope fast` | runtime if scenario behavior changes |
| Host/Gateway | `bash scripts/dev/verify-agent-task.sh --scope runtime --scenarios mine_tree` | HTTP e2e for transport changes |
| SDK/protocol helpers | `bash scripts/dev/verify-agent-task.sh --scope runtime --scenarios guard_boundaries` | real NeoForge if game semantics change |
| Runtime gate slice | `bash scripts/dev/verify-agent-task.sh --scope neoforge --scenarios <scenario>` | short soak for stateful behavior |
| Release/stability | `bash scripts/dev/verify-agent-task.sh --scope all` | longer soak or self-hosted runner profile |

The default command writes:

```text
.minelink-dev/reports/agent-task-summary.md
```

The guard commands also write:

```text
.minelink-dev/reports/architecture-guard.md
.minelink-dev/reports/agent-workbench-guard.md
```

## Automatic Guards

MineLink uses automation to reduce agent memory load:

- `scripts/dev/check-architecture-guard.sh` prevents architecture-sensitive
  drift without a matching `ARCHITECTURE.md` update.
- `scripts/dev/check-agent-workbench.sh` keeps the Ona/agent entry points,
  templates, and task queue present.
- `scripts/dev/verify-agent-task.sh` runs both guards before tests.
- `.github/workflows/ci.yml` runs both guards on every push and PR.
- `.github/workflows/minecraft-neoforge.yml` runs real NeoForge smoke on code,
  script, workflow, and runtime changes.

These guards only protect process and evidence shape. They do not convert a gate
to `product-accepted`.

## CI Monitoring

Remote CI is a final confirmation layer. Prefer local validation for fast
iteration, then check GitHub Actions after push:

- Fast CI workflow: `.github/workflows/ci.yml`
- Real Minecraft workflow: `.github/workflows/minecraft-neoforge.yml`
- Evidence artifacts: `minelink-dev-evidence` and
  `minelink-neoforge-smoke-evidence`

Use the GitHub connector when available. If a local `gh` token is not already
configured, do not paste secrets into shell history just to fetch logs.

## Secrets Policy

Never commit or print:

- GitHub tokens.
- Admission tokens.
- Microsoft credentials.
- OpenAI/API keys.
- Minecraft `eula.txt`.
- Server secrets or non-loopback gateway bearer tokens.

Local validation may set `MINELINK_ACCEPT_EULA=1` because the repository owner
has authorized EULA acceptance for development testing. Do not commit generated
EULA files.

## Automation Readiness

Scheduled or bulk Ona automation should wait until all of these are true:

- The task queue has at least five bounded `agent-ready` items.
- Each item has scope, forbidden changes, validation, and evidence.
- The workbench guard passes in CI.
- The architecture guard passes in CI.
- A maintainer is prepared to review and merge one PR per task.

Until then, use limited parallelism: two or three Ona environments at a time.

## Current Migration State

MineLink is ready for limited Ona parallelism, not broad automatic issue
draining. The next useful step is to open narrow PRs from
`docs/agent-task-queue.md`, starting with install proof, artifact summaries,
stability reporting, and one real runtime gate slice at a time.
