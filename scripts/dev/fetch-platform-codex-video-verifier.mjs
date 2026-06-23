#!/usr/bin/env node
import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import path from "node:path";

const defaults = {
  repository: process.env.GITHUB_REPOSITORY ?? "",
  branch: process.env.MINELINK_BRANCH ?? "",
  taskId: process.env.MINELINK_TASK_ID ?? "manual",
  commit: process.env.MINELINK_COMMIT ?? "",
  verifierPath: process.env.MINELINK_PLATFORM_CODEX_VERIFIER_PATH ?? "",
  verifierFile: "",
  branchCommit: "",
  apiSession: ".minelink-dev/reports/ona-platform-codex-video-verifier-api-session.json",
  reviewRequest: ".minelink-dev/reports/artifacts/video-review-request.md",
  reviewOutput: ".minelink-dev/reports/artifacts/video-review.md",
  output: ".minelink-dev/reports/ona-codex-video-verifier-session.md",
  jsonOutput: ".minelink-dev/reports/ona-codex-video-verifier-session.json",
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
  else if (arg === "--commit") args.commit = readValue();
  else if (arg === "--verifier-path") args.verifierPath = readValue();
  else if (arg === "--verifier-file") args.verifierFile = readValue();
  else if (arg === "--branch-commit") args.branchCommit = readValue();
  else if (arg === "--api-session") args.apiSession = readValue();
  else if (arg === "--review-request") args.reviewRequest = readValue();
  else if (arg === "--review-output") args.reviewOutput = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--wait-seconds") args.waitSeconds = Number(readValue());
  else if (arg === "--poll-seconds") args.pollSeconds = Number(readValue());
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/fetch-platform-codex-video-verifier.mjs --repository owner/repo --branch <branch> --task-id <id> --commit <sha>

Fetches the docs-only video-verifier canary committed after a same-session
verifier subagent request, combines it with AgentService API readback, writes the canonical
.minelink-dev/reports/ona-codex-video-verifier-session.md evidence file, and
materializes .minelink-dev/reports/artifacts/video-review.md for the release
gate.

This script does not prove product acceptance. It only proves the bounded
acceptance_video -> video_verifier handoff for a canary task.`);
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

if (!args.verifierPath) {
  args.verifierPath = `docs/agent-factory-canaries/${pathSegment(args.taskId)}-video-verifier.md`;
}

function hasValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.length > 0 && !["none", "null", "undefined", "-"].includes(normalized);
}

function markerValue(text, names) {
  const keys = Array.isArray(names) ? names : [names];
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(text ?? "").match(new RegExp(`^-?\\s*${escaped}:\\s*` + "`?(.+?)`?\\s*$", "im"));
    if (match?.[1]) return match[1].replace(/^`|`$/g, "").trim();
  }
  return "";
}

function commitMatches(actual, expected) {
  if (!hasValue(actual) || !hasValue(expected)) return false;
  const actualText = String(actual).trim();
  const expectedText = String(expected).trim();
  return actualText === expectedText || expectedText.startsWith(actualText) || actualText.startsWith(expectedText);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const response = await fetch(`https://api.github.com${apiPath}`, {
    headers: githubHeaders(),
  });
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

async function fetchRemoteVerifier() {
  const branchPath = `/repos/${args.repository}/branches/${encodeURIComponent(args.branch)}`;
  const branch = await githubGet(branchPath);
  const commit = branch?.commit?.sha ?? "";
  const contentsPath = `/repos/${args.repository}/contents/${encodePath(args.verifierPath)}?ref=${encodeURIComponent(args.branch)}`;
  const content = await githubGet(contentsPath);
  const encoding = content?.encoding ?? "";
  const encoded = String(content?.content ?? "").replace(/\s+/g, "");
  if (encoding !== "base64" || !encoded) {
    throw new Error(`GitHub contents response for ${args.verifierPath} did not include base64 content.`);
  }
  return {
    text: Buffer.from(encoded, "base64").toString("utf8"),
    commit,
    htmlUrl: content?.html_url ?? "",
  };
}

