#!/usr/bin/env node
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const defaults = {
  output: ".minelink-dev/reports/agent-factory-chain.md",
  jsonOutput: ".minelink-dev/reports/agent-factory-chain.json",
  taskId: process.env.MINELINK_TASK_ID ?? "manual",
  githubIssue: process.env.MINELINK_GITHUB_ISSUE ?? "",
  linearIssue: process.env.MINELINK_LINEAR_ISSUE ?? "",
  issueContractStatus: process.env.MINELINK_ISSUE_CONTRACT_STATUS ?? "",
  githubDispatcherStatus: process.env.MINELINK_GITHUB_DISPATCHER_STATUS ?? "",
  githubDispatcherUrl: process.env.MINELINK_GITHUB_DISPATCHER_URL ?? "",
  onaProject: process.env.MINELINK_ONA_PROJECT ?? "",
  onaAutomation: process.env.MINELINK_ONA_AUTOMATION ?? "",
  onaAutomationExecution: process.env.MINELINK_ONA_AUTOMATION_EXECUTION ?? "",
  onaAutomationStatus: process.env.MINELINK_ONA_AUTOMATION_STATUS ?? "",
  onaPrebuild: process.env.MINELINK_ONA_PREBUILD ?? "",
  onaPrebuildStatus: process.env.MINELINK_ONA_PREBUILD_STATUS ?? "",
  onaImplementationSession: process.env.MINELINK_ONA_IMPLEMENTATION_SESSION ?? "",
  onaImplementationStatus: process.env.MINELINK_ONA_IMPLEMENTATION_STATUS ?? "",
  onaVerifierSession: process.env.MINELINK_ONA_VERIFIER_SESSION ?? "",
  onaVerifierStatus: process.env.MINELINK_ONA_VERIFIER_STATUS ?? "",
  branch: process.env.MINELINK_BRANCH ?? "",
  commit: process.env.MINELINK_COMMIT ?? "",
  prUrl: process.env.MINELINK_PR_URL ?? "",
  ciUrl: process.env.MINELINK_CI_URL ?? "",
  githubStatusUrl: process.env.MINELINK_GITHUB_STATUS_URL ?? "",
  linearStatusUrl: process.env.MINELINK_LINEAR_STATUS_URL ?? "",
  blocker: process.env.MINELINK_CHAIN_BLOCKER ?? "",
  acceptanceGate: process.env.MINELINK_ACCEPTANCE_GATE ?? "",
  validationReport: ".minelink-dev/reports/agent-task-summary.md",
  acceptanceSummary: ".minelink-dev/reports/artifacts/acceptance-summary.md",
  acceptanceMp4: ".minelink-dev/reports/artifacts/acceptance.mp4",
  videoReview: ".minelink-dev/reports/artifacts/video-review.md",
  videoReleaseGate: ".minelink-dev/reports/artifacts/video-release-gate.md",
  linearSyncReport: ".minelink-dev/reports/linear-sync.md",
};

