# MineLink GitHub Labels

Use these labels to keep Ona/Codex work bounded and reviewable.

## Task Routing

| Label | Purpose |
| --- | --- |
| `agent-ready` | Issue has scope, forbidden changes, validation, evidence, and remaining gaps. |
| `agent:ona` | Task should be handled by Ona Platform Codex plus the checked-in validation automation, not manual SSH or the default Ona Agent. |
| `needs-acceptance-evidence` | PR or issue cannot close until report paths and CI links are attached. |
| `real-neoforge-required` | Real NeoForge evidence is required before review can accept the claim. |
| `video-required` | Acceptance summary, MP4 artifact, video-review request, dedicated Ona Platform Codex video review, and video release gate are required. |
| `runtime-single-owner` | Work touches conflict-heavy runtime paths and should not run in parallel. |
| `docs-architecture` | Documentation, architecture, workbench, templates, or runbooks. |
| `ci-reporting` | GitHub Actions, artifacts, verification scripts, or report summaries. |

## Acceptance Gates

| Label | Gate |
| --- | --- |
| `gate-0-install` | Repository, install, and baseline harness. |
| `gate-1-neoforge-runtime` | Real NeoForge Mod runtime. |
| `gate-2-body-guards` | `server_agent` body and guard pipeline. |
| `gate-3-perception` | Limited perception and visibility. |
| `gate-4-host-gateway` | MCP Host and HTTP Gateway. |
| `gate-5-agent-sdk` | Agent RPC JSON, MCP compatibility, and SDKs. |
| `gate-6-container-crafting` | Containers, crafting, and furnace paths. |
| `gate-7-create` | Create adapter behavior. |
| `gate-8-social` | Multi-agent, A2A, and social runtime. |
| `gate-9-society` | Frontier society and Director. |
| `gate-10-packaging` | Install and product packaging. |
| `gate-11-release` | Security, stability, and release. |

Short aliases for Linear/GitHub sync:

| Label | Gate |
| --- | --- |
| `gate:0` | Gate 0 |
| `gate:1` | Gate 1 |
| `gate:2` | Gate 2 |
| `gate:3` | Gate 3 |
| `gate:4` | Gate 4 |
| `gate:5` | Gate 5 |
| `gate:6` | Gate 6 |
| `gate:7` | Gate 7 |
| `gate:8` | Gate 8 |
| `gate:9` | Gate 9 |
| `gate:10` | Gate 10 |
| `gate:11` | Gate 11 |

## Status Labels

| Label | Meaning |
| --- | --- |
| `mock-only` | Evidence is contract-level only and cannot support product acceptance. |
| `smoke-only` | Evidence is a narrow smoke path only. |
| `real-partial` | Real NeoForge evidence exists but required scope remains incomplete. |
| `product-accepted` | Gate requirement is fully accepted with repeatable real evidence. |
| `blocked` | Agent cannot continue without a concrete dependency or human decision. |
| `needs-human-review` | Agent run finished and a human must review evidence and remaining gaps. |

Do not apply `product-accepted` unless `docs/minelink-acceptance.md` has the
same status and evidence.