async function loadVerifier(validateRemote) {
  if (hasValue(args.verifierFile)) {
    const text = await fs.readFile(args.verifierFile, "utf8");
    const candidate = {
      text,
      commit: args.branchCommit,
      htmlUrl: args.verifierFile,
    };
    if (validateRemote) candidate.remoteCheck = validateRemote(candidate);
    return candidate;
  }

  if (!hasValue(args.repository)) throw new Error("--repository or GITHUB_REPOSITORY is required.");
  if (!hasValue(args.branch)) throw new Error("--branch is required.");

  const deadline = Date.now() + args.waitSeconds * 1000;
  let lastError = null;
  let lastCandidate = null;
  let lastCheck = null;
  do {
    try {
      const candidate = await fetchRemoteVerifier();
      if (validateRemote) {
        const check = validateRemote(candidate);
        if (check.failures.length === 0) {
          return { ...candidate, remoteCheck: check };
        }
        lastCandidate = candidate;
        lastCheck = check;
        lastError = new Error(
          `Verifier branch evidence for ${args.verifierPath} is not current yet: ${check.failures.join("; ")}`,
        );
      } else {
        return candidate;
      }
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline || args.waitSeconds === 0) break;
    await sleep(Math.max(1, args.pollSeconds) * 1000);
  } while (Date.now() < deadline);

  if (lastCandidate) {
    return {
      ...lastCandidate,
      remoteCheck: lastCheck,
      remoteWaitFailure:
        lastError?.message ?? `Timed out waiting for current Platform Codex verifier evidence at ${args.verifierPath}.`,
    };
  }
  throw lastError ?? new Error("Timed out waiting for Platform Codex verifier branch evidence.");
}

function apiSessionEvidence(report) {
  const failures = [];
  const evidence = [];
  const result = String(report?.result ?? "").trim().toLowerCase();
  const reportTaskId = report?.taskId ?? "";
  const reportBranch = report?.branch ?? "";
  const reportCommit = report?.commit ?? "";
  const execution = report?.readback?.agentExecution ?? {};
  const spec = execution.spec ?? {};
  const status = execution.status ?? {};
  const requestedAgentId = report?.codexAgentId ?? "";
  const requestedAgentMode = report?.agentMode ?? "";
  const readbackMode = spec.mode ?? status.mode ?? "";
  const actualAgentId = spec.agentId ?? "";
  const agentExecutionId = report?.agentExecutionId || execution.id || "";

  if (result !== "passed") failures.push(`Ona Platform Codex API session result is ${result || "missing"}.`);
  if (reportTaskId !== args.taskId) {
    failures.push(`Ona Platform Codex API session Task id mismatch: expected ${args.taskId}, got ${reportTaskId || "missing"}.`);
  } else {
    evidence.push(`API task id ${args.taskId}`);
  }
  if (reportBranch !== args.branch) {
    failures.push(`Ona Platform Codex API session Branch mismatch: expected ${args.branch}, got ${reportBranch || "missing"}.`);
  } else {
    evidence.push(`API branch ${args.branch}`);
  }
  if (hasValue(args.commit) && !commitMatches(reportCommit, args.commit)) {
    failures.push(`Ona Platform Codex API session Commit mismatch: expected ${args.commit}, got ${reportCommit || "missing"}.`);
  } else if (hasValue(args.commit)) {
    evidence.push(`API reviewed commit ${args.commit}`);
  }
  if (!hasValue(agentExecutionId)) failures.push("Ona Platform Codex API session did not record agentExecutionId.");
  else evidence.push(`AgentService execution ${agentExecutionId}`);
  if (!hasValue(requestedAgentId)) failures.push("Ona Platform Codex API session did not record requested Codex agent id.");
  if (hasValue(requestedAgentId) && actualAgentId !== requestedAgentId) {
    failures.push(`Ona Platform Codex API spec.agentId mismatch: expected ${requestedAgentId}, got ${actualAgentId || "missing"}.`);
  } else if (hasValue(actualAgentId)) {
    evidence.push("spec.agentId matched configured Codex agent id");
  }
  if (actualAgentId === "00000000-0000-0000-0000-000000007100") {
    failures.push("Ona Platform Codex API session used the default Ona automation agent id.");
  }
  if (!spec.codexSettings && !status.codexSettings) {
    failures.push("Ona Platform Codex API readback did not expose codexSettings.");
  } else {
    evidence.push("codexSettings present");
  }
  if (requestedAgentMode !== "AGENT_MODE_GOAL") {
    failures.push(`Ona Platform Codex API session did not request Goal mode: ${requestedAgentMode || "missing"}.`);
  } else {
    evidence.push("requested Goal mode");
  }
  if (hasValue(readbackMode)) {
    if (readbackMode !== requestedAgentMode) {
      failures.push(`Ona Platform Codex API mode mismatch: expected ${requestedAgentMode}, got ${readbackMode}.`);
    } else {
      evidence.push(`readback mode ${readbackMode}`);
    }
  }
  if (hasValue(status.supportedModel)) evidence.push(`supportedModel ${status.supportedModel}`);

  return { failures, evidence, agentExecutionId, agentMode: requestedAgentMode };
}

