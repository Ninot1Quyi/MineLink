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
  onaAutomationExecutionReport: ".minelink-dev/reports/ona-automation-execution.json",
  onaPrebuild: process.env.MINELINK_ONA_PREBUILD ?? "",
  onaPrebuildStatus: process.env.MINELINK_ONA_PREBUILD_STATUS ?? "",
  onaPlatformCodexApiSession: ".minelink-dev/reports/ona-platform-codex-api-session.json",
  onaPlatformCodexApiReport: ".minelink-dev/reports/ona-platform-codex-api-session.md",
  onaImplementationAgent: process.env.MINELINK_ONA_IMPLEMENTATION_AGENT ?? "",
  onaImplementationSession: process.env.MINELINK_ONA_IMPLEMENTATION_SESSION ?? "",
  onaImplementationStatus: process.env.MINELINK_ONA_IMPLEMENTATION_STATUS ?? "",
  onaImplementationReadback: ".minelink-dev/reports/ona-codex-implementation-session.md",
  onaVerifierAgent: process.env.MINELINK_ONA_VERIFIER_AGENT ?? "",
  onaVerifierSession: process.env.MINELINK_ONA_VERIFIER_SESSION ?? "",
  onaVerifierStatus: process.env.MINELINK_ONA_VERIFIER_STATUS ?? "",
  onaVerifierReadback: ".minelink-dev/reports/ona-codex-video-verifier-session.md",
  branch: process.env.MINELINK_BRANCH ?? "",
  commit: process.env.MINELINK_COMMIT ?? "",
  prUrl: process.env.MINELINK_PR_URL ?? "",
  prReport: ".minelink-dev/reports/agent-factory-pr.md",
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
  secretPreflight: ".minelink-dev/reports/agent-factory-secrets.json",
};

const args = { ...defaults };
let codexAuthFailed = false;
let requirePlatformCodexImplementation = false;
let requirePlatformCodexVerifier = false;
const activePrebuildPhases = new Set([
  "PREBUILD_PHASE_CREATING",
  "PREBUILD_PHASE_PENDING",
  "PREBUILD_PHASE_RUNNING",
  "PREBUILD_PHASE_STARTING",
  "PREBUILD_PHASE_SNAPSHOTTING",
]);
const failedPrebuildPhases = new Set(["PREBUILD_PHASE_FAILED", "PREBUILD_PHASE_CANCELLED"]);
const prebuildStaleMs = Number(process.env.MINELINK_PREBUILD_STALE_MINUTES ?? 30) * 60 * 1000;

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
  else if (arg === "--ona-automation-execution-report") args.onaAutomationExecutionReport = readValue();
  else if (arg === "--ona-prebuild") args.onaPrebuild = readValue();
  else if (arg === "--ona-prebuild-status") args.onaPrebuildStatus = readValue();
  else if (arg === "--ona-platform-codex-api-session") args.onaPlatformCodexApiSession = readValue();
  else if (arg === "--ona-platform-codex-api-report") args.onaPlatformCodexApiReport = readValue();
  else if (arg === "--ona-implementation-agent") args.onaImplementationAgent = readValue();
  else if (arg === "--ona-implementation-session") args.onaImplementationSession = readValue();
  else if (arg === "--ona-implementation-status") args.onaImplementationStatus = readValue();
  else if (arg === "--ona-implementation-readback") args.onaImplementationReadback = readValue();
  else if (arg === "--ona-verifier-agent") args.onaVerifierAgent = readValue();
  else if (arg === "--ona-verifier-session") args.onaVerifierSession = readValue();
  else if (arg === "--ona-verifier-status") args.onaVerifierStatus = readValue();
  else if (arg === "--ona-verifier-readback") args.onaVerifierReadback = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--commit") args.commit = readValue();
  else if (arg === "--pr-url") args.prUrl = readValue();
  else if (arg === "--pr-report") args.prReport = readValue();
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
  else if (arg === "--secret-preflight") args.secretPreflight = readValue();
  else if (arg === "--codex-auth-failed") codexAuthFailed = true;
  else if (arg === "--require-platform-codex-implementation") requirePlatformCodexImplementation = true;
  else if (arg === "--require-platform-codex-verifier") requirePlatformCodexVerifier = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/report-agent-factory-chain.mjs [options]

Writes a stage report for the MineLink AI-native delivery chain:
GitHub issue -> dispatcher -> Ona Platform Codex -> validation -> acceptance MP4 -> same-session verifier subagent -> PR -> CI -> status.

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

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
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

function markerValue(text, names) {
  const keys = Array.isArray(names) ? names : [names];
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(text ?? "").match(new RegExp(`^${escaped}:\\s*` + "(.+?)\\s*$", "im"));
    if (match?.[1]) return match[1].replace(/^`|`$/g, "").trim();
  }
  return "";
}

