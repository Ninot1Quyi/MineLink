# MineLink GitHub Labels

Use these labels to keep Ona/Codex work bounded and reviewable.

## Task Routing

| Label | Purpose |
| --- | --- |
| `agent-ready` | Issue has scope, forbidden changes, validation, evidence, and remaining gaps. |
| `needs-acceptance-evidence` | PR or issue cannot close until report paths and CI links are attached. |
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

## Status Labels

| Label | Meaning |
| --- | --- |
| `mock-only` | Evidence is contract-level only and cannot support product acceptance. |
| `smoke-only` | Evidence is a narrow smoke path only. |
| `real-partial` | Real NeoForge evidence exists but required scope remains incomplete. |
| `product-accepted` | Gate requirement is fully accepted with repeatable real evidence. |

Do not apply `product-accepted` unless `docs/minelink-acceptance.md` has the
same status and evidence.
