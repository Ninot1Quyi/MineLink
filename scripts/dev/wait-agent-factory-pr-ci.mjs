#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const defaults = {
  repo: process.env.GITHUB_REPOSITORY ?? "",
  prUrl: process.env.MINELINK_PR_URL ?? "",
  waitSeconds: Number(process.env.MINELINK_PR_CI_WAIT_SECONDS ?? 900),
  pollSeconds: Number(process.env.MINELINK_PR_CI_POLL_SECONDS ?? 15),
  output: ".minelink-dev/reports/agent-factory-pr-ci.md",
  jsonOutput: ".minelink-dev/reports/agent-factory-pr-ci.json",
};

const args = { ...defaults };

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repo") args.repo = readValue();
  else if (arg === "--pr-url") args.prUrl = readValue();
  else if (arg === "--wait-seconds") args.waitSeconds = Number(readValue());
  else if (arg === "--poll-seconds") args.pollSeconds = Number(readValue());
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/wait-agent-factory-pr-ci.mjs --repo owner/repo --pr-url <url>

Waits for the PR check rollup created by an agent-factory canary PR, writes a
secret-free report, and fails if any check fails or the wait window expires.`);
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

function inferRepo() {
  if (hasValue(args.repo)) return args.repo;
  const match = String(args.prUrl).match(/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/i);
  return match?.[1] ?? "";
}

function prNumber() {
  const match = String(args.prUrl).match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match?.[1] ?? "";
}

function runGh(commandArgs) {
  return spawnSync("gh", commandArgs, {
    encoding: "utf8",
    stdio: "pipe",
  });
}

function compact(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
}

function parseJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function normalizeCheck(item) {
  const type = item?.__typename ?? "Unknown";
  const name = item?.name || item?.context || "unknown";
  const detailsUrl = item?.detailsUrl || item?.targetUrl || "";

  if (type === "CheckRun") {
    return {
      type,
      name,
      status: String(item.status ?? "").toLowerCase(),
      conclusion: String(item.conclusion ?? "").toLowerCase(),
      detailsUrl,
      completed: String(item.status ?? "").toLowerCase() === "completed",
      passed: ["success", "skipped", "neutral"].includes(String(item.conclusion ?? "").toLowerCase()),
    };
  }

  if (type === "StatusContext") {
    const state = String(item.state ?? "").toLowerCase();
    return {
      type,
      name,
      status: state,
      conclusion: state,
      detailsUrl,
      completed: state !== "pending",
      passed: state === "success",
    };
  }

  return {
    type,
    name,
    status: "unknown",
    conclusion: "unknown",
    detailsUrl,
    completed: false,
    passed: false,
  };
}

function summarizeChecks(checks) {
  const normalized = checks.map(normalizeCheck);
  const pending = normalized.filter((check) => !check.completed);
  const failed = normalized.filter((check) => check.completed && !check.passed);
  const passed = normalized.filter((check) => check.completed && check.passed);
  let result = "pending";
  if (normalized.length === 0) result = "missing";
  else if (failed.length > 0) result = "failed";
  else if (pending.length === 0) result = "passed";
  return { result, checks: normalized, passed, pending, failed };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const repo = inferRepo();
const number = prNumber();
const failures = [];

if (!hasValue(repo)) failures.push("--repo or a GitHub PR URL with owner/repo is required.");
if (!hasValue(number)) failures.push("--pr-url must point to a GitHub pull request.");
if (!Number.isFinite(args.waitSeconds) || args.waitSeconds < 0) failures.push("--wait-seconds must be a non-negative number.");
if (!Number.isFinite(args.pollSeconds) || args.pollSeconds <= 0) failures.push("--poll-seconds must be a positive number.");

let report = {
  repo: repo || "unknown",
  prUrl: args.prUrl || "none",
  checksUrl: hasValue(repo) && hasValue(number) ? `https://github.com/${repo}/pull/${number}/checks` : "",
  generatedAt: new Date().toISOString(),
  result: failures.length > 0 ? "failed" : "pending",
  headSha: "",
  checks: [],
  failures,
  boundary:
    "This report proves GitHub check rollup completion for an agent-factory canary PR only; it is not MineLink product acceptance.",
};

const deadline = Date.now() + args.waitSeconds * 1000;
let lastGhOutput = "";

while (failures.length === 0) {
  const view = runGh([
    "pr",
    "view",
    number,
    "--repo",
    repo,
    "--json",
    "headRefOid,statusCheckRollup,url",
  ]);
  if (view.status !== 0) {
    lastGhOutput = compact(view.stderr || view.stdout);
    failures.push(`GitHub PR check query failed: ${lastGhOutput}`);
    report.result = "failed";
    break;
  }

  const body = parseJson(view);
  const summary = summarizeChecks(body?.statusCheckRollup ?? []);
  report = {
    ...report,
    generatedAt: new Date().toISOString(),
    prUrl: body?.url || args.prUrl,
    headSha: body?.headRefOid ?? "",
    result: summary.result,
    checks: summary.checks,
    failures: summary.failed.map((check) => `${check.name}: ${check.conclusion || check.status}`),
  };

  if (summary.result === "passed" || summary.result === "failed") break;
  if (Date.now() >= deadline || args.waitSeconds === 0) {
    report.result = "timeout";
    report.failures = [
      summary.result === "missing"
        ? "No PR checks were reported before the wait window expired."
        : `Timed out waiting for ${summary.pending.length} pending PR checks.`,
    ];
    break;
  }
  await sleep(args.pollSeconds * 1000);
}

if (failures.length > 0) report.failures = failures;

function escapeMd(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

const lines = [
  "# MineLink Agent Factory PR CI",
  "",
  `- Repository: \`${escapeMd(report.repo)}\``,
  `- PR: ${report.prUrl || "none"}`,
  `- Checks: ${report.checksUrl || "none"}`,
  `- Head SHA: \`${report.headSha || "none"}\``,
  `- Generated: \`${report.generatedAt}\``,
  `- Result: \`${report.result}\``,
  "- Boundary: `GitHub PR check rollup only; not product acceptance`",
  "",
  "## Checks",
  "",
  "| Check | Type | Status | Conclusion | URL |",
  "| --- | --- | --- | --- | --- |",
  ...(report.checks.length > 0
    ? report.checks.map(
        (check) =>
          `| ${escapeMd(check.name)} | ${escapeMd(check.type)} | \`${escapeMd(check.status)}\` | \`${escapeMd(check.conclusion || "none")}\` | ${escapeMd(check.detailsUrl || "none")} |`,
      )
    : ["| none | none | `missing` | `missing` | none |"]),
  "",
  "## Failures",
  "",
  ...(report.failures.length > 0 ? report.failures.map((failure) => `- ${escapeMd(failure)}`) : ["- none"]),
  "",
];

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, lines.join("\n"), "utf8");
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (report.result !== "passed") {
  console.error(`Agent factory PR CI result is ${report.result}; wrote ${args.output}`);
  process.exit(1);
}

console.log(`Agent factory PR CI passed: ${report.checksUrl}`);
