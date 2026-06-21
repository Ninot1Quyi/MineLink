# MineLink Agent Workbench

This document defines how Ona, Codex, and other cloud worktree agents should
work on MineLink without relying on hidden thread context.

## Operating Model

Use limited parallelism until the acceptance gates and automation are stronger:

```text
one environment = one task = one branch = one PR
```

The local Codex thread remains the integration and acceptance owner. Cloud
agents should take narrow tasks with explicit write scopes and validation.

## Task Classes

| Class | Parallel Safety | Typical Scope | Required Validation |
| --- | --- | --- | --- |
| Docs/architecture | high | `*.md`, `.github/ISSUE_TEMPLATE`, `.devcontainer` | `bash scripts/dev/verify-agent-task.sh --scope docs` |
| CI/reporting | medium | `.github/workflows`, `scripts/dev`, report summarizers | `bash scripts/dev/verify-agent-task.sh --scope fast` |
| Host/Gateway | medium | `packages/host`, protocol forwarding tests | fast plus `mine_tree` HTTP e2e |
| SDK/helpers | medium | `packages/sdk`, examples docs | fast plus relevant mock e2e |
| Runtime gate slice | low | one gate, one runtime behavior | fast, mock e2e, real NeoForge e2e |
| NeoForge core runtime | single owner | `MineLinkEndpointBootstrap.java` and fixtures | targeted tests, real NeoForge e2e, short soak |

Do not run multiple agents against the same low-safety lane unless the write
sets are disjoint and a human or lead agent is integrating.

## Task Contract

Every agent-ready issue or PR must state:

- Scope: exact modules or files the agent may change.
- Forbidden: assertions, boundaries, or files the agent must not weaken.
- Acceptance gate: which gate in `docs/minelink-acceptance.md` is affected.
- Mock/smoke reduction: which assumption is being replaced by real behavior.
- Validation: exact commands to run.
- Evidence: report paths and CI links to paste into the PR.
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
bash scripts/dev/verify-agent-task.sh --scope all
```

The summary file is written to:

```text
.minelink-dev/reports/agent-task-summary.md
```

Paste that summary into PRs together with any scenario report paths.

## Automatic and Conditional Triggers

Use automation to reduce agent memory load:

- Devcontainer bootstrap runs `npm ci` automatically when a cloud worktree is
  created.
- `verify-agent-task.sh` auto-classifies changed files and chooses docs, fast,
  runtime, or NeoForge checks.
- GitHub CI runs the fast contract suite on pushes and PRs.
- The heavy NeoForge workflow is skipped for docs-only and workbench-only
  changes, but still runs for code, runtime, scripts, and workflow changes.
- The real NeoForge workflow also runs on a daily schedule and manual dispatch.

Automation must not reduce acceptance truth. A skipped heavy workflow means the
change did not need that class of evidence, not that the related product gate is
accepted.

## Recommended Initial Ona Tasks

Good first parallel tasks:

- Improve devcontainer bootstrapping and readme evidence.
- Add CI artifact summaries for `.minelink-dev` reports.
- Create issue templates for one-gate agent tasks.
- Add a read-only acceptance audit script.
- Implement one bounded Gate 2 action lifecycle slice in a single worktree.

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
- `.minelink-dev/<scenario>/reports/<scenario>-result.json`

Remaining product gaps:
```

## Next Runtime Slice Queue

Keep this queue narrow and update it after each accepted slice:

1. Gate 2 action lifecycle: public status/poll/cancel tools with real NeoForge
   queued, completed, cancelled, expired evidence.
2. Gate 10 install: fresh clone plus devcontainer proof for mock CI and
   documented NeoForge smoke.
3. Gate 11 stability: longer real NeoForge soak profile with process and queue
   metrics.
4. Gate 8 social persistence: restart-durable local events and notice board
   evidence.
5. Gate 7 Create breadth: belt transport and broader kinetic diagnostics.
