#!/usr/bin/env node
import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import path from "node:path";

const defaults = {
  repository: process.env.GITHUB_REPOSITORY ?? "",
  branch: process.env.MINELINK_BRANCH ?? "",
  taskId: process.env.MINELINK_TASK_ID ?? "manual",
  reportPath: process.env.MINELINK_PLATFORM_CODEX_TASK_REPORT_PATH ?? "",
  apiSession: ".minelink-dev/reports/ona-platform-codex-api-session.json",
  output: ".minelink-dev/reports/ona-codex-implementation-session.md",
  jsonOutput: ".minelink-dev/reports/ona-codex-implementation-session.json",
  waitSeconds: Number(process.env.MINELINK_PLATFORM_CODEX_BRANCH_WAIT_SECONDS ?? 300),
  pollSeconds: Number(process.env.MINELINK_PLATFORM_CODEX_BRANCH_POLL_SECONDS ?? 10),
};

const args = { ...defaults };

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repository") args.repository = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--task-id") args.taskId = readValue();
  else if (arg === "--report-path") args.reportPath = readValue();
  else if (arg === "--api-session") args.apiSession = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--wait-seconds") args.waitSeconds = Number(readValue());
  else if (arg === "--poll-seconds") args.pollSeconds = Number(readValue());
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/fetch-platform-codex-task-report.mjs --repository owner/repo --branch <branch> --task-id <id>

Fetches the real task implementation report committed by an Ona Platform Codex
session, combines it with AgentService API readback, and writes the canonical
.minelink-dev/reports/ona-codex-implementation-session.md evidence file.

This script validates task implementation readback only. It does not prove
video release, PR publication, or MineLink product acceptance.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

function pathSegment(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "manual";
}

if (!args.reportPath) {
  args.reportPath = `docs/agent-factory-task-reports/${pathSegment(args.taskId)}.md`;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function githubHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  if (hasValue(token)) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function encodePath(value) {
  return String(value)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function githubGet(apiPath) {
  const response = await fetch(`https://api.github.com${apiPath}`, { headers: githubHeaders() });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 1000) };
  }
  if (!response.ok) {
    const err = new Error(`GitHub API ${apiPath} failed with HTTP ${response.status}`);
    err.body = body;
    throw err;
  }
  return body;
}

async function fetchRemoteReport() {
  const branchPath = `/repos/${args.repository}/branches/${encodeURIComponent(args.branch)}`;
  const branch = await githubGet(branchPath);
  const commit = branch?.commit?.sha ?? "";
  const contentsPath = `/repos/${args.repository}/contents/${encodePath(args.reportPath)}?ref=${encodeURIComponent(args.branch)}`;
  const content = await githubGet(contentsPath);
  const encoding = content?.encoding ?? "";
  const encoded = String(content?.content ?? "").replace(/\s+/g, "");
  if (encoding !== "base64" || !encoded) {
    throw new Error(`GitHub contents response for ${args.reportPath} did not include base64 content.`);
  }
  return {
    text: Buffer.from(encoded, "base64").toString("utf8"),
    commit,
    htmlUrl: content?.html_url ?? "",
  };
}

async function loadReport(validateRemote) {
  const deadline = Date.now() + Math.max(0, args.waitSeconds) * 1000;
  let lastFailure = "";
  do {
    try {
      const candidate = await fetchRemoteReport();
      const check = validateRemote(candidate.text);
      if (check.failures.length === 0) return { ...candidate, remoteCheck: check };
      lastFailure = check.failures.join("; ");
    } catch (error) {
      lastFailure = error.message;
    }
    if (Date.now() >= deadline || args.waitSeconds === 0) break;
    await sleep(Math.max(1, args.pollSeconds) * 1000);
  } while (true);
  return { text: "", commit: "", htmlUrl: "", remoteWaitFailure: `Task implementation report is not current yet: ${lastFailure || "missing report"}` };
}

function apiSessionEvidence(apiSession) {
  const failures = [];
  const evidence = [];
  const agentExecutionId = apiSession?.agentExecutionId ?? "";
  const agentMode = apiSession?.agentMode ?? "";
  const apiEvidence = Array.isArray(apiSession?.evidence) ? apiSession.evidence.join("\n") : "";
  if (apiSession?.result !== "passed") failures.push("AgentService API session did not pass.");
  else evidence.push("AgentService API session passed");
  if (!hasValue(agentExecutionId)) failures.push("AgentService API session is missing agentExecutionId.");
  else evidence.push(`AgentService execution ${agentExecutionId}`);
  if (agentMode !== "AGENT_MODE_GOAL") failures.push(`AgentService API session mode must be AGENT_MODE_GOAL, got ${agentMode || "missing"}.`);
  else evidence.push("requested Goal mode");
  if (!apiSession?.codexSettings) failures.push("AgentService API session is missing codexSettings.");
  else evidence.push("codexSettings present");
  if (!/spec\.agentId matches requested Codex agent id/i.test(apiEvidence)) {
    failures.push("AgentService API session is missing configured Codex agent id readback evidence.");
  } else {
    evidence.push("spec.agentId matched configured Codex agent id");
  }
  return { failures, evidence, agentExecutionId, agentMode };
}

