# NeoForge-backed Acceptance Video Rehearsal Canary

Task id: gh-16-idleguard-08701b7
Branch: codex/gh-16-idleguard-08701b7
Scenario: mine_tree
Validation scope: neoforge
Required scenario report: .minelink-dev/mine_tree/reports/mine_tree-result.json
Required video producer: ona-task-finalizer

This canary is an evidence-only rehearsal for the full-chain release path. It
records that the task implementation edge must feed the finalizer with a real
NeoForge `mine_tree` report instead of a static zero-report placeholder.

Accepted finalizer evidence for this rehearsal must include:

- A real NeoForge `mine_tree` result report with passing scenario assertions.
- The matching agent, server, command, and tool timeline context in the
  acceptance summary.
- Terminal log excerpts from the scenario logs in the acceptance video.
- A nonzero scenario-report count in `acceptance-summary.md`.
- The `ona-task-finalizer` producer in `acceptance-video-origin.json`.

Rejected evidence includes:

- `Scenario reports: 0`.
- `No scenario reports found.` in the acceptance summary.
- A trace/card MP4 that is not tied to the real NeoForge `mine_tree` report.
- A video release without the separate same-session Ona Platform Codex verifier
  and release gate.

Boundary: evidence canary only; it does not upgrade MineLink product
acceptance and does not replace the finalizer, verifier, PR, CI, or playable
PR-video gates.