const args = { ...defaults };
let codexAuthFailed = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--task-id") args.taskId = readValue();
  else if (arg === "--github-issue") args.githubIssue = readValue();
  else if (arg === "--linear-issue") args.linearIssue = readValue();
  else if (arg === "--issue-contract-status") args.issueContractStatus = readValue();
  else if (arg === "--github-dispatcher-status") args.githubDispatcherStatus = readValue();
  else if (arg === "--github-dispatcher-url") args.githubDispatcherUrl = readValue();
  else if (arg === "--ona-project") args.onaProject = readValue();
  else if (arg === "--ona-automation") args.onaAutomation = readValue();
  else if (arg === "--ona-automation-execution") args.onaAutomationExecution = readValue();
  else if (arg === "--ona-automation-status") args.onaAutomationStatus = readValue();
  else if (arg === "--ona-prebuild") args.onaPrebuild = readValue();
  else if (arg === "--ona-prebuild-status") args.onaPrebuildStatus = readValue();
  else if (arg === "--ona-implementation-session") args.onaImplementationSession = readValue();
  else if (arg === "--ona-implementation-status") args.onaImplementationStatus = readValue();
  else if (arg === "--ona-verifier-session") args.onaVerifierSession = readValue();
  else if (arg === "--ona-verifier-status") args.onaVerifierStatus = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--commit") args.commit = readValue();
  else if (arg === "--pr-url") args.prUrl = readValue();
  else if (arg === "--ci-url") args.ciUrl = readValue();
  else if (arg === "--github-status-url") args.githubStatusUrl = readValue();
  else if (arg === "--linear-status-url") args.linearStatusUrl = readValue();
  else if (arg === "--blocker") args.blocker = readValue();
  else if (arg === "--acceptance-gate") args.acceptanceGate = readValue();
  else if (arg === "--validation-report") args.validationReport = readValue();
  else if (arg === "--acceptance-summary") args.acceptanceSummary = readValue();
  else if (arg === "--acceptance-mp4") args.acceptanceMp4 = readValue();
  else if (arg === "--video-review") args.videoReview = readValue();
  else if (arg === "--video-release-gate") args.videoReleaseGate = readValue();
  else if (arg === "--linear-sync-report") args.linearSyncReport = readValue();
  else if (arg === "--codex-auth-failed") codexAuthFailed = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/report-agent-factory-chain.mjs [options]

Writes a stage report for the MineLink AI-native delivery chain:
GitHub issue -> dispatcher -> Ona Platform Codex -> validation -> acceptance MP4 -> verifier -> PR -> CI -> status.

This report is progress evidence only. It does not upgrade acceptance gates or
claim MineLink product completion.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