function validateTaskReport(text, agentExecutionId, expectedAgentMode) {
  const failures = [];
  const evidence = [];
  const taskId = markerValue(text, ["Task id", "Task"]);
  const branch = markerValue(text, "Branch");
  const sessionId = markerValue(text, ["Session id", "Session"]);
  const agentMode = markerValue(text, "Agent execution mode");
  const platformEvidence = markerValue(text, ["Platform evidence", "Provider evidence", "Agent selector"]);
  const result = markerValue(text, ["Result", "Status"]);
  const validationResult = markerValue(text, "Validation result");
  const boundary = markerValue(text, "Boundary");

  if (!/MineLink Platform Codex Task Implementation Report/i.test(text)) {
    failures.push("Task report is missing the MineLink Platform Codex Task Implementation Report heading.");
  } else {
    evidence.push("task report heading present");
  }
  if (taskId !== args.taskId) failures.push(`Task report Task id mismatch: expected ${args.taskId}, got ${taskId || "missing"}.`);
  else evidence.push(`Task id ${args.taskId}`);
  if (branch !== args.branch) failures.push(`Task report Branch mismatch: expected ${args.branch}, got ${branch || "missing"}.`);
  else evidence.push(`Branch ${args.branch}`);
  if (sessionId !== agentExecutionId) {
    failures.push(`Task report Session id mismatch: expected ${agentExecutionId || "missing"}, got ${sessionId || "missing"}.`);
  } else {
    evidence.push("task report session id matches AgentService execution");
  }
  if (agentMode !== expectedAgentMode) {
    failures.push(`Task report Agent execution mode mismatch: expected ${expectedAgentMode || "missing"}, got ${agentMode || "missing"}.`);
  } else {
    evidence.push(`task report agent execution mode ${agentMode}`);
  }
  if (!/(AgentService|Codex)/i.test(platformEvidence)) {
    failures.push("Task report Platform evidence must mention AgentService or Codex.");
  } else {
    evidence.push("task report platform evidence marker present");
  }
  if (!/^(passed|pass|success|succeeded)$/i.test(result)) failures.push(`Task report Result is not passed: ${result || "missing"}.`);
  else evidence.push("task report result passed");
  if (!/^(passed|pass|success|succeeded)$/i.test(validationResult)) {
    failures.push(`Task report Validation result is not passed: ${validationResult || "missing"}.`);
  } else {
    evidence.push("task report validation result passed");
  }
  if (!/task-implementation evidence only/i.test(boundary)) {
    failures.push("Task report Boundary must say task-implementation evidence only.");
  } else {
    evidence.push("task report boundary limits product claim");
  }
  return { failures, evidence };
}

const failures = [];
const evidence = [];
const apiSession = await readJson(args.apiSession);
const api = apiSessionEvidence(apiSession);
failures.push(...api.failures);
evidence.push(...api.evidence);

let report = null;
try {
  const validateRemote = (candidate) => validateTaskReport(candidate, api.agentExecutionId, api.agentMode);
  report = await loadReport(validateRemote);
  evidence.push(`task report ${args.reportPath}`);
  if (report.htmlUrl) evidence.push(`task report URL ${report.htmlUrl}`);
  if (report.remoteWaitFailure) failures.push(report.remoteWaitFailure);
} catch (error) {
  failures.push(error.message);
}

if (report?.text) {
  const reportCheck = report.remoteCheck ?? validateTaskReport(report.text, api.agentExecutionId, api.agentMode);
  failures.push(...reportCheck.failures);
  evidence.push(...reportCheck.evidence);
}

const commit = report?.commit || "";
const commitShort = commit ? commit.slice(0, 12) : "";
if (!hasValue(commit)) {
  failures.push("No branch commit was available for task implementation readback.");
} else {
  evidence.push(`branch commit ${commitShort || commit}`);
}

await fs.mkdir(path.dirname(args.output), { recursive: true });
const readbackLines = [
  "Agent mode: Ona Platform Codex",
  `Agent execution mode: ${api.agentMode || "missing"}`,
  "Identity: I am Codex running in Ona Platform Codex",
  `Platform evidence: Ona AgentService Codex API readback for execution ${api.agentExecutionId || "missing"} had spec.agentId matching the configured Codex agent id and codexSettings present; GitHub branch ${args.branch || "missing"} contains the session-bound Codex task implementation report ${args.reportPath}.`,
  `Session id: ${api.agentExecutionId || "missing"}`,
  `Result: ${failures.length === 0 ? "passed" : "blocked"}`,
  `Task id: ${args.taskId}`,
  `Branch: ${args.branch || "missing"}`,
  `Commit: ${commit || "missing"}`,
  "Validation: Platform Codex task implementation report branch fetch and validation marker check",
  `Evidence: ${report?.htmlUrl || args.reportPath}`,
  "Remaining gaps: This is task-implementation handoff evidence only; video verifier, PR release, and MineLink product acceptance remain separate gates.",
  "",
  "## Task Report Content",
  "",
  report?.text ? ["```md", report.text.trim(), "```"].join("\n") : "- missing",
  "",
  "## Failures",
  "",
  ...(failures.length === 0 ? ["- none"] : failures.map((failure) => `- ${failure}`)),
  "",
];
await fs.writeFile(args.output, `${readbackLines.join("\n")}\n`, "utf8");

await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(
  args.jsonOutput,
  `${JSON.stringify(
    {
      result: failures.length === 0 ? "passed" : "blocked",
      taskId: args.taskId,
      branch: args.branch,
      commit,
      commitShort,
      reportPath: args.reportPath,
      reportUrl: report?.htmlUrl ?? "",
      apiSession: args.apiSession,
      agentExecutionId: api.agentExecutionId,
      agentMode: api.agentMode,
      evidence,
      failures,
      boundary:
        "task-implementation handoff evidence only; does not prove MineLink product acceptance or video release",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

if (failures.length > 0) {
  console.error(`Platform Codex task implementation blocked; wrote ${args.output}`);
  process.exit(1);
}

console.log(`Platform Codex task implementation passed; wrote ${args.output}`);
