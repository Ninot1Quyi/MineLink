# MineLink Platform Codex Task Implementation Report

Agent mode: Ona Platform Codex
Agent execution mode: AGENT_MODE_GOAL
Identity: I am Codex running in Ona Platform Codex
Session id: 019f05af-a806-776f-baaf-b5aa6bc49975
Platform evidence: Ona AgentService StartAgent launched the configured Codex agent id with codexSettings; GitHub runner will verify the API readback separately.
Task id: gh-16-mine-tree-cookie-auto-rerun
Branch: codex/gh-16-mine-tree-dynamic-attachment-rerun
Result: passed
Validation: bash scripts/dev/verify-agent-task.sh --scope neoforge --scenarios mine_tree
Validation result: passed
Boundary: task-implementation evidence only; video verifier, PR release, and MineLink product acceptance remain separate gates.

## Changed Files

- `docs/agent-factory-task-reports/gh-16-mine-tree-cookie-auto-rerun.md`

The branch source commit `4d05106` already contains the GitHub user-attachment
publication hardening for the rerun: the final PR video comment requires a
`github.com/user-attachments/assets/...` MP4 URL, the upload helper records
sanitized cookie/page-token/dynamic-token diagnostics, and the workflow blocks
final video publication if the GitHub attachment URL is missing.

## Mock or Smoke Assumption Reduced

This rerun reduces the previous full-chain canary assumption that a static
report-card MP4 or non-GitHub video URL is enough for final PR evidence. The
implementation path keeps the NeoForge-backed `mine_tree` scenario as the source
of task evidence and leaves PR publication fail-closed unless the final
verifier-approved `acceptance.mp4` is uploaded as a GitHub user attachment that
can render inline on the PR page.

## Acceptance Assertions

- Final PR video publication must use a GitHub user-attachments MP4 URL.
- R2 or other external video URLs remain candidate storage only.
- Missing, stale, or rejected GitHub attachment authority must block final PR
  video publication instead of posting a non-playable substitute.
- This report does not change any MineLink product gate status.

## Local Validation

- `bash scripts/dev/verify-agent-task.sh --scope neoforge --scenarios mine_tree`
  passed.

## Evidence Paths

- `.minelink-dev/mine_tree/reports/mine_tree-result.json`
- `.minelink-dev/mine_tree/logs/agent.log`
- `.minelink-dev/mine_tree/logs/server.stdout.log`
- `.minelink-dev/reports/agent-task-summary.md`
- `.minelink-dev/reports/artifacts/acceptance-summary.md` when the workflow
  finalizer renders acceptance artifacts
- `.minelink-dev/reports/artifacts/acceptance.mp4` when the workflow finalizer
  renders the verifier-bound acceptance video
- `.minelink-dev/reports/artifacts/video-review.md` from the separate
  same-session Platform Codex video verifier
- `.minelink-dev/reports/artifacts/video-release-gate.md` from
  `check-video-review.mjs`
- `.minelink-dev/reports/github-user-attachment-upload.md` from the GitHub
  user-attachment bridge during PR publication

## Real NeoForge

Real NeoForge validation ran for `mine_tree` through the required command. The
result is task-implementation evidence only; the workflow finalizer still owns
acceptance MP4 rendering, same-session video verification, and final PR
publication.

## Remote CI

Remote CI and the PR video publication workflow were not checked locally. After
this branch is pushed, the GitHub/Ona workflow must verify Platform Codex API
readback, run the finalizer, publish or block the GitHub user-attachments video
comment, and report the final chain status.

## Remaining Gaps

- Video verifier, PR release, and MineLink product acceptance remain separate
  gates.
- This factory rehearsal covers one real NeoForge `mine_tree` scenario and does
  not complete all MineLink product gates.
- It does not prove client GUI capture beyond the workflow finalizer's later
  artifacts.
- It does not upgrade MineLink to full product acceptance.
