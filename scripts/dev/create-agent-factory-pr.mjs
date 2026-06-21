#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const defaults = {
  branch: process.env.MINELINK_BRANCH ?? "",
  base: process.env.MINELINK_BASE_BRANCH ?? "codex/minelink-mvp-engineering",
  title: process.env.MINELINK_PR_TITLE ?? "Advance MineLink agent task",
  taskId: process.env.MINELINK_TASK_ID ?? "manual",
  githubIssue: process.env.MINELINK_GITHUB_ISSUE ?? "",
  linearIssue: process.env.MINELINK_LINEAR_ISSUE ?? "",
  acceptanceGate: process.env.MINELINK_ACCEPTANCE_GATE ?? "unspecified",
  validationScope: process.env.MINELINK_VALIDATION_SCOPE ?? "unspecified",
  output: ".minelink-dev/reports/agent-factory-pr.md",
  jsonOutput: ".minelink-dev/reports/agent-factory-pr.json",
  bodyOutput: ".minelink-dev/reports/agent-factory-pr-body.md",
};

const args = { ...defaults };

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--branch") args.branch = readValue();
  else if (arg === "--base") args.base = readValue();
  else if (arg === "--title") args.title = readValue();
  else if (arg === "--task-id") args.taskId = readValue();
  else if (arg === "--github-issue") args.githubIssue = readValue();
  else if (arg === "--linear-issue") args.linearIssue = readValue();
  else if (arg === "--acceptance-gate") args.acceptanceGate = readValue();
  else if (arg === "--validation-scope") args.validationScope = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--body-output") args.bodyOutput = readValue();
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/create-agent-factory-pr.mjs --branch <branch> --title <title>

Creates or updates the MineLink agent-factory draft PR after the Platform Codex
implementation and video-verifier evidence gates have already passed.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

function hasValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.length > 0 && !["none", "null", "undefined", "-"].includes(normalized);
}

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, { encoding: "utf8" });
}

function compactOutput(result) {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function buildBody() {
  return [
    "## Linked Work",
    "",
    `- Linear: ${args.linearIssue || "none"}`,
    `- GitHub: ${args.githubIssue || "none"}`,
    "",
    "## MineLink Delivery Evidence",
    "",
    `- Agent task id: ${args.taskId}`,
    `- Acceptance gate: ${args.acceptanceGate}`,
    `- Validation scope: ${args.validationScope}`,
    "- Platform Codex implementation readback: `.minelink-dev/reports/ona-codex-implementation-session.md`",
    "- Platform Codex video verifier readback: `.minelink-dev/reports/ona-codex-video-verifier-session.md`",
    "- Platform Codex evidence gate: `.minelink-dev/reports/platform-codex-evidence.md`",
    "- Agent verifier: `.minelink-dev/reports/agent-task-summary.md`",
    "- Evidence summary: `.minelink-dev/reports/ci-evidence-summary.md`",
    "- Acceptance video summary: `.minelink-dev/reports/artifacts/acceptance-summary.md`",
    "- Acceptance video: `.minelink-dev/reports/artifacts/acceptance.mp4`",
    "- Video review request: `.minelink-dev/reports/artifacts/video-review-request.md`",
    "- Dedicated Codex video review: `.minelink-dev/reports/artifacts/video-review.md`",
    "- Video release gate: `.minelink-dev/reports/artifacts/video-release-gate.md`",
    "",
    "This PR must still be reviewed against `docs/minelink-acceptance.md`.",
    "Mock, replay, smoke, or short-soak evidence does not imply full product completion.",
    "",
  ].join("\n");
}

const failures = [];
let prUrl = "";
let action = "none";
let ghOutput = "";

if (!hasValue(args.branch)) failures.push("--branch is required");
if (!hasValue(args.base)) failures.push("--base is required");
if (!hasValue(args.title)) failures.push("--title is required");

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.bodyOutput, buildBody(), "utf8");

if (failures.length === 0) {
  const auth = run("gh", ["auth", "status"]);
  if (auth.status !== 0) {
    failures.push("GitHub CLI is not authenticated in this environment.");
    ghOutput = compactOutput(auth);
  }
}

if (failures.length === 0) {
  const existing = run("gh", [
    "pr",
    "list",
    "--head",
    args.branch,
    "--state",
    "all",
    "--json",
    "url",
    "--jq",
    ".[0].url // empty",
  ]);
  if (existing.status !== 0) {
    failures.push("Failed to query existing pull requests.");
    ghOutput = compactOutput(existing);
  } else {
    prUrl = existing.stdout.trim();
  }
}

if (failures.length === 0 && prUrl) {
  const edit = run("gh", ["pr", "edit", prUrl, "--title", args.title, "--body-file", args.bodyOutput]);
  if (edit.status !== 0) {
    failures.push("Failed to update existing pull request.");
    ghOutput = compactOutput(edit);
  } else {
    action = "updated";
    ghOutput = compactOutput(edit);
  }
}

if (failures.length === 0 && !prUrl) {
  const create = run("gh", [
    "pr",
    "create",
    "--draft",
    "--base",
    args.base,
    "--head",
    args.branch,
    "--title",
    args.title,
    "--body-file",
    args.bodyOutput,
  ]);
  if (create.status !== 0) {
    failures.push("Failed to create pull request.");
    ghOutput = compactOutput(create);
  } else {
    action = "created";
    prUrl = create.stdout.trim().split(/\s+/).find((value) => /^https?:\/\//.test(value)) ?? create.stdout.trim();
    ghOutput = compactOutput(create);
  }
}

const report = {
  result: failures.length === 0 ? "passed" : "failed",
  action,
  prUrl,
  branch: args.branch,
  base: args.base,
  title: args.title,
  failures,
  ghOutput: ghOutput ? "[redacted command output present in markdown report]" : "",
};

const lines = [
  "# MineLink Agent Factory PR",
  "",
  `Result: ${report.result}`,
  `Action: ${action}`,
  `Branch: ${args.branch || "none"}`,
  `Base: ${args.base || "none"}`,
  `PR URL: ${prUrl || "none"}`,
  "",
  `- Result: \`${report.result}\``,
  `- Action: \`${action}\``,
  `- Branch: \`${args.branch || "none"}\``,
  `- Base: \`${args.base || "none"}\``,
  `- PR URL: ${prUrl || "none"}`,
  "",
  "## Failures",
  "",
  ...(failures.length === 0 ? ["- none"] : failures.map((failure) => `- ${failure}`)),
  "",
  "## GitHub CLI Output",
  "",
  ghOutput ? ["```text", ghOutput, "```"].join("\n") : "- none",
  "",
];

await fs.writeFile(args.output, lines.join("\n"), "utf8");
await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (failures.length > 0) {
  console.error(`Agent factory PR step failed; wrote ${args.output}`);
  process.exit(1);
}

console.log(`Agent factory PR ${action}: ${prUrl}`);
