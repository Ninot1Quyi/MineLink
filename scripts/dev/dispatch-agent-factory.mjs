#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const defaults = {
  source: "github",
  eventJson: process.env.GITHUB_EVENT_PATH ?? "",
  githubIssue: process.env.MINELINK_GITHUB_ISSUE ?? "",
  githubIssueNumber: process.env.MINELINK_GITHUB_ISSUE_NUMBER ?? "",
  githubIssueTitle: process.env.MINELINK_GITHUB_ISSUE_TITLE ?? "",
  githubIssueBody: process.env.MINELINK_GITHUB_ISSUE_BODY ?? "",
  githubIssueLabels: process.env.MINELINK_GITHUB_ISSUE_LABELS ?? "",
  linearIssue: process.env.MINELINK_LINEAR_ISSUE ?? "",
  acceptanceGate: process.env.MINELINK_ACCEPTANCE_GATE ?? "",
  branch: process.env.MINELINK_BRANCH ?? "",
  prTitle: process.env.MINELINK_PR_TITLE ?? "",
  validationScope: process.env.MINELINK_VALIDATION_SCOPE ?? "",
  scenarios: process.env.MINELINK_SCENARIOS ?? "",
  onaAutomation: process.env.MINELINK_ONA_AUTOMATION_ID ?? "019ee9f6-9adb-7c93-aaa6-c26337d2278b",
  onaProject: process.env.MINELINK_ONA_PROJECT_ID ?? "019ee8ed-9e1b-7cd8-9b1b-af0c8ee27edb",
  output: ".minelink-dev/reports/agent-factory-dispatch.md",
  chainOutput: ".minelink-dev/reports/agent-factory-chain.md",
  chainJsonOutput: ".minelink-dev/reports/agent-factory-chain.json",
};

const args = { ...defaults };
let dryRun = false;
let requireOna = false;
let allowBlocked = false;
let comment = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--source") args.source = readValue();
  else if (arg === "--event-json") args.eventJson = readValue();
  else if (arg === "--github-issue") args.githubIssue = readValue();
  else if (arg === "--github-issue-number") args.githubIssueNumber = readValue();
  else if (arg === "--github-issue-title") args.githubIssueTitle = readValue();
  else if (arg === "--github-issue-body") args.githubIssueBody = readValue();
  else if (arg === "--github-issue-labels") args.githubIssueLabels = readValue();
  else if (arg === "--linear-issue") args.linearIssue = readValue();
  else if (arg === "--acceptance-gate") args.acceptanceGate = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--pr-title") args.prTitle = readValue();
  else if (arg === "--validation-scope") args.validationScope = readValue();
  else if (arg === "--scenarios") args.scenarios = readValue();
  else if (arg === "--ona-automation") args.onaAutomation = readValue();
  else if (arg === "--ona-project") args.onaProject = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--chain-output") args.chainOutput = readValue();
  else if (arg === "--chain-json-output") args.chainJsonOutput = readValue();
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "--require-ona") requireOna = true;
  else if (arg === "--allow-blocked") allowBlocked = true;
  else if (arg === "--comment") comment = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/dispatch-agent-factory.mjs [options]

Validates a GitHub or Linear agent task and starts the MineLink Ona automation.
This dispatcher only queues the downstream flow; it does not replace the required Ona Platform Codex
implementation and verifier sessions.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