function reviewRequestEvidence(text) {
  const taskId = markerValue(text, "Task id");
  const branch = markerValue(text, "Branch");
  const summaryHash = markerValue(text, "Summary sha256");
  const mp4Hash = markerValue(text, "MP4 sha256");
  const videoProducer = markerValue(text, "Video producer");
  const clientGuiCapture = markerValue(text, "Client GUI capture");
  const clientWorldReady = markerValue(text, "Client world ready");
  const captureStartedAfterWorldReady = markerValue(text, "Capture started after world ready");
  const clientGuiCaptureRequired = markerValue(text, "Client GUI capture required");
  const status = markerValue(text, "Request status");
  const failures = [];
  const evidence = [];

  if (!hasValue(text)) failures.push(`Missing video review request: ${args.reviewRequest}`);
  if (hasValue(args.taskId) && taskId !== args.taskId) {
    failures.push(`Video review request Task id mismatch: expected ${args.taskId}, got ${taskId || "missing"}.`);
  } else if (hasValue(taskId)) {
    evidence.push(`Review request task id ${taskId}`);
  }
  if (hasValue(args.branch) && branch !== args.branch) {
    failures.push(`Video review request Branch mismatch: expected ${args.branch}, got ${branch || "missing"}.`);
  } else if (hasValue(branch)) {
    evidence.push(`Review request branch ${branch}`);
  }
  if (!hasValue(summaryHash) || summaryHash === "missing") failures.push("Video review request is missing Summary sha256.");
  else evidence.push("Review request summary hash present");
  if (!hasValue(mp4Hash) || mp4Hash === "missing") failures.push("Video review request is missing MP4 sha256.");
  else evidence.push("Review request MP4 hash present");
  if (!hasValue(videoProducer) || videoProducer === "unknown") failures.push("Video review request is missing Video producer.");
  else evidence.push(`Review request producer ${videoProducer}`);
  if (/^yes$/i.test(clientGuiCaptureRequired)) {
    if (!/^yes$/i.test(clientGuiCapture)) failures.push(`Video review request requires client GUI capture but got ${clientGuiCapture || "missing"}.`);
    else evidence.push("Review request client GUI capture present");
    if (!/^yes$/i.test(clientWorldReady)) failures.push(`Video review request requires an in-world client view but got ${clientWorldReady || "missing"}.`);
    else evidence.push("Review request client world-ready marker present");
    if (!/^yes$/i.test(captureStartedAfterWorldReady)) {
      failures.push(`Video review request requires capture after world-ready but got ${captureStartedAfterWorldReady || "missing"}.`);
    } else {
      evidence.push("Review request capture-after-world-ready marker present");
    }
  }
  if (status && status !== "ready") failures.push(`Video review request status is not ready: ${status}.`);

  return {
    failures,
    evidence,
    summaryHash,
    mp4Hash,
    videoProducer,
    clientGuiCapture,
    clientWorldReady,
    captureStartedAfterWorldReady,
    clientGuiCaptureRequired,
  };
}

