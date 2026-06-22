#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const defaults = {
  repository: process.env.GITHUB_REPOSITORY ?? "",
  githubIssue: process.env.MINELINK_GITHUB_ISSUE ?? "",
  prUrl: process.env.MINELINK_AGENT_FACTORY_PR_URL ?? process.env.MINELINK_PR_URL ?? "",
  taskId: process.env.MINELINK_TASK_ID ?? "manual",
  branch: process.env.MINELINK_BRANCH ?? "",
  commit: process.env.MINELINK_COMMIT ?? "",
  ciUrl: process.env.MINELINK_CI_URL ?? "",
  chainReport: ".minelink-dev/reports/agent-factory-chain.md",
  ciReport: ".minelink-dev/reports/agent-factory-pr-ci.md",
  acceptanceSummary: ".minelink-dev/reports/artifacts/acceptance-summary.md",
  acceptanceMp4: ".minelink-dev/reports/artifacts/acceptance.mp4",
  videoReview: ".minelink-dev/reports/artifacts/video-review.md",
  videoReleaseGate: ".minelink-dev/reports/artifacts/video-release-gate.md",
  output: ".minelink-dev/reports/github-status.md",
  jsonOutput: ".minelink-dev/reports/github-status.json",
};

const args = { ...defaults };
let requireUpdate = false;
let dryRun = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repository") args.repository = readValue();
  else if (arg === "--github-issue") args.githubIssue = readValue();
  else if (arg === "--pr-url") args.prUrl = readValue();
  else if (arg === "--task-id") args.taskId = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--commit") args.commit = readValue();
  else if (arg === "--ci-url") args.ciUrl = readValue();
  else if (arg === "--chain-report") args.chainReport = readValue();
  else if (arg === "--ci-report") args.ciReport = readValue();
  else if (arg === "--acceptance-summary") args.acceptanceSummary = readValue();
  else if (arg === "--acceptance-mp4") args.acceptanceMp4 = readValue();
  else if (arg === "--video-review") args.videoReview = readValue();
  else if (arg === "--video-release-gate") args.videoReleaseGate = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--require-update") requireUpdate = true;
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/sync-github-status.mjs [--github-issue URL|N] [--pr-url URL]

Writes the final MineLink agent-factory evidence summary back to GitHub as an
issue or PR comment, then records a secret-free report for the chain tracker.`);
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

function compact(text) {
  return String(text ?? "")
    .replace(/(github_pat_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(ghp_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function parseTarget(value, type) {
  const text = String(value ?? "").trim();
  if (!hasValue(text)) return null;
  const urlMatch = text.match(/github\.com\/([^/\s]+\/[^/\s]+)\/(issues|pull)\/(\d+)/i);
  if (urlMatch) {
    return {
      repository: urlMatch[1],
      number: urlMatch[3],
      type: urlMatch[2] === "pull" ? "pr" : "issue",
      source: text,
    };
  }
  if (/^\d+$/.test(text) && hasValue(args.repository)) {
    return {
      repository: args.repository,
      number: text,
      type,
      source: text,
    };
  }
  return null;
}

async function fileSize(file) {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return 0;
  }
}

function buildBody() {
  return [
    "MineLink agent-factory final status:",
    "",
    `- Task id: \`${args.taskId || "manual"}\``,
    `- Branch: \`${args.branch || "none"}\``,
    `- Commit: \`${args.commit || "none"}\``,
    `- PR: ${args.prUrl || "none"}`,
    `- CI: ${args.ciUrl || "none"}`,
    `- Chain report: \`${args.chainReport}\``,
    `- CI report: \`${args.ciReport}\``,
    `- Acceptance summary: \`${args.acceptanceSummary}\``,
    `- Acceptance MP4: \`${args.acceptanceMp4}\``,
    `- Dedicated Codex video review: \`${args.videoReview}\``,
    `- Video release gate: \`${args.videoReleaseGate}\``,
    "",
    "Boundary: this is automation-chain evidence only. It does not upgrade MineLink product acceptance gates or prove full product completion.",
  ].join("\n");
}

function runGh(commandArgs) {
  return spawnSync("gh", commandArgs, { encoding: "utf8", stdio: "pipe" });
}

const issueTarget = parseTarget(args.githubIssue, "issue");
const prTarget = parseTarget(args.prUrl, "pr");
const target = issueTarget ?? prTarget;
const report = {
  result: "skipped",
  target: target
    ? {
        repository: target.repository,
        number: target.number,
        type: target.type,
        source: target.source,
      }
    : null,
  taskId: args.taskId,
  branch: args.branch,
  commit: args.commit,
  prUrl: args.prUrl,
  ciUrl: args.ciUrl,
  commentUrl: "",
  dryRun,
  operations: [],
  failures: [],
  evidenceSizes: {
    chainReport: await fileSize(args.chainReport),
    ciReport: await fileSize(args.ciReport),
    acceptanceSummary: await fileSize(args.acceptanceSummary),
    acceptanceMp4: await fileSize(args.acceptanceMp4),
    videoReview: await fileSize(args.videoReview),
    videoReleaseGate: await fileSize(args.videoReleaseGate),
  },
};

if (!target) {
  report.operations.push("skipped because no GitHub issue or PR target was supplied");
  if (requireUpdate) {
    report.result = "failed";
    report.failures.push("No GitHub issue or PR target was supplied.");
  }
} else if (dryRun) {
  report.result = "passed";
  report.operations.push(
    `dry-run would create comment on ${target.repository}#${target.number}`,
  );
  report.commentUrl = `dry-run:${target.repository}#${target.number}`;
} else {
  const body = buildBody();
  const result = runGh([
    "api",
    `repos/${target.repository}/issues/${target.number}/comments`,
    "--method",
    "POST",
    "--field",
    `body=${body}`,
    "--jq",
    ".html_url",
  ]);
  if (result.status === 0 && hasValue(result.stdout)) {
    report.result = "passed";
    report.commentUrl = result.stdout.trim();
    report.operations.push(`created GitHub comment ${report.commentUrl}`);
  } else {
    report.result = "failed";
    report.failures.push(`GitHub comment create failed: ${compact(result.stderr || result.stdout)}`);
  }
}

if (report.result === "skipped" && report.failures.length === 0) {
  report.result = "skipped";
}

const lines = [
  "# MineLink GitHub Status Sync",
  "",
  `- Result: \`${report.result}\``,
  `- Target: \`${target ? `${target.repository}#${target.number}` : "none"}\``,
  `- Target type: \`${target?.type ?? "none"}\``,
  `- Comment URL: ${report.commentUrl || "none"}`,
  `- Task id: \`${args.taskId || "manual"}\``,
  `- Branch: \`${args.branch || "none"}\``,
  `- Commit: \`${args.commit || "none"}\``,
  `- PR: ${args.prUrl || "none"}`,
  `- CI: ${args.ciUrl || "none"}`,
  "",
  "## Operations",
  "",
  ...(report.operations.length > 0 ? report.operations.map((op) => `- ${op}`) : ["- none"]),
  "",
  "## Failures",
  "",
  ...(report.failures.length > 0 ? report.failures.map((failure) => `- ${failure}`) : ["- none"]),
  "",
  "## Boundary",
  "",
  "- This report proves GitHub status writeback only. It is not MineLink product acceptance.",
  "",
];

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, lines.join("\n"), "utf8");
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (report.failures.length > 0 || report.result === "failed") {
  console.error(`GitHub status sync failed; wrote ${args.output}`);
  process.exit(1);
}

console.log(`GitHub status sync wrote ${args.output}`);
