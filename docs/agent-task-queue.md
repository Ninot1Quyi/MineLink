# MineLink Agent Task Queue

This queue contains bounded tasks suitable for Ona/Codex cloud worktrees. Keep
one task per branch and one branch per PR.

## Ready Tasks

### Gate 10: Fresh Clone and Devcontainer Install Proof

Status: `agent-ready`

Scope:

- `.devcontainer/devcontainer.json`
- `.github/workflows/install-smoke.yml`
- `README.md`
- `docs/development.md`
- `docs/minelink-acceptance.md`
- `docs/ona-migration.md`
- `scripts/dev/install-smoke.sh`
- `scripts/dev/verify-agent-task.sh`

Forbidden:

- Do not change runtime behavior.
- Do not weaken CI or acceptance assertions.
- Do not commit generated `.minelink-dev`, `node_modules`, Gradle caches, or
  `mod/neoforge/run/eula.txt`.

Validation:

```bash
bash scripts/dev/verify-agent-task.sh --scope docs
bash scripts/dev/install-smoke.sh --scope fast
```

Evidence:

- `.minelink-dev/reports/agent-task-summary.md`
- `.minelink-dev/install-smoke/install-smoke-report.md`
- `.minelink-dev/install-smoke/install-smoke.log`
- GitHub Actions artifact `minelink-install-smoke-evidence` when run remotely.

Remaining gaps:

- Server admin install, agent user MCP setup, LAN install, cross-platform
  packaging, and real NeoForge install proof remain separate Gate 10 tasks.

### CI Artifact Summary for PR Review

Status: `automation-ready`

Scope:

- `.github/workflows/ci.yml`
- `.github/workflows/minecraft-neoforge.yml`
- `.github/workflows/install-smoke.yml`
- `scripts/dev/**`
- `docs/development.md`
- `docs/agent-workbench.md`

Forbidden:

- Do not skip existing e2e scenarios.
- Do not remove artifact uploads.
- Do not mark skipped NeoForge as product evidence.
- Do not make the summary step replace failing test/e2e/soak assertions.

Validation:

```bash
bash scripts/dev/verify-agent-task.sh --scope runtime --scenarios mine_tree,guard_boundaries
MINELINK_SKIP_BUILD=1 bash scripts/dev/soak.sh --runtime mock --iterations 1 --scenarios mine_tree,guard_boundaries
node scripts/dev/summarize-evidence.mjs
```

Evidence:

- `.minelink-dev/reports/agent-task-summary.md`
- `.minelink-dev/reports/ci-evidence-summary.md`
- `.minelink-dev/soak/mock/soak-report.json`
- `.minelink-dev/soak/mock/process-cleanup.json`
- `.minelink-dev/soak/mock/queue-metrics.json`
- GitHub Actions URL showing summary/artifact behavior.

Remaining gaps:

- Full release reporting and long soak dashboards are Gate 11 work.
- The summary is an evidence index only; acceptance status still comes from
  `docs/minelink-acceptance.md`.

### Gate 11: Longer Real NeoForge Soak Profile

Status: `agent-ready`

Scope:

- `scripts/dev/soak.sh`
- `scripts/dev/e2e.sh`
- `.github/workflows/minecraft-neoforge.yml`
- `docs/minelink-acceptance.md`
- `docs/development.md`

Forbidden:

- Do not shorten existing smoke assertions.
- Do not hide process leaks or queue growth.
- Do not require secrets or online-mode auth for CI.

Validation:

```bash
bash scripts/dev/verify-agent-task.sh --scope neoforge --scenarios guard_boundaries
MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/soak.sh --runtime neoforge --iterations 2 --scenarios guard_boundaries,portal_coop
```

Evidence:

- `.minelink-dev/soak/neoforge/soak-report.json`
- `.minelink-dev/soak/neoforge/process-cleanup.json`
- `.minelink-dev/soak/neoforge/queue-metrics.json`

Remaining gaps:

- Release-length soak still needs a dedicated longer runner profile.

### Gate 8: Restart-Durable Notice Board Evidence

Status: `agent-ready`

Scope:

- `mod/neoforge/src/main/java/net/minelink/neoforge/server/MineLinkEndpointBootstrap.java`
- `packages/mock-runtime/src/runtime.ts`
- `examples/codex-rpc/portal_coop.replay.jsonl`
- `docs/minelink-acceptance.md`

Forbidden:

- Do not expose notice board coordinates or hidden recipient positions.
- Do not store social events in agent-local memory only.
- Do not use mock-only persistence as product evidence.

Validation:

```bash
bash scripts/dev/verify-agent-task.sh --scope neoforge --scenarios portal_coop
```

Evidence:

- Real NeoForge report showing notice survives controlled restart or explicit
  reload boundary.
- Redacted notice payload assertions remain present.

Remaining gaps:

- Human player chat interaction and broader A2A objects remain separate tasks.

### Gate 7: Create Belt Transport Slice

Status: `agent-ready`

Scope:

- `mod/neoforge/src/main/java/net/minelink/neoforge/server/MineLinkEndpointBootstrap.java`
- `examples/codex-rpc/create_smoke.replay.jsonl`
- `docs/minelink-acceptance.md`

Forbidden:

- Do not fake Create processing with direct inventory edits.
- Do not expose Ponder, JEI, or client-only overlays through `server_agent`.
- Do not add `setBlock`, `give`, or direct NBT shortcuts.

Validation:

```bash
MINELINK_ENABLE_CREATE=1 bash scripts/dev/verify-agent-task.sh --scope neoforge --scenarios create_smoke
```

Evidence:

- Real NeoForge report showing belt state or transported item state through
  Create server-side component behavior.

Remaining gaps:

- Full Create adapter parity remains broader Gate 7 work.

## Single Owner Tasks

These tasks are valid but should not be assigned concurrently with other
runtime work:

- Gate 6 broader shaped/modded recipe and remainder parity.
- Gate 3 generic raycast and block-shape occlusion beyond fixtures.
- Gate 2 persistent body lifecycle restore/freeze/remove.
- Gate 9 society/director design and first real multi-agent long task.

Each single-owner task must open a dedicated branch and state which other runtime
paths are frozen while the work is active.