function sanitizeOutput(text) {
  return String(text ?? "")
    .replace(/(lin_api_)[A-Za-z0-9]+/g, "$1[redacted]")
    .replace(/(github_pat_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(ghp_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .slice(0, 4000)
    .trim();
}

function slug(value) {
  const result = String(value ?? "")
    .toLowerCase()
    .replace(/^\[agent-task\]\s*/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return result || "agent-task";
}

function labelsFrom(value) {
  if (Array.isArray(value)) {
    return value.map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean);
  }
  return String(value ?? "")
    .split(/[,\n ]+/)
    .map((label) => label.trim())
    .filter(Boolean);
}

function parseSection(body, names) {
  const wanted = Array.isArray(names) ? names : [names];
  const escaped = wanted.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(
    `^#{2,3}\\s+(${escaped.join("|")})\\s*\\n([\\s\\S]*?)(?=^#{2,3}\\s+|(?![\\s\\S]))`,
    "im",
  );
  return body.match(re)?.[2]?.trim() ?? "";
}

function parseAcceptanceGate(body) {
  const bodyGate = body.match(/Gate\s+(\d+)[^\n]*/i)?.[0]?.trim() ?? "";
  return args.acceptanceGate || bodyGate || "unspecified";
}

function parseLinearIssue(body) {
  if (args.linearIssue) return args.linearIssue;
  const linear = body.match(/\b[A-Z][A-Z0-9]+-\d+\b/)?.[0] ?? "";
  return linear || "none";
}

function inferValidationScope(body, labels) {
  if (args.validationScope) return args.validationScope;
  const commandScope = body.match(/verify-agent-task\.sh\s+--scope\s+([a-z]+)/i)?.[1];
  if (commandScope) return commandScope;
  if (labels.includes("real-neoforge-required")) return "neoforge";
  if (labels.includes("ci-reporting")) return "fast";
  if (labels.includes("docs-architecture")) return "docs";
  return "docs";
}

function inferScenarios(body, scope) {
  if (args.scenarios) return args.scenarios;
  const commandScenarios = body.match(/--scenarios\s+([A-Za-z0-9_,:-]+)/i)?.[1];
  if (commandScenarios) return commandScenarios;
  return scope === "docs" || scope === "fast" ? "none" : "guard_boundaries";
}

function issueUrlFromNumber(number) {
  if (!number) return "";
  const repo = process.env.GITHUB_REPOSITORY || "Ninot1Quyi/MineLink";
  return `https://github.com/${repo}/issues/${number}`;
}

async function loadEventIssue(eventJson) {
  if (!eventJson) return null;
  try {
    const payload = JSON.parse(await fs.readFile(eventJson, "utf8"));
    if (!payload.issue) return null;
    return {
      number: String(payload.issue.number ?? ""),
      title: payload.issue.title ?? "",
      body: payload.issue.body ?? "",
      url: payload.issue.html_url ?? issueUrlFromNumber(payload.issue.number),
      labels: labelsFrom(payload.issue.labels ?? []),
    };
  } catch {
    return null;
  }
}

function loadGhIssue(number) {
  if (!number) return null;
  const result = run("gh", [
    "issue",
    "view",
    String(number),
    "--json",
    "number,title,url,body,labels",
  ]);
  if (result.status !== 0) return null;
  try {
    const issue = JSON.parse(result.stdout);
    return {
      number: String(issue.number ?? number),
      title: issue.title ?? "",
      body: issue.body ?? "",
      url: issue.url ?? issueUrlFromNumber(number),
      labels: labelsFrom(issue.labels ?? []),
    };
  } catch {
    return null;
  }
}

const eventIssue = await loadEventIssue(args.eventJson);
const cliNumber = args.githubIssueNumber || args.githubIssue.match(/\/issues\/(\d+)/)?.[1] || "";
const ghIssue = eventIssue ?? loadGhIssue(cliNumber);
const issue = {
  number: args.githubIssueNumber || ghIssue?.number || cliNumber,
  title: args.githubIssueTitle || ghIssue?.title || "MineLink agent task",
  body: args.githubIssueBody || ghIssue?.body || "",
  url: args.githubIssue || ghIssue?.url || issueUrlFromNumber(cliNumber),
  labels: labelsFrom(args.githubIssueLabels || ghIssue?.labels || []),
};

const labels = issue.labels;
const taskId = issue.number ? `gh-${issue.number}` : args.linearIssue ? args.linearIssue.toLowerCase() : "manual";
const branch = args.branch || (issue.number ? `codex/gh-${issue.number}-${slug(issue.title)}` : `codex/${slug(taskId)}`);
const prTitle = args.prTitle || issue.title.replace(/^\[agent-task\]\s*/i, "").trim() || `Advance ${taskId}`;
const acceptanceGate = parseAcceptanceGate(issue.body);
const linearIssue = parseLinearIssue(issue.body);
const validationScope = inferValidationScope(issue.body, labels);
const scenarios = inferScenarios(issue.body, validationScope);

const requiredSections = [
  ["Task"],
  ["Scope"],
  ["Forbidden", "Forbidden changes"],
  ["Validation", "Required validation"],
  ["Evidence", "Required evidence"],
  ["Acceptance video required"],
  ["Remaining gaps"],
];

const failures = [];
if (!issue.url && args.source === "github") failures.push("No GitHub issue URL or issue number was supplied.");
if (!labels.includes("agent-ready")) failures.push("GitHub issue is missing the `agent-ready` label.");
if (!labels.includes("agent:ona")) failures.push("GitHub issue is missing the `agent:ona` label.");
if (labels.includes("blocked") && !allowBlocked) failures.push("GitHub issue is labeled `blocked`; rerun with --allow-blocked only for explicit blocker diagnostics.");
for (const names of requiredSections) {
  if (!parseSection(issue.body, names)) {
    failures.push(`Issue body is missing required section: ${names.join(" or ")}`);
  }
}
if (!args.onaAutomation) failures.push("No Ona automation id was supplied.");
if (!args.onaProject) failures.push("No Ona project id was supplied.");

let dispatchStatus = failures.length > 0 ? "blocked" : "passed";
let onaStatus = "missing";
let onaExecution = "";
let commandOutput = "";
let commandError = "";
let exitCode = failures.length > 0 ? 1 : 0;

if (failures.length === 0) {
  const command = [
    "ai",
    "automation",
    "start",
    args.onaAutomation,
    "--project",
    args.onaProject,
    "--param",
    `task_id=${taskId}`,
    "--param",
    `linear_issue=${linearIssue}`,
    "--param",
    `github_issue=${issue.url || "none"}`,
    "--param",
    `ona_automation=${args.onaAutomation}`,
    "--param",
    `ona_project=${args.onaProject}`,
    "--param",
    `branch=${branch}`,
    "--param",
    `pr_title=${prTitle}`,
    "--param",
    `acceptance_gate=${acceptanceGate}`,
    "--param",
    `validation_scope=${validationScope}`,
    "--param",
    `scenarios=${scenarios}`,
  ];
  if (dryRun) {
    onaStatus = "partial";
    commandOutput = `dry-run: ona ${command.join(" ")}`;
  } else {
    const result = run("ona", command);
    commandOutput = sanitizeOutput(result.stdout);
    commandError = sanitizeOutput(result.stderr);
    const combined = `${result.stdout}\n${result.stderr}`;
    onaExecution = combined.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? "";
    if (result.status === 0) {
      onaStatus = onaExecution ? "partial" : "passed";
    } else {
      onaStatus = "blocked";
      dispatchStatus = "blocked";
      exitCode = requireOna ? result.status ?? 1 : 0;
      const onaFailure = commandError.includes("map.max_pairs")
        ? "Ona automation start failed because the parameter map exceeded Ona's 10-entry limit."
        : "Ona automation start failed. Check ONA_TOKEN/Ona CLI authentication and project permissions.";
      failures.push(onaFailure);
    }
  }
}

const chainArgs = [
  "scripts/dev/report-agent-factory-chain.mjs",
  "--task-id",
  taskId,
  "--github-issue",
  issue.url || "none",
  "--linear-issue",
  linearIssue,
  "--issue-contract-status",
  failures.some((failure) => failure.startsWith("Issue body") || failure.includes("label")) ? "blocked" : "passed",
  "--github-dispatcher-status",
  dispatchStatus,
  "--ona-project",
  args.onaProject,
  "--ona-automation",
  args.onaAutomation,
  "--ona-automation-status",
  onaStatus,
  "--ona-automation-execution",
  onaExecution,
  "--branch",
  branch,
  "--acceptance-gate",
  acceptanceGate,
  "--output",
  args.chainOutput,
  "--json-output",
  args.chainJsonOutput,
];
if (failures.length > 0) {
  chainArgs.push("--blocker", failures.join(" "));
}
run("node", chainArgs);

await fs.mkdir(path.dirname(args.output), { recursive: true });
const lines = [
  "# MineLink Agent Factory Dispatch",
  "",
  `- Source: \`${args.source}\``,
  `- Task id: \`${taskId}\``,
  `- GitHub issue: \`${issue.url || "none"}\``,
  `- Linear issue: \`${linearIssue}\``,
  `- Labels: \`${labels.join(", ") || "none"}\``,
  `- Acceptance gate: \`${acceptanceGate}\``,
  `- Branch: \`${branch}\``,
  `- PR title: \`${prTitle}\``,
  `- Validation scope: \`${validationScope}\``,
  `- Scenarios: \`${scenarios}\``,
  `- Ona automation: \`${args.onaAutomation || "none"}\``,
  `- Ona project: \`${args.onaProject || "none"}\``,
  `- Ona execution: \`${onaExecution || "none"}\``,
  `- Result: \`${failures.length === 0 ? "queued" : "blocked"}\``,
  "",
  "## Failures",
  "",
  ...(failures.length === 0 ? ["- none"] : failures.map((failure) => `- ${failure}`)),
  "",
  "## Ona Output",
  "",
  commandOutput ? ["```text", commandOutput, "```"].join("\n") : "- none",
  "",
  "## Ona Error",
  "",
  commandError ? ["```text", commandError, "```"].join("\n") : "- none",
  "",
  "## Chain Report",
  "",
  `- \`${args.chainOutput}\``,
  `- \`${args.chainJsonOutput}\``,
  "",
  "## Boundary",
  "",
  "- This dispatch only queues the downstream flow. Ona Platform Codex implementation and verifier sessions still need their own evidence.",
  "",
];
await fs.writeFile(args.output, lines.join("\n"), "utf8");

if (comment && issue.number) {
  const commentBody = [
    "MineLink agent-factory dispatcher result:",
    "",
    `- Result: \`${failures.length === 0 ? "queued" : "blocked"}\``,
    `- Ona automation: \`${args.onaAutomation || "none"}\``,
    `- Ona execution: \`${onaExecution || "none"}\``,
    `- Branch: \`${branch}\``,
    `- Chain report: \`${args.chainOutput}\``,
    "",
    failures.length === 0
      ? "Next blocking edge is expected to be Ona Platform Codex implementation session evidence unless the platform exposes an accepted programmatic Codex launch."
      : `Failures: ${failures.join("; ")}`,
  ].join("\n");
  const commentResult = run("gh", ["issue", "comment", issue.number, "--body", commentBody]);
  if (commentResult.status !== 0) {
    console.error(sanitizeOutput(commentResult.stderr || commentResult.stdout));
  }
}

console.log(`Agent factory dispatch wrote ${args.output}`);
process.exit(exitCode);