function validateVerifierCanary(text, agentExecutionId, expected) {
  const failures = [];
  const evidence = [];
  const taskId = markerValue(text, ["Task id", "Task"]);
  const branch = markerValue(text, "Branch");
  const commit = markerValue(text, "Commit");
  const sessionId = markerValue(text, ["Session id", "Session"]);
  const agentMode = markerValue(text, "Agent execution mode");
  const platformEvidence = markerValue(text, ["Platform evidence", "Provider evidence", "Agent selector"]);
  const verifier = markerValue(text, ["Verifier", "Agent mode"]);
  const releaseDecision = markerValue(text, ["Release decision", "Result"]);
  const taskMatched = markerValue(text, "Task matched");
  const videoMatched = markerValue(text, "Video matched");
  const summaryHash = markerValue(text, "Summary sha256");
  const mp4Hash = markerValue(text, "MP4 sha256");
  const clientGuiCapture = markerValue(text, "Client GUI capture");
  const clientWorldReady = markerValue(text, "Client world ready");
  const captureStartedAfterWorldReady = markerValue(text, "Capture started after world ready");
  const result = markerValue(text, ["Result", "Status"]);
  const boundary = markerValue(text, "Boundary");

  if (!/MineLink Platform Codex Video Verifier Canary/i.test(text)) {
    failures.push("Verifier canary is missing the MineLink Platform Codex Video Verifier Canary heading.");
  } else {
    evidence.push("verifier canary heading present");
  }
  if (taskId !== args.taskId) failures.push(`Verifier canary Task id mismatch: expected ${args.taskId}, got ${taskId || "missing"}.`);
  else evidence.push(`Task id ${args.taskId}`);
  if (branch !== args.branch) failures.push(`Verifier canary Branch mismatch: expected ${args.branch}, got ${branch || "missing"}.`);
  else evidence.push(`Branch ${args.branch}`);
  if (hasValue(args.commit) && !commitMatches(commit, args.commit)) {
    failures.push(`Verifier canary Commit mismatch: expected ${args.commit}, got ${commit || "missing"}.`);
  } else if (hasValue(args.commit)) {
    evidence.push(`Commit ${args.commit}`);
  }
  if (sessionId !== agentExecutionId) {
    failures.push(`Verifier canary Session id mismatch: expected ${agentExecutionId || "missing"}, got ${sessionId || "missing"}.`);
  } else {
    evidence.push("verifier canary session id matches AgentService execution");
  }
  if (agentMode !== expected.agentMode) {
    failures.push(`Verifier canary Agent execution mode mismatch: expected ${expected.agentMode || "missing"}, got ${agentMode || "missing"}.`);
  } else {
    evidence.push(`verifier canary agent execution mode ${agentMode}`);
  }
  if (!/(AgentService|Codex)/i.test(platformEvidence)) {
    failures.push("Verifier canary Platform evidence must mention AgentService or Codex.");
  } else {
    evidence.push("verifier canary platform evidence marker present");
  }
  if (!/ona platform codex/i.test(verifier)) failures.push(`Verifier canary Verifier marker is not Ona Platform Codex: ${verifier || "missing"}.`);
  else evidence.push("verifier marker accepted");
  if (!/^pass(ed)?$/i.test(releaseDecision)) failures.push(`Verifier canary release decision is not pass: ${releaseDecision || "missing"}.`);
  else evidence.push("release decision passed");
  if (!/^yes$/i.test(taskMatched)) failures.push(`Verifier canary task match is not yes: ${taskMatched || "missing"}.`);
  else evidence.push("task match accepted");
  if (!/^yes$/i.test(videoMatched)) failures.push(`Verifier canary video match is not yes: ${videoMatched || "missing"}.`);
  else evidence.push("video match accepted");
  if (summaryHash !== expected.summaryHash) failures.push(`Verifier canary Summary sha256 mismatch: expected ${expected.summaryHash || "missing"}, got ${summaryHash || "missing"}.`);
  else evidence.push("summary hash matches review request");
  if (mp4Hash !== expected.mp4Hash) failures.push(`Verifier canary MP4 sha256 mismatch: expected ${expected.mp4Hash || "missing"}, got ${mp4Hash || "missing"}.`);
  else evidence.push("MP4 hash matches review request");
  if (/^yes$/i.test(expected.clientGuiCaptureRequired) && !/^yes$/i.test(clientGuiCapture)) {
    failures.push(`Verifier canary Client GUI capture is not yes: ${clientGuiCapture || "missing"}.`);
  } else if (/^yes$/i.test(clientGuiCapture)) {
    evidence.push("verifier canary client GUI capture accepted");
  }
  if (/^yes$/i.test(expected.clientGuiCaptureRequired) && !/^yes$/i.test(clientWorldReady)) {
    failures.push(`Verifier canary Client world ready is not yes: ${clientWorldReady || "missing"}.`);
  } else if (/^yes$/i.test(clientWorldReady)) {
    evidence.push("verifier canary client world-ready marker accepted");
  }
  if (/^yes$/i.test(expected.clientGuiCaptureRequired) && !/^yes$/i.test(captureStartedAfterWorldReady)) {
    failures.push(
      `Verifier canary Capture started after world ready is not yes: ${captureStartedAfterWorldReady || "missing"}.`,
    );
  } else if (/^yes$/i.test(captureStartedAfterWorldReady)) {
    evidence.push("verifier canary capture-after-world-ready marker accepted");
  }
  if (!/^(passed|pass|success|succeeded)$/i.test(result)) failures.push(`Verifier canary Result is not passed: ${result || "missing"}.`);
  else evidence.push("verifier canary result passed");
  if (!/video-verifier-canary only/i.test(boundary)) {
    failures.push("Verifier canary Boundary must say video-verifier-canary only.");
  } else {
    evidence.push("verifier canary boundary limits product claim");
  }

  return { failures, evidence };
}

