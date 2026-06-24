# NeoForge-backed Acceptance Video Rehearsal Ledger

Task id: gh-16-ledger-a2864cb
Branch: codex/gh-16-neoforge-backed-acceptance-video-rehearsal
GitHub issue: https://github.com/Ninot1Quyi/MineLink/issues/16
Validation scope: neoforge
Scenarios: mine_tree

## Evidence Contract

This rehearsal is only acceptable when the full-chain finalizer renders from a
real NeoForge `mine_tree` scenario report, not from a static report-card or
zero-report placeholder.

Required scenario evidence:

- `.minelink-dev/mine_tree/reports/mine_tree-result.json`
- `.minelink-dev/mine_tree/logs/agent.log`
- `.minelink-dev/mine_tree/logs/server.stdout.log`

Required video evidence:

- `.minelink-dev/reports/artifacts/acceptance-summary.md`
- `.minelink-dev/reports/artifacts/acceptance.mp4`
- `.minelink-dev/reports/artifacts/video-review.md`
- `.minelink-dev/reports/artifacts/video-release-gate.md`

The rendered summary and MP4 must show at least one scenario report, runtime
`neoforge`, scenario `mine_tree`, key assertion results, command or tool
timeline context, and terminal log excerpts. `Reports: 0`, `Scenario reports:
0`, or `No scenario reports found` remains a release blocker.

## Boundary

This ledger is agent-factory rehearsal evidence only. It reduces the previous
full-chain canary assumption that a static report-card MP4 was enough, but it
does not prove MineLink product acceptance, client GUI capture, or any gate
upgrade. The Ona task finalizer, same-session Platform Codex video verifier,
release gate, PR publication, and human review remain separate gates.
