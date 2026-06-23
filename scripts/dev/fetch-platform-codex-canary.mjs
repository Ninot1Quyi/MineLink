#!/usr/bin/env node
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const defaults = {
  repository: process.env.GITHUB_REPOSITORY ?? "",
  branch: process.env.MINELINK_BRANCH ?? "",
  taskId: process.env.MINELINK_TASK_ID ?? "manual",
  canaryPath: process.env.MINELINK_PLATFORM_CODEX_CANARY_PATH ?? "",
  canaryFile: "",
  branchCommit: "",
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
  else if (arg === "--canary-path") args.canaryPath = readValue();
  else if (arg === "--canary-file") args.canaryFile = readValue();
  else if (arg === "--branch-commit") args.branchCommit = readValue();
  else if (arg === "--api-session") args.apiSession = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--wait-seconds") args.waitSeconds = Number(readValue());
  else if (arg === "--poll-seconds") args.pollSeconds = Number(readValue());
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/fetch-platform-codex-canary.mjs --repository owner/repo --branch <branch> --task-id <id>

Fetches the docs-only implementation canary committed by an Ona Platform Codex
session, combines it with AgentService API readback, and writes the canonical
.minelink-dev/reports/ona-codex-implementation-session.md evidence file.

This script does not prove product acceptance. It only proves the bounded
platform_codex_launch -> implementation_codex handoff for a canary task.`);
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

if (!args.canaryPath) {
  args.canaryPath = `docs/agent-factory-canaries/${pathSegment(args.taskId)}.md`;
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

function sanitizeOutput(value) {
  const withoutSecretLines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => {
      if (/(^|_)(TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|PRIVATE|API_KEY)(_|=|$)/i.test(line)) {
        return line.replace(/=.*/, "=[redacted]");
      }
      return line;
    })
    .join("\n");
  return withoutSecretLines
    .replace(/(ghp|github_pat|lin_api|sk-[A-Za-z0-9_-]*|cfat_[A-Za-z0-9_-]+)/gi, "[redacted]")
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, "[redacted-hex]")
    .slice(0, 4000);
}

function runCommand(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    ...options,
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
  });
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

async function fetchRemoteCanary() {
  const branchPath = `/repos/${args.repository}/branches/${encodeURIComponent(args.branch)}`;
  const branch = await githubGet(branchPath);
  const commit = branch?.commit?.sha ?? "";
  const contentsPath = `/repos/${args.repository}/contents/${encodePath(args.canaryPath)}?ref=${encodeURIComponent(args.branch)}`;
  const content = await githubGet(contentsPath);
  const encoding = content?.encoding ?? "";
  const encoded = String(content?.content ?? "").replace(/\s+/g, "");
  if (encoding !== "base64" || !encoded) {
    throw new Error(`GitHub contents response for ${args.canaryPath} did not include base64 content.`);
  }
  return {
    text: Buffer.from(encoded, "base64").toString("utf8"),
    commit,
    htmlUrl: content?.html_url ?? "",
  };
}

function salvageScript() {
  return [
    "set -euo pipefail",
    "",
    'expected_branch="${MINELINK_EXPECTED_BRANCH:?}"',
    'canary_path="${MINELINK_CANARY_PATH:?}"',
    'task_id="${MINELINK_TASK_ID:?}"',
    'session_id="${MINELINK_AGENT_EXECUTION_ID:?}"',
    'agent_mode="${MINELINK_AGENT_MODE:?}"',
    "",
    'current_branch="$(git branch --show-current)"',
    'if [ "$current_branch" != "$expected_branch" ]; then',
    '  echo "Refusing canary salvage: current branch \'$current_branch\' is not expected branch \'$expected_branch\'." >&2',
    "  exit 20",
    "fi",
    "",
    'if [ ! -f "$canary_path" ]; then',
    '  echo "Refusing canary salvage: expected canary file \'$canary_path\' is missing." >&2',
    "  exit 21",
    "fi",
    "",
    "require_marker() {",
    '  local marker="$1"',
    '  if ! grep -F -- "$marker" "$canary_path" >/dev/null; then',
    '    echo "Refusing canary salvage: marker \'$marker\' is missing from \'$canary_path\'." >&2',
    "    exit 22",
    "  fi",
    "}",
    "",
    'require_marker "MineLink Platform Codex Implementation Canary"',
    'require_marker "Agent execution mode: $agent_mode"',
    'require_marker "Session id: $session_id"',
    'require_marker "Task id: $task_id"',
    'require_marker "Branch: $expected_branch"',
    'require_marker "Result: passed"',
    'require_marker "Validation result: passed"',
    'require_marker "Boundary: implementation-canary only; does not prove MineLink product acceptance."',
    "",
    "if ! git config user.name >/dev/null; then",
    '  git config user.name "MineLink Automation"',
    "fi",
    "if ! git config user.email >/dev/null; then",
    '  git config user.email "actions@github.com"',
    "fi",
    "",
    'git add -- "$canary_path"',
    'if ! git diff --cached --quiet -- "$canary_path"; then',
    "  git commit \\",
    '    -m "Record Platform Codex implementation handoff" \\',
    '    -m "Constraint: Commit only the task-bound implementation canary produced in the Ona environment." \\',
    '    -m "Confidence: medium" \\',
    '    -m "Scope-risk: narrow" \\',
    '    -m "Tested: Canary markers and docs validation marker checked before push." \\',
    '    -m "Not-tested: Product acceptance video; downstream release gates run separately."',
    "fi",
    "",
    'git push origin "HEAD:$expected_branch"',
    "git rev-parse HEAD",
    "",
  ].join("\n");
}

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

async function salvageOnaCanary(apiSession, api) {
  const environmentId = apiSession?.environmentId ?? "";
  if (!hasValue(environmentId)) {
    return { attempted: false, ok: false, message: "Ona canary salvage skipped: API session did not record environmentId." };
  }
  if (!hasValue(api?.agentExecutionId) || !hasValue(api?.agentMode)) {
    return { attempted: false, ok: false, message: "Ona canary salvage skipped: API session did not record execution id and mode." };
  }

  const remoteScript = [
    `export MINELINK_EXPECTED_BRANCH=${shellQuote(args.branch)}`,
    `export MINELINK_CANARY_PATH=${shellQuote(args.canaryPath)}`,
    `export MINELINK_TASK_ID=${shellQuote(args.taskId)}`,
    `export MINELINK_AGENT_EXECUTION_ID=${shellQuote(api.agentExecutionId)}`,
    `export MINELINK_AGENT_MODE=${shellQuote(api.agentMode)}`,
    salvageScript(),
  ].join("\n");

  const result = runCommand(
    "ona",
    [
      "environment",
      "exec",
      environmentId,
      "--working-dir",
      "/workspaces/MineLink",
      "--timeout",
      "180",
      "--",
      `bash -lc ${shellQuote(remoteScript)}`,
    ],
  );
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.status === 0) {
    return {
      attempted: true,
      ok: true,
      message: `Ona canary salvage pushed ${args.canaryPath} from environment ${environmentId}.`,
      output: sanitizeOutput(output),
    };
  }
  return {
    attempted: true,
    ok: false,
    message: `Ona canary salvage failed in environment ${environmentId} with exit ${result.status ?? "unknown"}.`,
    output: sanitizeOutput(output),
  };
}

async function loadCanary(validateRemote, options = {}) {
  if (hasValue(args.canaryFile)) {
    const text = await fs.readFile(args.canaryFile, "utf8");
    const candidate = {
      text,
      commit: args.branchCommit,
      htmlUrl: args.canaryFile,
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
  let lastSalvageAttempt = null;
  let salvageSucceeded = false;
  do {
    try {
      const candidate = await fetchRemoteCanary();
      if (validateRemote) {
        const check = validateRemote(candidate);
        if (check.failures.length === 0) {
          return { ...candidate, remoteCheck: check };
        }
        lastCandidate = candidate;
        lastCheck = check;
        lastError = new Error(
          `Implementation branch evidence for ${args.canaryPath} is not current yet: ${check.failures.join("; ")}`,
        );
      } else {
        return candidate;
      }
    } catch (error) {
      lastError = error;
      if (!salvageSucceeded && options.salvageRemote) {
        lastSalvageAttempt = await options.salvageRemote(error);
        if (lastSalvageAttempt?.ok) {
          salvageSucceeded = true;
          await sleep(Math.min(5000, Math.max(1000, args.pollSeconds * 1000)));
          continue;
        }
      }
    }
    if (Date.now() >= deadline || args.waitSeconds === 0) break;
    await sleep(Math.max(1, args.pollSeconds) * 1000);
  } while (Date.now() < deadline);

  if (lastCandidate) {
    return {
      ...lastCandidate,
      remoteCheck: lastCheck,
      remoteWaitFailure:
        [
          lastError?.message ?? `Timed out waiting for current Platform Codex implementation evidence at ${args.canaryPath}.`,
          lastSalvageAttempt && !lastSalvageAttempt.ok ? lastSalvageAttempt.message : "",
          lastSalvageAttempt && !lastSalvageAttempt.ok && lastSalvageAttempt.output ? lastSalvageAttempt.output : "",
        ]
          .filter(Boolean)
          .join("\n"),
    };
  }
  if (lastSalvageAttempt && !lastSalvageAttempt.ok) {
    const error = new Error(
      [
        lastError?.message ?? "Timed out waiting for Platform Codex canary branch evidence.",
        lastSalvageAttempt.message,
        lastSalvageAttempt.output,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    throw error;
  }
  throw lastError ?? new Error("Timed out waiting for Platform Codex canary branch evidence.");
}

function apiSessionEvidence(report) {
  const failures = [];
  const evidence = [];
  const result = String(report?.result ?? "").trim().toLowerCase();
  const reportTaskId = report?.taskId ?? "";
  const reportBranch = report?.branch ?? "";
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

function validateCanary(text, agentExecutionId, expectedAgentMode) {
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

  if (!/MineLink Platform Codex Implementation Canary/i.test(text)) {
    failures.push("Canary file is missing the MineLink Platform Codex Implementation Canary heading.");
  } else {
    evidence.push("canary heading present");
  }
  if (taskId !== args.taskId) failures.push(`Canary Task id mismatch: expected ${args.taskId}, got ${taskId || "missing"}.`);
  else evidence.push(`Task id ${args.taskId}`);
  if (branch !== args.branch) failures.push(`Canary Branch mismatch: expected ${args.branch}, got ${branch || "missing"}.`);
  else evidence.push(`Branch ${args.branch}`);
  if (sessionId !== agentExecutionId) {
    failures.push(`Canary Session id mismatch: expected ${agentExecutionId || "missing"}, got ${sessionId || "missing"}.`);
  } else {
    evidence.push("canary session id matches AgentService execution");
  }
  if (agentMode !== expectedAgentMode) {
    failures.push(`Canary Agent execution mode mismatch: expected ${expectedAgentMode || "missing"}, got ${agentMode || "missing"}.`);
  } else {
    evidence.push(`canary agent execution mode ${agentMode}`);
  }
  if (!/(AgentService|Codex)/i.test(platformEvidence)) {
    failures.push("Canary Platform evidence must mention AgentService or Codex.");
  } else {
    evidence.push("canary platform evidence marker present");
  }
  if (!/^(passed|pass|success|succeeded)$/i.test(result)) failures.push(`Canary Result is not passed: ${result || "missing"}.`);
  else evidence.push("canary result passed");
  if (!/^(passed|pass|success|succeeded)$/i.test(validationResult)) {
    failures.push(`Canary Validation result is not passed: ${validationResult || "missing"}.`);
  } else {
    evidence.push("canary validation result passed");
  }
  if (!/implementation-canary only/i.test(boundary)) {
    failures.push("Canary Boundary must say implementation-canary only.");
  } else {
    evidence.push("canary boundary limits product claim");
  }

  return { failures, evidence };
}

const failures = [];
const evidence = [];
const apiSession = await readJson(args.apiSession);
const api = apiSessionEvidence(apiSession);
failures.push(...api.failures);
evidence.push(...api.evidence);

let canary = null;
try {
  const validateRemote =
    api.failures.length === 0 ? (candidate) => validateCanary(candidate.text, api.agentExecutionId, api.agentMode) : null;
  canary = await loadCanary(validateRemote, {
    salvageRemote:
      api.failures.length === 0
        ? async () => {
            const salvage = await salvageOnaCanary(apiSession, api);
            if (salvage?.ok) evidence.push(salvage.message);
            return salvage;
          }
        : null,
  });
  evidence.push(`canary file ${args.canaryPath}`);
  if (canary.htmlUrl) evidence.push(`canary URL ${canary.htmlUrl}`);
  if (canary.remoteWaitFailure) failures.push(canary.remoteWaitFailure);
} catch (error) {
  failures.push(error.message);
}

if (canary?.text) {
  const canaryCheck = canary.remoteCheck ?? validateCanary(canary.text, api.agentExecutionId, api.agentMode);
  failures.push(...canaryCheck.failures);
  evidence.push(...canaryCheck.evidence);
}

const commit = canary?.commit || args.branchCommit || "";
const commitShort = commit ? commit.slice(0, 12) : "";
if (!hasValue(commit)) {
  failures.push("No branch commit was available for implementation readback.");
} else {
  evidence.push(`branch commit ${commitShort || commit}`);
}

await fs.mkdir(path.dirname(args.output), { recursive: true });
const readbackLines = [
  "Agent mode: Ona Platform Codex",
  `Agent execution mode: ${api.agentMode || "missing"}`,
  "Identity: I am Codex running in Ona Platform Codex",
  `Platform evidence: Ona AgentService Codex API readback for execution ${api.agentExecutionId || "missing"} had spec.agentId matching the configured Codex agent id and codexSettings present; GitHub branch ${args.branch || "missing"} contains the session-bound Codex canary file ${args.canaryPath}.`,
  `Session id: ${api.agentExecutionId || "missing"}`,
  `Result: ${failures.length === 0 ? "passed" : "blocked"}`,
  `Task id: ${args.taskId}`,
  `Branch: ${args.branch || "missing"}`,
  `Commit: ${commit || "missing"}`,
  "Validation: Platform Codex implementation canary branch fetch and docs-scope validation marker check",
  `Evidence: ${canary?.htmlUrl || args.canaryFile || args.canaryPath}`,
  "Remaining gaps: This is an implementation-canary handoff only; video verifier, PR release, real product task implementation, and MineLink product acceptance remain separate gates.",
  "",
  "## Canary Content",
  "",
  canary?.text ? ["```md", canary.text.trim(), "```"].join("\n") : "- missing",
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
      canaryPath: args.canaryPath,
      canaryUrl: canary?.htmlUrl ?? "",
      apiSession: args.apiSession,
      agentExecutionId: api.agentExecutionId,
      agentMode: api.agentMode,
      evidence,
      failures,
      boundary:
        "implementation-canary handoff evidence only; does not prove MineLink product acceptance or video release",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

if (failures.length > 0) {
  console.error(`Platform Codex implementation canary blocked; wrote ${args.output}`);
  process.exit(1);
}

console.log(`Platform Codex implementation canary passed; wrote ${args.output}`);
