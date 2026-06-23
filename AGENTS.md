# MineLink Agent Operating Contract

This file applies to the entire repository. It is the standing contract for
Codex and all delegated agents working on MineLink.

MineLink is not a demo project. Treat it as an engineering product whose core
claim is: external agents use public MCP tools to operate a bounded
`server_agent` body in a real Minecraft/NeoForge world.

## Required Context

Before planning or implementing non-trivial MineLink work, read:

- `ARCHITECTURE.md`
- `docs/minelink-acceptance.md`
- `docs/minelink-plan.md`
- `docs/minelink-mod-mcp-architecture.md`

Use `docs/minelink-acceptance.md` as the source of truth for gate status. If a
change alters evidence or scope, update that document in the same commit.
Use `docs/agent-workbench.md` for Ona/Codex parallel task boundaries, issue
shape, and conditional verification.
Use `docs/ona-migration.md`, `docs/agent-task-queue.md`, and
`docs/github-labels.md` for Ona migration, ready task selection, and GitHub
triage labels.
Use `docs/linear-ona-agent-factory.md` for the Linear/GitHub -> Ona Platform
Codex -> validation/PR/CI/evidence delivery workflow.
Use `.github/workflows/agent-factory-dispatch.yml`,
`scripts/dev/dispatch-agent-factory.mjs`,
`scripts/dev/watch-linear-agent-tasks.mjs`, and
`scripts/dev/report-agent-factory-chain.mjs` for the GitHub/Linear issue to
Ona automation bridge and full-chain status reports.
Use `scripts/dev/check-agent-factory-secrets.mjs` before diagnosing dispatcher
auth failures; it reports credential presence and Ona CLI context without
printing secret values.

## Architecture Maintenance Guard

- Treat `ARCHITECTURE.md` as the short, durable system map for future agents.
- When a change alters public tools, protocol shape, runtime authority,
  package/workflow structure, verification entry points, or parallel-agent
  workflow, update `ARCHITECTURE.md` in the same branch.
- `scripts/dev/check-architecture-guard.sh` and GitHub CI enforce this
  maintenance rule for architecture-sensitive paths.
- `scripts/dev/check-agent-workbench.sh` and GitHub CI enforce the Ona/agent
  workbench entry points, PR template, issue template, task queue, and label
  map.
- `scripts/dev/install-smoke.sh` and `.github/workflows/install-smoke.yml`
  enforce committed fresh-clone bootstrap evidence for install/workbench
  changes. Treat dirty-source runs as local debugging, not acceptance evidence.
- `scripts/dev/summarize-evidence.mjs` and GitHub Step Summary entries are
  evidence indexes only. They make reports easier to review; they do not change
  workflow pass/fail semantics or acceptance gate status.
- `scripts/dev/render-acceptance-video.mjs` produces trace-driven acceptance
  summaries and optional MP4 artifacts. These artifacts are review evidence, not
  client GUI proof and not gate-status upgrades.
- `scripts/dev/report-agent-factory-chain.mjs` records issue-to-PR automation
  nodes, edges, first blocker, and remaining percentage. It is delivery-chain
  evidence only, not product acceptance evidence.
- If the guard reports a false positive, prefer a small clarifying
  architecture note over bypassing it. Use
  `MINELINK_ARCH_GUARD_ALLOW_NO_UPDATE=1` only for reviewed cases where the
  architecture map is truly unchanged.

## Anti-Mock Rules

- Never claim full product completion from mock-only, replay-only, or smoke-only
  evidence.
- Every acceptance gate must be classified with the documented vocabulary:
  `mock-only`, `smoke-only`, `real-partial`, `product-accepted`, or `missing`.
- A gate becomes `product-accepted` only when all required items have repeatable
  real evidence from commands, reports, logs, and runtime assertions.
- Mock runtime tests are contract tests. They are useful, but they do not prove
  real Minecraft behavior.
- Smoke fixtures are narrow product slices. They can upgrade a claim to
  `real-partial` only when backed by real NeoForge evidence.
- Do not hide remaining gaps. Every final status report for product work must
  state the remaining real product gaps.