function readbackAgentAccepted(explicitAgent, text) {
  return /Ona Platform Codex/i.test(explicitAgent) || /^(Agent mode|Agent|Verifier):\s*Ona Platform Codex\s*$/im.test(text);
}

function readbackIdentityAccepted(text) {
  const identity = markerValue(text, "Identity");
  return /\bCodex\b/i.test(identity) && /Ona Platform Codex/i.test(identity);
}

function readbackPlatformEvidenceAccepted(text) {
  const evidence = markerValue(text, ["Platform evidence", "Provider evidence", "Agent selector"]);
  if (/(missing|unavailable|blocked|none|null|unknown)/i.test(evidence)) return false;
  if (!/\bCodex\b/i.test(evidence)) return false;
  return !/(Ai-Automations Action Execution|default Ona Agent|Claude)/i.test(evidence);
}

function readbackSessionId(explicitSession, text) {
  if (hasValue(explicitSession)) return explicitSession;
  return markerValue(text, "Session id") || markerValue(text, "Session");
}

function readbackPassed(text) {
  const result = markerValue(text, "Result") || markerValue(text, "Status") || markerValue(text, "Release decision");
  return /^(passed|pass|completed|complete|succeeded|success)$/i.test(result);
}

function expectedValuePresent(value) {
  return hasValue(value) && !["unknown", "manual"].includes(String(value).trim().toLowerCase());
}

function commitMatches(actual, expected) {
  if (!hasValue(actual) || !hasValue(expected)) return false;
  const actualText = String(actual).trim();
  const expectedText = String(expected).trim();
  return actualText === expectedText || expectedText.startsWith(actualText) || actualText.startsWith(expectedText);
}

function readbackMatchesExpected(text, expected) {
  const failures = [];
  const evidence = [];
  const taskId = markerValue(text, ["Task id", "Task"]);
  const branch = markerValue(text, "Branch");
  const commit = markerValue(text, "Commit");
  if (!readbackIdentityAccepted(text)) {
    failures.push("Identity marker must say Codex running in Ona Platform Codex");
  } else {
    evidence.push("Identity: Codex on Ona Platform Codex diagnostic");
  }

  if (!readbackPlatformEvidenceAccepted(text)) {
    failures.push("Platform evidence marker must show the Ona session was created with Codex selected; self-reported identity is not accepted");
  } else {
    evidence.push("Platform evidence: Codex selector/API");
  }

  if (expectedValuePresent(expected.taskId)) {
    if (taskId !== expected.taskId) {
      failures.push(`Task id mismatch: expected ${expected.taskId}, got ${taskId || "missing"}`);
    } else {
      evidence.push(`Task id: ${expected.taskId}`);
    }
  }

  if (expectedValuePresent(expected.branch)) {
    if (branch !== expected.branch) {
      failures.push(`Branch mismatch: expected ${expected.branch}, got ${branch || "missing"}`);
    } else {
      evidence.push(`Branch: ${expected.branch}`);
    }
  }

  if (expectedValuePresent(expected.commit)) {
    if (!commitMatches(commit, expected.commit)) {
      failures.push(`Commit mismatch: expected ${expected.commit}, got ${commit || "missing"}`);
    } else {
      evidence.push(`Commit: ${expected.commit}`);
    }
  }

  return { passed: failures.length === 0, failures, evidence };
}