function git(argsList) {
  const result = spawnSync("git", argsList, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

if (!args.branch) args.branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
if (!args.commit) args.commit = git(["rev-parse", "--short", "HEAD"]) || "unknown";

async function fileInfo(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return { path: filePath, size: stat.size };
  } catch {
    return null;
  }
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeStatus(value) {
  const lower = String(value ?? "").trim().toLowerCase();
  if (["passed", "pass", "success", "succeeded", "complete", "completed"].includes(lower)) {
    return "passed";
  }
  if (["partial", "real-partial", "process-smoke"].includes(lower)) return "partial";
  if (["blocked", "failed", "failure", "error"].includes(lower)) return "blocked";
  if (["missing", "none", "unknown", ""].includes(lower)) return "missing";
  return lower;
}

function weighted(status) {
  if (status === "passed") return 1;
  if (status === "partial") return 0.5;
  return 0;
}

function linkOrText(value) {
  if (!value) return "none";
  if (/^https?:\/\//.test(value)) return value;
  return value;
}

function hasValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.length > 0 && !["none", "null", "undefined", "-"].includes(normalized);
}

function escapeMd(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

function mkNode(id, name, status, evidence, blocker = "") {
  return {
    id,
    name,
    status: normalizeStatus(status),
    evidence: evidence.filter(Boolean),
    blocker,
  };
}

function mkEdge(from, to, status, evidence, blocker = "") {
  return {
    from,
    to,
    status: normalizeStatus(status),
    evidence: evidence.filter(Boolean),
    blocker,
  };
}

const validationInfo = await fileInfo(args.validationReport);
const summaryInfo = await fileInfo(args.acceptanceSummary);
const mp4Info = await fileInfo(args.acceptanceMp4);
const reviewInfo = await fileInfo(args.videoReview);
const releaseInfo = await fileInfo(args.videoReleaseGate);
const linearSyncInfo = await fileInfo(args.linearSyncReport);
const releaseText = await readText(args.videoReleaseGate);
const reviewText = await readText(args.videoReview);
const linearSyncText = await readText(args.linearSyncReport);

const issueStatus = hasValue(args.githubIssue) ? "passed" : hasValue(args.linearIssue) ? "partial" : "missing";
const taskContractStatus = normalizeStatus(args.issueContractStatus) !== "missing"
  ? normalizeStatus(args.issueContractStatus)
  : issueStatus === "missing"
    ? "missing"
    : "partial";
const dispatcherStatus = normalizeStatus(args.githubDispatcherStatus) !== "missing"
  ? normalizeStatus(args.githubDispatcherStatus)
  : hasValue(args.githubDispatcherUrl)
    ? "partial"
    : "missing";
const automationStatus = normalizeStatus(args.onaAutomationStatus) !== "missing"
  ? normalizeStatus(args.onaAutomationStatus)
  : hasValue(args.onaAutomationExecution)
    ? "partial"
    : hasValue(args.onaAutomation)
      ? "partial"
      : "missing";
const prebuildStatus = normalizeStatus(args.onaPrebuildStatus) !== "missing"
  ? normalizeStatus(args.onaPrebuildStatus)
  : hasValue(args.onaPrebuild)
    ? "partial"
    : "missing";
const implementationStatus = codexAuthFailed
  ? "blocked"
  : normalizeStatus(args.onaImplementationStatus) !== "missing"
    ? normalizeStatus(args.onaImplementationStatus)
    : hasValue(args.onaImplementationSession)
      ? "partial"
      : "missing";
const branchStatus = args.branch && args.commit ? "passed" : "missing";
const validationStatus = validationInfo && validationInfo.size > 0 ? "passed" : "missing";
const mp4Status = summaryInfo && mp4Info && mp4Info.size > 0 ? "passed" : summaryInfo ? "partial" : "missing";
const verifierStatus = normalizeStatus(args.onaVerifierStatus) !== "missing"
  ? normalizeStatus(args.onaVerifierStatus)
  : reviewInfo && /Verifier:\s*Ona Platform Codex/im.test(reviewText)
    ? /Release decision:\s*pass/im.test(reviewText)
      ? "passed"
      : "blocked"
    : reviewInfo
      ? "partial"
      : "missing";
const releaseStatus = releaseInfo && /Result:\s*`?passed`?/im.test(releaseText) ? "passed" : releaseInfo ? "blocked" : "missing";
const prStatus = hasValue(args.prUrl) ? "passed" : "missing";
const ciStatus = hasValue(args.ciUrl) ? "passed" : "missing";
const statusSyncStatus = hasValue(args.githubStatusUrl) && hasValue(args.linearStatusUrl)
  ? "passed"
  : hasValue(args.githubStatusUrl) || hasValue(args.linearStatusUrl) || linearSyncInfo
    ? /created comment|updated .* status|attached /i.test(linearSyncText)
      ? "partial"
      : "partial"
    : "missing";

const codexBlocker = codexAuthFailed
  ? "Ona Platform Codex rejected the LLM request as unauthenticated before repository commands could run."
  : implementationStatus === "missing"
    ? "No accepted automated Ona Platform Codex implementation session id or readback evidence was supplied. Current public docs describe starting Codex from the environment conversation menu, not from the checked-in automation YAML."
    : "";
const globalBlocker = args.blocker || codexBlocker;

const nodes = [
  mkNode("github_issue", "GitHub issue published", issueStatus, [
    hasValue(args.githubIssue) && `GitHub: ${linkOrText(args.githubIssue)}`,
  ]),
  mkNode("issue_contract", "Issue contract validated", taskContractStatus, [
    hasValue(args.githubIssue) && "agent-ready issue template",
    hasValue(args.linearIssue) && `Linear: ${linkOrText(args.linearIssue)}`,
  ], taskContractStatus === "blocked" ? globalBlocker : ""),
  mkNode("github_dispatcher", "GitHub Actions dispatcher", dispatcherStatus, [
    hasValue(args.githubDispatcherUrl) && `Dispatcher: ${args.githubDispatcherUrl}`,
  ], dispatcherStatus === "blocked" ? globalBlocker : ""),
  mkNode("ona_automation", "Ona automation execution queued", automationStatus, [
    hasValue(args.onaAutomation) && `Automation: ${args.onaAutomation}`,
    hasValue(args.onaAutomationExecution) && `Execution: ${args.onaAutomationExecution}`,
  ], automationStatus === "blocked" ? globalBlocker : ""),
  mkNode("ona_prebuild", "Ona project prebuild ready", prebuildStatus, [
    hasValue(args.onaProject) && `Ona project: ${args.onaProject}`,
    hasValue(args.onaPrebuild) && `Ona prebuild: ${args.onaPrebuild}`,
  ], prebuildStatus === "blocked" ? globalBlocker : ""),
  mkNode("implementation_codex", "Ona Platform Codex implementation session", implementationStatus, [
    args.onaImplementationSession && `Implementation session: ${args.onaImplementationSession}`,
  ], codexBlocker),
  mkNode("branch_commit", "Branch and commit produced", branchStatus, [
    `Branch: ${args.branch}`,
    `Commit: ${args.commit}`,
  ]),
  mkNode("validation", "Validation automation", validationStatus, [
    validationInfo && args.validationReport,
  ]),
  mkNode("acceptance_video", "Acceptance summary and MP4", mp4Status, [
    summaryInfo && args.acceptanceSummary,
    mp4Info && `${args.acceptanceMp4}${mp4Info ? ` (${mp4Info.size} bytes)` : ""}`,
  ]),
  mkNode("video_verifier", "Dedicated video verifier", verifierStatus, [
    args.onaVerifierSession && `Verifier session: ${args.onaVerifierSession}`,
    reviewInfo && args.videoReview,
  ], verifierStatus === "blocked" ? "Video verifier did not approve the current acceptance artifacts." : ""),
  mkNode("release_gate", "Video release gate", releaseStatus, [
    releaseInfo && args.videoReleaseGate,
  ], releaseStatus === "blocked" ? "Video release gate failed or hashes do not match." : ""),
  mkNode("pr", "Pull request", prStatus, [
    args.prUrl && `PR: ${args.prUrl}`,
  ]),
  mkNode("ci", "GitHub CI", ciStatus, [
    args.ciUrl && `CI: ${args.ciUrl}`,
  ]),
  mkNode("status_writeback", "Linear/GitHub status writeback", statusSyncStatus, [
    args.githubStatusUrl && `GitHub status: ${args.githubStatusUrl}`,
    args.linearStatusUrl && `Linear status: ${args.linearStatusUrl}`,
    linearSyncInfo && args.linearSyncReport,
  ]),
];

const nodeStatus = Object.fromEntries(nodes.map((node) => [node.id, node.status]));
const edgeStatus = (targetStatus) => targetStatus;
const rawEdges = [
  mkEdge("github_issue", "issue_contract", edgeStatus(nodeStatus.issue_contract), [
    hasValue(args.githubIssue) && taskContractStatus !== "blocked" && "GitHub issue body and labels are dispatchable.",
    hasValue(args.githubIssue) && taskContractStatus === "blocked" && "GitHub issue body and labels were checked.",
    hasValue(args.linearIssue) && "Linked Linear issue is present.",
  ]),
  mkEdge("issue_contract", "github_dispatcher", edgeStatus(nodeStatus.github_dispatcher), [
    hasValue(args.githubDispatcherUrl) && `Dispatcher: ${args.githubDispatcherUrl}`,
  ], dispatcherStatus === "blocked" ? globalBlocker : ""),
  mkEdge("github_dispatcher", "ona_automation", edgeStatus(nodeStatus.ona_automation), [
    hasValue(args.onaAutomation) && `Automation: ${args.onaAutomation}`,
    hasValue(args.onaAutomationExecution) && `Execution: ${args.onaAutomationExecution}`,
  ]),
  mkEdge("ona_automation", "ona_prebuild", edgeStatus(nodeStatus.ona_prebuild), [
    hasValue(args.onaProject) && `Ona project: ${args.onaProject}`,
    hasValue(args.onaPrebuild) && `Ona prebuild: ${args.onaPrebuild}`,
  ]),
  mkEdge("ona_prebuild", "implementation_codex", edgeStatus(nodeStatus.implementation_codex), [
    args.onaImplementationSession && `Implementation session: ${args.onaImplementationSession}`,
  ], codexBlocker),
  mkEdge("implementation_codex", "branch_commit", implementationStatus === "passed" ? nodeStatus.branch_commit : "blocked", [
    `Branch: ${args.branch}`,
    `Commit: ${args.commit}`,
  ], implementationStatus === "passed" ? "" : codexBlocker || "Implementation session has not produced accepted repository changes."),
  mkEdge("branch_commit", "validation", edgeStatus(nodeStatus.validation), [validationInfo && args.validationReport]),
  mkEdge("validation", "acceptance_video", edgeStatus(nodeStatus.acceptance_video), [
    summaryInfo && args.acceptanceSummary,
    mp4Info && args.acceptanceMp4,
  ]),
  mkEdge("acceptance_video", "video_verifier", edgeStatus(nodeStatus.video_verifier), [
    reviewInfo && args.videoReview,
  ]),
  mkEdge("video_verifier", "release_gate", edgeStatus(nodeStatus.release_gate), [
    releaseInfo && args.videoReleaseGate,
  ]),
  mkEdge("release_gate", "pr", edgeStatus(nodeStatus.pr), [args.prUrl && args.prUrl]),
  mkEdge("pr", "ci", edgeStatus(nodeStatus.ci), [args.ciUrl && args.ciUrl]),
  mkEdge("ci", "status_writeback", edgeStatus(nodeStatus.status_writeback), [
    args.githubStatusUrl && args.githubStatusUrl,
    args.linearStatusUrl && args.linearStatusUrl,
    linearSyncInfo && args.linearSyncReport,
  ]),
];

let upstreamBlocker = "";
const edges = rawEdges.map((edge) => {
  if (upstreamBlocker) {
    return {
      ...edge,
      status: "blocked",
      blocker: edge.blocker || `Upstream chain edge is not complete: ${upstreamBlocker}`,
    };
  }
  if (["blocked", "missing"].includes(edge.status)) {
    upstreamBlocker = `${edge.from} -> ${edge.to}`;
  }
  return edge;
});

const score = edges.reduce((sum, edge) => sum + weighted(edge.status), 0);
const progress = Math.round((score / edges.length) * 100);
const firstBlockedEdge = edges.find((edge) => ["blocked", "missing"].includes(edge.status)) ?? null;

const nextActions = [];
if (firstBlockedEdge?.to === "issue_contract") {
  nextActions.push("Fix the GitHub/Linear task contract so it has agent-ready labels, scope, forbidden changes, validation, evidence, video requirement, and remaining gaps.");
} else if (firstBlockedEdge?.to === "github_dispatcher") {
  nextActions.push("Run the GitHub issue dispatcher workflow or Linear watcher and attach its Actions URL/report.");
} else if (firstBlockedEdge?.to === "ona_automation") {
  nextActions.push("Provide ONA_TOKEN/Ona CLI authentication, start the Ona automation, and capture the automation execution id.");
} else if (firstBlockedEdge?.to === "ona_prebuild") {
  nextActions.push("Run or inspect the Ona prebuild and attach its id, logs, and result to this report.");
} else if (firstBlockedEdge?.to === "implementation_codex") {
  nextActions.push("Repair or expose programmatic Ona Platform Codex launch/authentication, start a fresh Codex implementation session, and capture the session id plus logs.");
} else if (firstBlockedEdge?.to === "branch_commit") {
  nextActions.push("Wait for the Ona Platform Codex implementation session to create the bounded branch/commit, or mark the task blocked with the session evidence.");
} else if (firstBlockedEdge?.to === "validation") {
  nextActions.push("Run the required validation command and preserve `.minelink-dev/reports/agent-task-summary.md`.");
} else if (firstBlockedEdge?.to === "acceptance_video") {
  nextActions.push("Render acceptance artifacts with `node scripts/dev/render-acceptance-video.mjs --require-mp4`.");
} else if (firstBlockedEdge?.to === "video_verifier") {
  nextActions.push("Start a separate Ona Platform Codex verifier session and have it write `.minelink-dev/reports/artifacts/video-review.md`.");
} else if (firstBlockedEdge?.to === "release_gate") {
  nextActions.push("Run `node scripts/dev/check-video-review.mjs --require-mp4` and fix any hash or verifier mismatch.");
} else if (firstBlockedEdge?.to === "pr") {
  nextActions.push("Open or update the draft PR with links to the validation, MP4, verifier report, release gate, and remaining gaps.");
} else if (firstBlockedEdge?.to === "ci") {
  nextActions.push("Wait for required GitHub Actions and attach run URLs or logs.");
} else if (firstBlockedEdge?.to === "status_writeback") {
  nextActions.push("Write the final evidence summary back to GitHub and Linear without printing secrets.");
}
if (globalBlocker && !nextActions.includes(globalBlocker)) {
  nextActions.push(globalBlocker);
}
if (nextActions.length === 0) {
  nextActions.push("All chain edges have reported evidence. Human review still decides product acceptance.");
}

const summaryHashes = {};
if (summaryInfo) summaryHashes.acceptanceSummarySha256 = await sha256(args.acceptanceSummary);
if (mp4Info) summaryHashes.acceptanceMp4Sha256 = await sha256(args.acceptanceMp4);

const report = {
  taskId: args.taskId,
  acceptanceGate: args.acceptanceGate || "unspecified",
  branch: args.branch,
  commit: args.commit,
  generatedAt: new Date().toISOString(),
  progressPercent: progress,
  remainingPercent: 100 - progress,
  firstBlockedEdge,
  nodes,
  edges,
  nextActions,
  hashes: summaryHashes,
  acceptanceBoundary:
    "This is automation-chain evidence only. It does not upgrade MineLink acceptance gates or prove product completion.",
};

const lines = [
  "# MineLink Agent Factory Chain",
  "",
  `- Task: \`${escapeMd(args.taskId)}\``,
  `- Acceptance gate: \`${escapeMd(args.acceptanceGate || "unspecified")}\``,
  `- Branch: \`${escapeMd(args.branch)}\``,
  `- Commit: \`${escapeMd(args.commit)}\``,
  `- Generated: \`${report.generatedAt}\``,
  `- Chain progress: \`${progress}%\``,
  `- Remaining chain gap: \`${100 - progress}%\``,
  "- Acceptance boundary: `automation-chain evidence only; not product acceptance`",
  "",
  "## First Blocking Edge",
  "",
  firstBlockedEdge
    ? `- \`${firstBlockedEdge.from} -> ${firstBlockedEdge.to}\`: \`${firstBlockedEdge.status}\`${firstBlockedEdge.blocker ? ` - ${escapeMd(firstBlockedEdge.blocker)}` : ""}`
    : "- none",
  "",
  "## Nodes",
  "",
  "| Node | Status | Evidence | Blocker |",
  "| --- | --- | --- | --- |",
  ...nodes.map((node) =>
    `| ${escapeMd(node.name)} | \`${node.status}\` | ${escapeMd(node.evidence.join("; ") || "none")} | ${escapeMd(node.blocker || "none")} |`,
  ),
  "",
  "## Edges",
  "",
  "| Edge | Status | Evidence | Blocker |",
  "| --- | --- | --- | --- |",
  ...edges.map((edge) =>
    `| ${escapeMd(edge.from)} -> ${escapeMd(edge.to)} | \`${edge.status}\` | ${escapeMd(edge.evidence.join("; ") || "none")} | ${escapeMd(edge.blocker || "none")} |`,
  ),
  "",
  "## Next Unblock Actions",
  "",
  ...nextActions.map((action) => `- ${escapeMd(action)}`),
  "",
  "## Artifact Hashes",
  "",
  ...Object.entries(summaryHashes).map(([key, value]) => `- ${key}: \`${value}\``),
  ...(Object.keys(summaryHashes).length === 0 ? ["- none"] : []),
  "",
];

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, lines.join("\n"), "utf8");
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Agent factory chain report wrote ${args.output} and ${args.jsonOutput}`);