Each implementation slice must explicitly say which mock/smoke assumption was
reduced and what real capability replaced it.

## Minecraft Authority Boundary

- The Minecraft Mod is the authority for world state, body state, guard checks,
  inventory, containers, crafting, Create interactions, social events, and audit.
- The Host/Gateway is the MCP authority for transports, tool schemas, sessions,
  reconnect, capability cache, logs, replay, admission tokens, and local config.
- MCP schemas, SDK helpers, replay files, prompts, and local scripts are never
  the final security boundary for world-changing actions.
- All world-changing actions must be revalidated server-side.
- Do not add oracle tools, global chunk queries, hidden-coordinate lookup,
  `give`, `setBlock`, arbitrary NBT edits, teleport shortcuts, or any other
  backdoor that bypasses Minecraft/NeoForge rules.
- If a behavior needs special authority for a fixture, keep it in test setup,
  never in public agent tools.

## server_agent Boundary

- `server_agent` is the default MineLink body.
- Agent execution must use the Codex native RPC JSON/protocol surface for real
  agent work. Do not replace it with a hand-written toy agent and present that
  as product evidence.
- Agents may act only through public MCP tools and recent observed refs.
- Refs must be short-lived and must be checked for current session ownership,
  visibility, reachability, TTL, permissions, materials, and server-side rules.
- A `server_agent` is a headless server-side body. Do not claim it has keyboard,
  mouse, screenshots, client GUI, JEI/EMI, Create Ponder, client overlays, or
  full client-only capability.
- If a feature requires a real client GUI or sensory client, mark it as
  `unsupported_client_capability` or future sensory-client work. Do not fake it
  inside `server_agent`.
- Improve `server_agent` by using vanilla Minecraft, NeoForge, and mod server
  Java paths wherever possible, such as `ServerPlayerGameMode.useItemOn`,
  `AbstractContainerMenu.clicked`, `Slot.safeTake`, `Slot.safeInsert`,
  `ResultSlot`, `FurnaceResultSlot`, recipe registry, server block/entity
  logic, player events, and permission hooks.

## Containers, Crafting, and Create

Prefer native server paths over hand-written simulation:

- Container open should go through visible, reachable block interaction.
- Slot movement should use server menu/slot rules when the server exposes them.
- Crafting should use real recipe registry, real menu/grid/result slots, and
  vanilla placement or click paths.
- Furnace behavior should use real furnace slots and processing where possible.
- Create behavior should use real world blocks, item use, component state, and
  Create server-side processing where possible.

When a fallback or mock path remains, name it directly in reports and docs.

## Verification Order

Use the smallest proof that can validate the current claim, then escalate:

1. Targeted unit tests and type checks.
2. Relevant mock e2e replay to protect the protocol contract.
3. Real NeoForge e2e for the changed product claim.
4. Short real soak for important or stateful behavior.
5. Remote GitHub CI as final confirmation.

For install or Ona bootstrap changes, run `bash scripts/dev/install-smoke.sh
--scope fast` after the change is committed. This proves a fresh clone of the
committed ref can run `npm ci` and the fast verifier; it does not prove server
admin, LAN, or cross-platform packaging acceptance.

Keep Ona bootstrap fast and reproducible: `.devcontainer/devcontainer.json`
must use the MineLink GHCR cache-prewarmed image with Node 22, Java 21, GitHub
CLI, `ffmpeg`, and image or OS provided `python3`. Do not pin a Python feature
version that source-builds during Ona rebuilds. Keep
`scripts/dev/bootstrap-prebuild.sh` as the final hard gate even when the image
is warm.

Do not claim real game capability unless real NeoForge has run for that path.
If real NeoForge cannot run, say so and keep the status below product accepted.

For the current development harness, common commands include:

```bash
bash scripts/dev/verify-agent-task.sh
npm run build
npm run typecheck
npm test
npm run ci
MINELINK_SKIP_BUILD=1 bash scripts/dev/e2e.sh craft_smoke
MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 MINELINK_SKIP_BUILD=1 bash scripts/dev/e2e.sh craft_smoke
MINELINK_ACCEPT_EULA=1 MINELINK_SKIP_BUILD=1 bash scripts/dev/soak.sh --runtime neoforge --iterations 1 --scenarios craft_smoke,craft_negative
```