const failures = [];
const evidence = [];
const apiSession = await readJson(args.apiSession);
const api = apiSessionEvidence(apiSession);
failures.push(...api.failures);
evidence.push(...api.evidence);

const requestText = await readText(args.reviewRequest);
const request = reviewRequestEvidence(requestText);
failures.push(...request.failures);
evidence.push(...request.evidence);

let verifier = null;
try {
  const verifierExpectation = {
    ...request,
    agentMode: api.agentMode,
  };
  const validateRemote =
    api.failures.length === 0 && request.failures.length === 0
      ? (candidate) => validateVerifierCanary(candidate.text, api.agentExecutionId, verifierExpectation)
      : null;
  verifier = await loadVerifier(validateRemote);
  evidence.push(`verifier file ${args.verifierPath}`);
  if (verifier.htmlUrl) evidence.push(`verifier URL ${verifier.htmlUrl}`);
  if (verifier.remoteWaitFailure) failures.push(verifier.remoteWaitFailure);
} catch (error) {
  failures.push(error.message);
}

if (verifier?.text) {
  const verifierCheck =
    verifier.remoteCheck ??
    validateVerifierCanary(verifier.text, api.agentExecutionId, {
      ...request,
      agentMode: api.agentMode,
    });
  failures.push(...verifierCheck.failures);
  evidence.push(...verifierCheck.evidence);
}

const branchCommit = (verifier?.commit || args.branchCommit || "").slice(0, 12);
if (!hasValue(branchCommit)) {
  failures.push("No branch commit was available for video verifier readback.");
} else {
  evidence.push(`verifier branch commit ${branchCommit}`);
}