function codexApiSessionEvidence(report) {
  const failures = [];
  const evidence = [];
  if (!report) {
    return {
      status: "missing",
      failures: ["No Ona Platform Codex API session report is available."],
      evidence,
      agentExecutionId: "",
    };
  }
  const result = normalizeStatus(report.result);
  const requestedAgentId = report.codexAgentId ?? "";
  const execution = report.readback?.agentExecution ?? {};
  const spec = execution.spec ?? {};
  const status = execution.status ?? {};
  const actualAgentId = spec.agentId ?? "";
  const agentExecutionId = report.agentExecutionId || execution.id || "";

  if (result === "blocked") {
    failures.push(...(report.blockers ?? ["Ona Platform Codex API probe is blocked."]));
  }
  if (!hasValue(agentExecutionId)) {
    failures.push("Ona Platform Codex API probe did not expose an agent execution id.");
  } else {
    evidence.push(`API execution: ${agentExecutionId}`);
  }
  if (!hasValue(requestedAgentId)) {
    failures.push("Ona Platform Codex API probe did not record a requested Codex agent id.");
  }
  if (hasValue(requestedAgentId) && actualAgentId !== requestedAgentId) {
    failures.push(`Ona Platform Codex API probe spec.agentId mismatch: expected ${requestedAgentId}, got ${actualAgentId || "missing"}.`);
  }
  if (actualAgentId === "00000000-0000-0000-0000-000000007100") {
    failures.push("Ona Platform Codex API probe read back the default Ona automation agent id.");
  }
  if (actualAgentId === requestedAgentId && hasValue(actualAgentId)) {
    evidence.push("API spec.agentId matches requested Codex agent id");
  }
  if (!spec.codexSettings && !status.codexSettings) {
    failures.push("Ona Platform Codex API probe did not expose spec.codexSettings or status.codexSettings.");
  } else {
    evidence.push("API readback includes codexSettings");
  }
  if (hasValue(status.supportedModel)) evidence.push(`API supportedModel: ${status.supportedModel}`);
  if (hasValue(status.conversationUrl)) evidence.push("API conversationUrl present");

  const passed = failures.length === 0 && result === "passed";
  return {
    status: passed ? "passed" : failures.length > 0 ? "blocked" : result === "dry-run" ? "partial" : result,
    failures,
    evidence,
    agentExecutionId,
  };
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

function dateMs(value) {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : 0;
}

function prebuildCreatedMs(prebuild) {
  return dateMs(prebuild?.metadata?.createdAt);
}

function prebuildUpdatedMs(prebuild) {
  return dateMs(prebuild?.metadata?.updatedAt ?? prebuild?.metadata?.createdAt);
}

function newestFirst(prebuilds) {
  return [...prebuilds].sort((left, right) => prebuildCreatedMs(right) - prebuildCreatedMs(left));
}

function describePrebuild(prebuild) {
  const phase = prebuild?.status?.phase ?? "unknown";
  const updatedAt = prebuild?.metadata?.updatedAt ?? "unknown";
  return `Ona prebuild ${prebuild?.id ?? "unknown"} is ${phase} since ${updatedAt}`;
}

function queryOnaPrebuild(projectId) {
  if (!hasValue(projectId)) return null;
  const result = spawnSync("ona", ["prebuild", "list", "--project-id", projectId, "--format", "json"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return {
      status: "missing",
      evidence: ["Ona prebuild readback failed; check Ona CLI authentication."],
    };
  }

  let prebuilds = [];
  try {
    prebuilds = JSON.parse(result.stdout);
  } catch {
    return {
      status: "missing",
      evidence: ["Ona prebuild readback returned non-JSON output."],
    };
  }
  if (!Array.isArray(prebuilds) || prebuilds.length === 0) {
    return {
      status: "missing",
      evidence: ["No Ona prebuild records returned for the project."],
    };
  }

  const sorted = newestFirst(prebuilds);
  const now = Date.now();
  const latest = sorted[0];
  const latestStatus = latest?.status ?? {};
  const completed = sorted.find((prebuild) => {
    const status = prebuild?.status ?? {};
    return status.phase === "PREBUILD_PHASE_COMPLETED" && Number(status.snapshotCompletionPercentage ?? 0) >= 100;
  });
  const active = activePrebuildPhases.has(latestStatus.phase) ? latest : null;
  const staleActive = active && now - prebuildUpdatedMs(active) >= prebuildStaleMs ? active : null;
  if (completed) {
    const status = completed.status ?? {};
    const warnings = [];
    if (active && prebuildCreatedMs(active) > prebuildCreatedMs(completed)) {
      warnings.push(
        `${describePrebuild(active)}; completed baseline ${completed.id} remains usable while the environment refresh runs.`,
      );
    }
    if (staleActive) {
      warnings.push(`${describePrebuild(active)}; inspect or cancel this stale background prebuild refresh.`);
    }
    if (failedPrebuildPhases.has(latestStatus.phase) && prebuildCreatedMs(latest) > prebuildCreatedMs(completed)) {
      warnings.push(
        `${describePrebuild(latest)}; completed baseline ${completed.id} remains usable, but the latest environment refresh failed or was cancelled.`,
      );
    }
    return {
      id: completed.id,
      status: "passed",
      evidence: [
        `Ona prebuild baseline ${completed.id} completed`,
        status.snapshotSizeBytes ? `snapshot ${status.snapshotSizeBytes} bytes` : "",
        status.completionTime ? `completed ${status.completionTime}` : "",
      ].filter(Boolean),
      warnings,
    };
  }

  if (active) {
    return {
      id: active.id,
      status: staleActive ? "blocked" : "partial",
      evidence: [describePrebuild(active), "No completed Ona prebuild baseline is available yet."],
      blocker: staleActive
        ? "Ona prebuild refresh is stale and no completed baseline is available for new Codex environments."
        : "",
      warnings: staleActive ? [`${describePrebuild(active)}; inspect or cancel this stale prebuild.`] : [],
    };
  }

  if (failedPrebuildPhases.has(latestStatus.phase)) {
    return {
      id: latest.id,
      status: "blocked",
      evidence: [`Ona prebuild evidence is ${latestStatus.phase}`],
      blocker: "No completed Ona prebuild baseline is available.",
    };
  }

  return {
    status: "missing",
    evidence: ["Ona prebuild records did not contain a completed, active, or failed phase."],
  };
}

const validationInfo = await fileInfo(args.validationReport);
const summaryInfo = await fileInfo(args.acceptanceSummary);
const mp4Info = await fileInfo(args.acceptanceMp4);
const reviewInfo = await fileInfo(args.videoReview);
const releaseInfo = await fileInfo(args.videoReleaseGate);
const prReportInfo = await fileInfo(args.prReport);
const linearSyncInfo = await fileInfo(args.linearSyncReport);
const secretPreflightInfo = await fileInfo(args.secretPreflight);
const automationExecutionReportInfo = await fileInfo(args.onaAutomationExecutionReport);
const platformCodexApiReportInfo = await fileInfo(args.onaPlatformCodexApiReport);
const platformCodexApiSessionInfo = await fileInfo(args.onaPlatformCodexApiSession);
const implementationReadbackInfo = await fileInfo(args.onaImplementationReadback);
const verifierReadbackInfo = await fileInfo(args.onaVerifierReadback);
const releaseText = await readText(args.videoReleaseGate);
const reviewText = await readText(args.videoReview);
const prReportText = await readText(args.prReport);
const linearSyncText = await readText(args.linearSyncReport);
const implementationReadbackText = await readText(args.onaImplementationReadback);
const verifierReadbackText = await readText(args.onaVerifierReadback);
const secretPreflight = await readJson(args.secretPreflight);
const automationExecutionReport = await readJson(args.onaAutomationExecutionReport);
const platformCodexApiSession = await readJson(args.onaPlatformCodexApiSession);
const secretPreflightActions = Array.isArray(secretPreflight?.nextActions)
  ? secretPreflight.nextActions.filter(Boolean)
  : [];
const autoPrebuild = !hasValue(args.onaPrebuild) || normalizeStatus(args.onaPrebuildStatus) === "missing"
  ? queryOnaPrebuild(args.onaProject)
  : null;
if (!hasValue(args.onaPrebuild) && autoPrebuild?.id) args.onaPrebuild = autoPrebuild.id;
if (normalizeStatus(args.onaPrebuildStatus) === "missing" && autoPrebuild?.status) {
  args.onaPrebuildStatus = autoPrebuild.status;
}
const autoPrebuildEvidence = Array.isArray(autoPrebuild?.evidence) ? autoPrebuild.evidence : [];
const autoPrebuildWarnings = Array.isArray(autoPrebuild?.warnings) ? autoPrebuild.warnings : [];
const autoPrebuildBlocker = typeof autoPrebuild?.blocker === "string" ? autoPrebuild.blocker : "";
if (!hasValue(args.prUrl)) {
  args.prUrl = markerValue(prReportText, "PR URL");
}
if (!hasValue(args.onaAutomationExecution) && hasValue(automationExecutionReport?.executionId)) {
  args.onaAutomationExecution = automationExecutionReport.executionId;
}

function statusFromAutomationExecutionReport(report) {
  const result = String(report?.result ?? "").trim().toLowerCase();
  if (result === "completed") return "passed";
  if (["running", "timed_out", "timed_out_cancelled", "completed_with_failed_actions"].includes(result)) return "partial";
  if (result === "missing" || result === "") return "missing";
  return "blocked";
}

const automationExecutionStatus = statusFromAutomationExecutionReport(automationExecutionReport);
const automationExecutionEvidence = automationExecutionReportInfo
  ? [
      `${args.onaAutomationExecutionReport} (${automationExecutionReport?.result ?? "unknown"})`,
      automationExecutionReport?.phase && `Execution phase: ${automationExecutionReport.phase}`,
      Number.isFinite(Number(automationExecutionReport?.failedActionCount)) &&
        `failedActionCount: ${Number(automationExecutionReport.failedActionCount)}`,
      hasValue(automationExecutionReport?.sessionId) && `Automation session: ${automationExecutionReport.sessionId}`,
      automationExecutionReport?.cancelOnTimeout === true && "Timed-out execution cancellation was enabled",
      automationExecutionReport?.cancellation?.status &&
        `Cancellation status: ${automationExecutionReport.cancellation.status}`,
    ].filter(Boolean)
  : [];
const automationExecutionWarning =
  automationExecutionReport?.result === "completed_with_failed_actions"
    ? "Ona automation execution finished with failed actions; the guarded finalizer stopped before downstream side effects."
    : automationExecutionReport?.result === "timed_out"
      ? "Ona automation execution readback timed out before a terminal phase."
      : automationExecutionReport?.result === "timed_out_cancelled"
        ? `Ona automation execution readback timed out and cancellation was requested${
            automationExecutionReport?.cancellation?.status
              ? ` (${automationExecutionReport.cancellation.status})`
              : ""
          }.`
      : "";

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
  : automationExecutionStatus !== "missing"
    ? automationExecutionStatus
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
const platformCodexApi = codexApiSessionEvidence(platformCodexApiSession);
const platformCodexLaunchStatus = codexAuthFailed ? "blocked" : platformCodexApi.status;
const implementationSessionId = readbackSessionId(args.onaImplementationSession, implementationReadbackText);
const implementationAgentAccepted = readbackAgentAccepted(args.onaImplementationAgent, implementationReadbackText);
const implementationReadbackBound = readbackMatchesExpected(implementationReadbackText, {
  taskId: args.taskId,
  branch: args.branch,
  commit: args.commit,
});
const implementationRequestedStatus = normalizeStatus(args.onaImplementationStatus);
const implementationClaimsPassed = implementationRequestedStatus === "passed" || readbackPassed(implementationReadbackText);
const implementationStatus = codexAuthFailed
  ? "blocked"
  : implementationClaimsPassed
    ? implementationAgentAccepted && hasValue(implementationSessionId) && implementationReadbackBound.passed
      ? "passed"
      : "blocked"
    : implementationReadbackInfo || hasValue(implementationSessionId)
      ? "partial"
      : "missing";
const branchStatus = implementationStatus === "passed" && args.branch && args.commit ? "passed" : "missing";
const validationStatus = branchStatus === "passed" && validationInfo && validationInfo.size > 0 ? "passed" : "missing";
const mp4Status = validationStatus === "passed" && summaryInfo && mp4Info && mp4Info.size > 0
  ? "passed"
  : validationStatus === "passed" && summaryInfo
    ? "partial"
    : "missing";
const verifierSessionId = readbackSessionId(args.onaVerifierSession, verifierReadbackText);
const verifierAgentAccepted =
  readbackAgentAccepted(args.onaVerifierAgent, verifierReadbackText) ||
  /Verifier:\s*Ona Platform Codex/im.test(reviewText);
const verifierReadbackBound = readbackMatchesExpected(verifierReadbackText, {
  taskId: args.taskId,
  branch: args.branch,
  commit: args.commit,
});
const verifierClaimsPassed =
  normalizeStatus(args.onaVerifierStatus) === "passed" ||
  readbackPassed(verifierReadbackText) ||
  (reviewInfo && /Release decision:\s*pass/im.test(reviewText));
const verifierStatus = mp4Status === "passed"
  ? verifierClaimsPassed
    ? verifierAgentAccepted && hasValue(verifierSessionId) && verifierReadbackBound.passed
      ? "passed"
      : "blocked"
    : reviewInfo || verifierReadbackInfo || hasValue(verifierSessionId)
      ? "partial"
      : "missing"
  : "missing";
const releaseStatus = verifierStatus === "passed" && releaseInfo && /Result:\s*`?passed`?/im.test(releaseText)
  ? "passed"
  : verifierStatus === "passed" && releaseInfo
    ? "blocked"
    : "missing";
const prStatus = releaseStatus === "passed" && hasValue(args.prUrl) ? "passed" : "missing";
const ciStatus = prStatus === "passed" && hasValue(args.ciUrl) ? "passed" : "missing";
const statusSyncStatus = ciStatus === "passed" && hasValue(args.githubStatusUrl) && hasValue(args.linearStatusUrl)
  ? "passed"
  : ciStatus === "passed" && (hasValue(args.githubStatusUrl) || hasValue(args.linearStatusUrl) || linearSyncInfo)
    ? /created comment|updated .* status|attached /i.test(linearSyncText)
      ? "partial"
      : "partial"
    : "missing";

const codexBlocker = codexAuthFailed
  ? "Ona Platform Codex rejected the LLM request as unauthenticated before repository commands could run."
  : implementationStatus === "blocked"
    ? `Implementation evidence must identify Agent mode: Ona Platform Codex, Identity: I am Codex running in Ona Platform Codex, Platform evidence from the Ona UI/API selector, Session id, Result: passed, Task id, Branch, and Commit in ${args.onaImplementationReadback}; generic Ona automation, task, stale readback, wrong branch, self-reported identity, or default-agent evidence is not accepted.${implementationReadbackBound.failures.length ? ` ${implementationReadbackBound.failures.join(" ")}` : ""}`
    : implementationStatus === "missing"
      ? `No accepted automated Ona Platform Codex implementation session id or readback evidence was supplied. Expected ${args.onaImplementationReadback} with Agent mode: Ona Platform Codex, Identity: I am Codex running in Ona Platform Codex, Platform evidence from the Ona UI/API selector, Session id, Result: passed, Task id, Branch, and Commit.`
      : "";
const platformCodexLaunchBlocker = codexAuthFailed
  ? "Ona Platform Codex rejected the LLM request as unauthenticated before repository commands could run."
  : platformCodexLaunchStatus === "blocked"
    ? `Programmatic Ona Platform Codex launch/readback is blocked. Run npm run agent-factory:start-codex -- --start --identity-canary with GITPOD_API_KEY or ONA_TOKEN and MINELINK_ONA_CODEX_AGENT_ID. ${platformCodexApi.failures.join(" ")}`
    : platformCodexLaunchStatus === "missing"
      ? `No programmatic Ona Platform Codex API launch/readback evidence was supplied. Expected ${args.onaPlatformCodexApiSession} from npm run agent-factory:start-codex -- --start --identity-canary.`
      : "";
const globalBlocker = args.blocker || codexBlocker;
const prebuildBlocker =
  prebuildStatus === "blocked"
    ? autoPrebuildBlocker || args.blocker || "No completed Ona prebuild baseline is available for new Codex environments."
    : "";

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
    secretPreflightInfo && `${args.secretPreflight}${secretPreflight?.result ? ` (${secretPreflight.result})` : ""}`,
  ], dispatcherStatus === "blocked" ? globalBlocker : ""),
  mkNode("ona_automation", "Ona automation execution", automationStatus, [
    hasValue(args.onaAutomation) && `Automation: ${args.onaAutomation}`,
    hasValue(args.onaAutomationExecution) && `Execution: ${args.onaAutomationExecution}`,
    ...automationExecutionEvidence,
  ], automationStatus === "blocked" ? globalBlocker : ""),
  mkNode("ona_prebuild", "Ona project prebuild ready", prebuildStatus, [
    hasValue(args.onaProject) && `Ona project: ${args.onaProject}`,
    hasValue(args.onaPrebuild) && `Ona prebuild: ${args.onaPrebuild}`,
    ...autoPrebuildEvidence,
  ], prebuildBlocker),
  mkNode("platform_codex_launch", "Ona Platform Codex API launch", platformCodexLaunchStatus, [
    platformCodexApiSessionInfo && args.onaPlatformCodexApiSession,
    platformCodexApiReportInfo && args.onaPlatformCodexApiReport,
    ...platformCodexApi.evidence,
  ], platformCodexLaunchBlocker),
  mkNode("implementation_codex", "Ona Platform Codex implementation session", implementationStatus, [
    implementationSessionId && `Implementation session: ${implementationSessionId}`,
    implementationAgentAccepted && "Agent mode: Ona Platform Codex",
    implementationReadbackInfo && readbackIdentityAccepted(implementationReadbackText) && "Identity: Codex on Ona Platform Codex diagnostic",
    implementationReadbackInfo && readbackPlatformEvidenceAccepted(implementationReadbackText) && "Platform evidence: Codex selector/API",
    ...implementationReadbackBound.evidence,
    implementationReadbackInfo && args.onaImplementationReadback,
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
  mkNode("video_verifier", "Same-session verifier subagent", verifierStatus, [
    verifierSessionId && `Implementation/verifier execution: ${verifierSessionId}`,
    verifierAgentAccepted && "Agent mode: Ona Platform Codex",
    verifierReadbackInfo && readbackIdentityAccepted(verifierReadbackText) && "Identity: Codex on Ona Platform Codex diagnostic",
    verifierReadbackInfo && readbackPlatformEvidenceAccepted(verifierReadbackText) && "Platform evidence: Codex selector/API",
    ...verifierReadbackBound.evidence,
    verifierReadbackInfo && args.onaVerifierReadback,
    reviewInfo && args.videoReview,
  ], verifierStatus === "blocked" ? `Video verifier evidence must include same-session Platform Codex readback in ${args.onaVerifierReadback}, platform selector/API evidence, match Task id/Branch/Commit, and approve the current acceptance artifacts.${verifierReadbackBound.failures.length ? ` ${verifierReadbackBound.failures.join(" ")}` : ""}` : ""),
  mkNode("release_gate", "Video release gate", releaseStatus, [
    releaseInfo && args.videoReleaseGate,
  ], releaseStatus === "blocked" ? "Video release gate failed or hashes do not match." : ""),
  mkNode("pr", "Pull request", prStatus, [
    args.prUrl && `PR: ${args.prUrl}`,
    prReportInfo && args.prReport,
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
const prebuildHandoffStatus =
  nodeStatus.ona_prebuild === "passed"
    ? "passed"
    : nodeStatus.ona_prebuild === "partial"
      ? "partial"
      : "blocked";
const prebuildHandoffBlocker =
  nodeStatus.ona_prebuild === "passed"
    ? ""
    : nodeStatus.ona_prebuild === "partial"
      ? prebuildBlocker
      : prebuildBlocker || "No completed Ona prebuild baseline is available; Codex handoff must wait for a prepared environment.";
const automationHandoffStatus =
  nodeStatus.ona_automation === "passed" || nodeStatus.ona_automation === "partial"
    ? nodeStatus.platform_codex_launch
    : "blocked";
const codexImplementationHandoffStatus =
  nodeStatus.platform_codex_launch === "passed"
    ? nodeStatus.implementation_codex
    : "blocked";
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
    ...automationExecutionEvidence,
  ]),
  mkEdge("ona_prebuild", "platform_codex_launch", prebuildHandoffStatus, [
    hasValue(args.onaProject) && `Ona project: ${args.onaProject}`,
    hasValue(args.onaPrebuild) && `Ona prebuild: ${args.onaPrebuild}`,
    ...autoPrebuildEvidence,
  ], prebuildHandoffBlocker),
  mkEdge("ona_automation", "platform_codex_launch", automationHandoffStatus, [
    hasValue(args.onaAutomation) && `Automation: ${args.onaAutomation}`,
    hasValue(args.onaAutomationExecution) && `Execution: ${args.onaAutomationExecution}`,
    ...automationExecutionEvidence,
    platformCodexApiSessionInfo && args.onaPlatformCodexApiSession,
    ...platformCodexApi.evidence,
  ], nodeStatus.ona_automation === "blocked" ? globalBlocker : platformCodexLaunchBlocker),
  mkEdge("platform_codex_launch", "implementation_codex", codexImplementationHandoffStatus, [
    platformCodexApiSessionInfo && args.onaPlatformCodexApiSession,
    platformCodexApiReportInfo && args.onaPlatformCodexApiReport,
    ...platformCodexApi.evidence,
    implementationSessionId && `Implementation session: ${implementationSessionId}`,
    implementationAgentAccepted && "Agent mode: Ona Platform Codex",
    implementationReadbackInfo && readbackPlatformEvidenceAccepted(implementationReadbackText) && "Platform evidence: Codex selector/API",
    ...implementationReadbackBound.evidence,
    implementationReadbackInfo && args.onaImplementationReadback,
  ], nodeStatus.platform_codex_launch === "passed" ? codexBlocker : platformCodexLaunchBlocker),
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
  ], verifierStatus === "blocked" ? `Video verifier evidence must include same-session Platform Codex readback in ${args.onaVerifierReadback}, platform selector/API evidence, match Task id/Branch/Commit, and approve the current acceptance artifacts.${verifierReadbackBound.failures.length ? ` ${verifierReadbackBound.failures.join(" ")}` : ""}` : ""),
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
if (autoPrebuildWarnings.length > 0) {
  nextActions.push(...autoPrebuildWarnings.map((warning) => `Investigate Ona prebuild warning: ${warning}`));
}
if (automationExecutionWarning) {
  nextActions.push(`Inspect Ona automation execution readback: ${automationExecutionWarning}`);
}
if (firstBlockedEdge?.to === "issue_contract") {
  nextActions.push("Fix the GitHub/Linear task contract so it has agent-ready labels, scope, forbidden changes, validation, evidence, video requirement, and remaining gaps.");
} else if (firstBlockedEdge?.to === "github_dispatcher") {
  if (secretPreflightActions.length > 0) {
    nextActions.push(...secretPreflightActions);
  } else {
    nextActions.push("Run the GitHub issue dispatcher workflow or Linear watcher and attach its Actions URL/report.");
  }
} else if (firstBlockedEdge?.to === "ona_automation") {
  nextActions.push("Provide ONA_TOKEN/Ona CLI authentication, start the Ona automation, and capture the automation execution id.");
} else if (
  firstBlockedEdge?.from === "ona_prebuild" &&
  firstBlockedEdge?.to === "platform_codex_launch" &&
  nodeStatus.ona_prebuild !== "passed"
) {
  nextActions.push("Trigger the Ona prebuild refresh only when the environment baseline is missing or environment-sensitive files changed, then wait for a completed baseline before Codex handoff.");
  if (prebuildBlocker) nextActions.push(prebuildBlocker);
} else if (firstBlockedEdge?.to === "platform_codex_launch") {
  nextActions.push("Run `npm run agent-factory:start-codex -- --start --identity-canary` with GITPOD_API_KEY or ONA_TOKEN and MINELINK_ONA_CODEX_AGENT_ID, then attach `.minelink-dev/reports/ona-platform-codex-api-session.json`.");
  if (platformCodexLaunchBlocker) nextActions.push(platformCodexLaunchBlocker);
} else if (firstBlockedEdge?.to === "implementation_codex") {
  if (automationExecutionReport?.result === "completed_with_failed_actions") {
    nextActions.push("The dispatcher reached Ona and the guarded finalizer failed closed. Start or repair the Ona Platform Codex implementation session and write the accepted implementation readback.");
  } else if (nodeStatus.platform_codex_launch === "passed") {
    nextActions.push("Start the task-bound Ona Platform Codex implementation session from the accepted launch path, then write the implementation readback with task id, branch, commit, session id, and platform evidence.");
  } else {
    nextActions.push("Repair or expose programmatic Ona Platform Codex launch/authentication, start a fresh Codex implementation session, and capture the session id plus logs.");
  }
} else if (firstBlockedEdge?.to === "branch_commit") {
  nextActions.push("Wait for the Ona Platform Codex implementation session to create the bounded branch/commit, or mark the task blocked with the session evidence.");
} else if (firstBlockedEdge?.to === "validation") {
  nextActions.push("Run the required validation command and preserve `.minelink-dev/reports/agent-task-summary.md`.");
} else if (firstBlockedEdge?.to === "acceptance_video") {
  nextActions.push("Render acceptance artifacts with `node scripts/dev/render-acceptance-video.mjs --require-mp4`.");
} else if (firstBlockedEdge?.to === "video_verifier") {
  nextActions.push("Send the verifier request to the existing Ona Platform Codex implementation execution, have its native verifier subagent write `.minelink-dev/reports/artifacts/video-review.md`, then rerun the release gate.");
} else if (firstBlockedEdge?.to === "release_gate") {
  nextActions.push("Run `node scripts/dev/check-video-review.mjs --require-mp4` and fix any hash or verifier mismatch.");
} else if (firstBlockedEdge?.to === "pr") {
  nextActions.push("Open or update the draft PR with links to the validation, MP4, verifier report, release gate, and remaining gaps.");
} else if (firstBlockedEdge?.to === "ci") {
  nextActions.push("Wait for required GitHub Actions and attach run URLs or logs.");
} else if (firstBlockedEdge?.to === "status_writeback") {
  nextActions.push("Write the final evidence summary back to GitHub and Linear without printing secrets.");
}
if (
  globalBlocker &&
  !(firstBlockedEdge?.from === "ona_prebuild" && firstBlockedEdge?.to === "implementation_codex") &&
  !nextActions.includes(globalBlocker)
) {
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
  warnings: [...autoPrebuildWarnings, automationExecutionWarning].filter(Boolean),
  automationExecution: automationExecutionReportInfo
    ? {
        path: args.onaAutomationExecutionReport,
        result: automationExecutionReport?.result ?? "unknown",
        phase: automationExecutionReport?.phase ?? "unknown",
        failedActionCount: automationExecutionReport?.failedActionCount ?? null,
        sessionId: automationExecutionReport?.sessionId ?? "",
        cancelOnTimeout: automationExecutionReport?.cancelOnTimeout ?? false,
        cancellation: automationExecutionReport?.cancellation ?? null,
      }
    : null,
  platformCodexApiSession: platformCodexApiSessionInfo
    ? {
        path: args.onaPlatformCodexApiSession,
        reportPath: platformCodexApiReportInfo ? args.onaPlatformCodexApiReport : "",
        result: platformCodexApiSession?.result ?? "unknown",
        agentExecutionId: platformCodexApi.agentExecutionId,
        status: platformCodexLaunchStatus,
      }
    : null,
  nextActions,
  secretPreflight: secretPreflightInfo
    ? {
        path: args.secretPreflight,
        result: secretPreflight?.result ?? "unknown",
        nextActions: secretPreflightActions,
      }
    : null,
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
  "## Warnings",
  "",
  ...([...autoPrebuildWarnings, automationExecutionWarning].filter(Boolean).length > 0
    ? [...autoPrebuildWarnings, automationExecutionWarning].filter(Boolean).map((warning) => `- ${escapeMd(warning)}`)
    : ["- none"]),
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

if (requirePlatformCodexImplementation && implementationStatus !== "passed") {
  console.error(
    `Required Ona Platform Codex implementation evidence is missing or invalid. See ${args.output}.`,
  );
  process.exit(1);
}

if (requirePlatformCodexVerifier && verifierStatus !== "passed") {
  console.error(
    `Required Ona Platform Codex verifier evidence is missing or invalid. See ${args.output}.`,
  );
  process.exit(1);
}