Only use `MINELINK_ACCEPT_EULA=1` after the user has already authorized EULA
acceptance. Never commit EULA files.

## Acceptance Evidence Required

Every completed product slice must report:

- Files changed.
- The mock/smoke assumption reduced.
- New or changed acceptance assertions.
- Local validation commands and results.
- Whether real NeoForge ran, with report paths.
- Whether remote CI was checked.
- Remaining real product gaps.

Reports must distinguish:

- mock pass
- replay pass
- smoke pass
- real NeoForge pass
- short soak pass
- release-length/product acceptance

## GitHub and Engineering Management

- Commit and push meaningful completed slices promptly.
- Commit messages, PR text, issue comments, and durable code comments must be in
  English.
- Use one cloud worktree per bounded task: one environment, one branch, one PR.
- Every parallel agent task must declare scope, forbidden changes, validation
  commands, evidence paths, and remaining gaps.
- Commit messages should explain why the change was made, not just what changed.
- When a GitHub issue is fixed or partially advanced, comment with the commit,
  evidence, and remaining scope.
- Use Codex native subagents for independent CI monitoring, verification, review,
  or disjoint implementation slices when that improves throughput. The main
  agent still owns final integration and claims.
- Use Ona Platform Codex for Ona implementation and verifier work. The default
  Ona Agent mode, `ona environment ssh`, and the checked-in Ona CLI automation
  are debugging, synchronization, validation, or artifact surfaces only and
  must not be described as final MineLink agent execution evidence.
- Programmatic Ona Codex launch probes must use
  `scripts/dev/start-ona-platform-codex.mjs` with an explicit
  `MINELINK_ONA_CODEX_AGENT_ID`. Do not omit `agentId`, do not use the known
  default Ona automation agent id, and do not treat a launch probe as task
  implementation evidence.
- Ona Platform Codex task execution must request Goal mode through
  `AGENT_MODE_GOAL` unless the task is an explicitly documented diagnostic.
  Accepted task and verifier readbacks must include
  `Agent execution mode: AGENT_MODE_GOAL`; one-shot `AGENT_MODE_EXECUTION`
  evidence is not accepted for long-running factory delivery.
- Goal-mode `StartAgent` launch/readback evidence proves only that the intended
  Codex Goal session started. It is not a task release gate. For video-required
  work, the Goal-mode release gate passes only after the Ona task finalizer has
  produced `acceptance.mp4`, the same implementation session's Codex verifier
  has written `video-review.md`, and `check-video-review.mjs` has passed.
- Self-reported `Identity: I am Codex running in Ona Platform Codex` is a
  diagnostic only. The default Ona Agent can echo it. Ona work is accepted only
  with platform-side Codex selector/API evidence plus task/branch/commit-bound
  readback.
- For AI-native factory work, use the GitHub Actions dispatcher or Linear
  watcher to start the checked-in Ona automation. If the chain cannot
  automatically start the Ona Platform Codex option, record that edge as
  blocked; do not substitute generic Ona Agent evidence.
- Video-required tasks must produce `acceptance.mp4`, then the same Ona
  Platform Codex implementation session must launch a bounded native verifier
  subagent to compare the task requirements against the summary/video and write
  `video-review.md`. `check-video-review.mjs` must pass before publishing or
  merging the video evidence.
- PR-visible acceptance videos should be uploaded to the configured external
  video store from the Ona release finalizer through
  `scripts/dev/upload-acceptance-video-storage.mjs`; GitHub runners may publish
  the returned public URL but must not re-render or substitute the final task
  video. Do not make the GitHub evidence branch the default storage path for
  video binaries when external storage is configured.
- Do not leak GitHub tokens, admission tokens, Microsoft credentials,
  OpenAI/API keys, EULA files, or server secrets.

## Product Completion Rule

MineLink is full-product complete only when every required acceptance gate in
`docs/minelink-acceptance.md` is `product-accepted` with repeatable real
evidence. Until then, use precise language such as `real-partial`,
`smoke evidence`, or `mock contract evidence`.