await fs.mkdir(path.dirname(args.reviewOutput), { recursive: true });
const reviewLines = [
  "Verifier: Ona Platform Codex",
  `Agent execution mode: ${api.agentMode || "missing"}`,
  `Release decision: ${failures.length === 0 ? "pass" : "fail"}`,
  `Task matched: ${failures.length === 0 ? "yes" : "no"}`,
  `Video matched: ${failures.length === 0 ? "yes" : "no"}`,
  `Video producer: ${request.videoProducer || "missing"}`,
  `Client GUI capture: ${request.clientGuiCapture || "missing"}`,
  `Client world ready: ${request.clientWorldReady || "missing"}`,
  `Capture started after world ready: ${request.captureStartedAfterWorldReady || "missing"}`,
  `Summary sha256: ${request.summaryHash || "missing"}`,
  `MP4 sha256: ${request.mp4Hash || "missing"}`,
  `Task id: ${args.taskId}`,
  `Branch: ${args.branch || "missing"}`,
  `Commit: ${args.commit || "missing"}`,
  `Session id: ${api.agentExecutionId || "missing"}`,
  `Platform evidence: Ona AgentService Codex API readback for implementation execution ${api.agentExecutionId || "missing"} had spec.agentId matching the configured Codex agent id and codexSettings present; GitHub branch ${args.branch || "missing"} contains the same-session verifier subagent canary file ${args.verifierPath}.`,
  "Boundary: video-verifier canary converted into local release-gate input; not MineLink product acceptance",
  "",
  "## Failures",
  "",
  ...(failures.length === 0 ? ["- none"] : failures.map((failure) => `- ${failure}`)),
  "",
];
await fs.writeFile(args.reviewOutput, reviewLines.join("\n"), "utf8");

await fs.mkdir(path.dirname(args.output), { recursive: true });
const readbackLines = [
  "Agent mode: Ona Platform Codex",
  `Agent execution mode: ${api.agentMode || "missing"}`,
  "Identity: I am Codex running in Ona Platform Codex",
  `Platform evidence: Ona AgentService Codex API readback for implementation execution ${api.agentExecutionId || "missing"} had spec.agentId matching the configured Codex agent id and codexSettings present; GitHub branch ${args.branch || "missing"} contains the same-session verifier subagent canary file ${args.verifierPath}.`,
  `Session id: ${api.agentExecutionId || "missing"}`,
  `Result: ${failures.length === 0 ? "passed" : "blocked"}`,
  `Task id: ${args.taskId}`,
  `Branch: ${args.branch || "missing"}`,
  `Commit: ${args.commit || "missing"}`,
  "Validation: Platform Codex video verifier canary branch fetch, review hash check, and local release gate input materialization",
  `Evidence: ${verifier?.htmlUrl || args.verifierFile || args.verifierPath}`,
  "Remaining gaps: This is a video-verifier-canary handoff only; PR release, final status writeback, real product task implementation, and MineLink product acceptance remain separate gates.",
  "",
  "## Verifier Canary Content",
  "",
  verifier?.text ? ["```md", verifier.text.trim(), "```"].join("\n") : "- missing",
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
      commit: args.commit,
      branchCommit,
      verifierPath: args.verifierPath,
      verifierUrl: verifier?.htmlUrl ?? "",
      apiSession: args.apiSession,
      agentExecutionId: api.agentExecutionId,
      agentMode: api.agentMode,
      reviewRequest: args.reviewRequest,
      reviewOutput: args.reviewOutput,
      summaryHash: request.summaryHash,
      mp4Hash: request.mp4Hash,
      videoProducer: request.videoProducer,
      clientGuiCapture: request.clientGuiCapture,
      clientWorldReady: request.clientWorldReady,
      captureStartedAfterWorldReady: request.captureStartedAfterWorldReady,
      clientGuiCaptureRequired: request.clientGuiCaptureRequired,
      evidence,
      failures,
      boundary:
        "video-verifier-canary handoff evidence only; does not prove MineLink product acceptance or final PR release",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

if (failures.length > 0) {
  console.error(`Platform Codex video verifier canary blocked; wrote ${args.output}`);
  process.exit(1);
}

console.log(`Platform Codex video verifier canary passed; wrote ${args.output}`);
