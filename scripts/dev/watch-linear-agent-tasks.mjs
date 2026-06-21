#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const endpoint = "https://api.linear.app/graphql";

const args = {
  issue: process.env.MINELINK_LINEAR_ISSUE ?? "",
  project: process.env.MINELINK_LINEAR_PROJECT ?? "MineLink",
  limit: Number(process.env.MINELINK_LINEAR_WATCH_LIMIT ?? 100),
  maxStarts: Number(process.env.MINELINK_LINEAR_MAX_STARTS ?? 1),
  onaAutomation: process.env.MINELINK_ONA_AUTOMATION_ID ?? "019ee9f6-9adb-7c93-aaa6-c26337d2278b",
  onaProject: process.env.MINELINK_ONA_PROJECT_ID ?? "019ee8ed-9e1b-7cd8-9b1b-af0c8ee27edb",
  output: ".minelink-dev/reports/linear-agent-task-watch.md",
};

let dryRun = false;
let requireKey = false;
let requireOna = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--issue") args.issue = readValue();
  else if (arg === "--project") args.project = readValue();
  else if (arg === "--limit") args.limit = Number(readValue());
  else if (arg === "--max-starts") args.maxStarts = Number(readValue());
  else if (arg === "--ona-automation") args.onaAutomation = readValue();
  else if (arg === "--ona-project") args.onaProject = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "--require-key") requireKey = true;
  else if (arg === "--require-ona") requireOna = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/watch-linear-agent-tasks.mjs [options]

Polls Linear for MineLink agent-ready tasks and dispatches at most one task to
the shared Ona automation. This is the fallback source when GitHub issue
webhooks are not enough or Ona repository webhooks are unavailable.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!Number.isFinite(args.limit) || args.limit < 1 || args.limit > 250) {
  console.error("--limit must be between 1 and 250");
  process.exit(2);
}
if (!Number.isFinite(args.maxStarts) || args.maxStarts < 0 || args.maxStarts > 10) {
  console.error("--max-starts must be between 0 and 10");
  process.exit(2);
}

function sanitize(text) {
  return String(text ?? "")
    .replace(/(lin_api_)[A-Za-z0-9]+/g, "$1[redacted]")
    .replace(/(github_pat_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(ghp_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .slice(0, 4000)
    .trim();
}

async function writeReport(report) {
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  const lines = [
    "# MineLink Linear Agent Task Watch",
    "",
    `- Project filter: \`${args.project || "none"}\``,
    `- Issue filter: \`${args.issue || "none"}\``,
    `- LINEAR_API_KEY present: \`${report.keyPresent ? "yes" : "no"}\``,
    `- Candidate count: \`${report.candidates.length}\``,
    `- Dispatched count: \`${report.dispatched.length}\``,
    `- Result: \`${report.result}\``,
    "",
    "## Candidates",
    "",
    ...(report.candidates.length === 0
      ? ["- none"]
      : report.candidates.map(
          (candidate) =>
            `- \`${candidate.identifier}\` ${candidate.url} labels=\`${candidate.labels.join(", ") || "none"}\` github=\`${candidate.githubIssue || "none"}\``,
        )),
    "",
    "## Dispatches",
    "",
    ...(report.dispatched.length === 0
      ? ["- none"]
      : report.dispatched.map(
          (dispatch) =>
            `- \`${dispatch.identifier}\` status=\`${dispatch.status}\` github=\`${dispatch.githubIssue || "none"}\` report=\`${dispatch.report}\``,
        )),
    "",
    "## Errors",
    "",
    ...(report.errors.length === 0 ? ["- none"] : report.errors.map((error) => `- ${error}`)),
    "",
    "## Boundary",
    "",
    "- This watcher is a polling/CI entrypoint. It is not proof that a native Linear webhook to Ona is enabled.",
    "",
  ];
  await fs.writeFile(args.output, lines.join("\n"), "utf8");
}

const apiKey = process.env.LINEAR_API_KEY ?? "";
const report = {
  keyPresent: apiKey.length > 0,
  candidates: [],
  dispatched: [],
  errors: [],
  result: "skipped",
};

async function graphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Linear returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`Linear HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`Linear GraphQL error: ${payload.errors.map((error) => error.message).join("; ")}`);
  }
  return payload.data;
}

function labelNames(issue) {
  return issue.labels?.nodes?.map((label) => label.name).filter(Boolean) ?? [];
}

function findGithubIssue(issue) {
  const text = [
    issue.description ?? "",
    ...(issue.attachments?.nodes ?? []).map((attachment) => `${attachment.title ?? ""} ${attachment.url ?? ""}`),
  ].join("\n");
  return text.match(/https:\/\/github\.com\/Ninot1Quyi\/MineLink\/issues\/\d+/i)?.[0] ?? "";
}

function isOpenState(issue) {
  const type = String(issue.state?.type ?? "").toLowerCase();
  return !["completed", "canceled"].includes(type);
}

function isCandidate(issue) {
  if (args.issue && issue.identifier?.toUpperCase() !== args.issue.toUpperCase()) return false;
  if (!isOpenState(issue)) return false;
  const labels = labelNames(issue);
  const projectMatches = !args.project || issue.project?.name === args.project;
  const hasRequiredLabels = labels.includes("agent-ready") && labels.includes("agent:ona");
  const textMentions = `${issue.title ?? ""}\n${issue.description ?? ""}`;
  const mentionsRepo = /Ninot1Quyi\/MineLink|github\.com\/Ninot1Quyi\/MineLink/i.test(textMentions);
  return (projectMatches || mentionsRepo || Boolean(findGithubIssue(issue))) && hasRequiredLabels;
}

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, { encoding: "utf8", stdio: "pipe" });
}

try {
  if (!apiKey) {
    report.result = "blocked";
    report.errors.push("LINEAR_API_KEY is missing; configure it in GitHub/Ona secrets before enabling Linear watch dispatch.");
    await writeReport(report);
    process.exit(requireKey ? 1 : 0);
  }

  const data = await graphql(
    `query MineLinkAgentTasks($first: Int!) {
      issues(first: $first, orderBy: updatedAt) {
        nodes {
          id
          identifier
          title
          url
          description
          state { name type }
          project { name }
          labels { nodes { name } }
          attachments { nodes { title url } }
        }
      }
    }`,
    { first: args.limit },
  );

  const issues = data.issues?.nodes ?? [];
  const candidates = issues.filter(isCandidate).slice(0, args.maxStarts);
  report.candidates = candidates.map((issue) => ({
    identifier: issue.identifier,
    url: issue.url,
    labels: labelNames(issue),
    githubIssue: findGithubIssue(issue),
  }));

  for (const issue of candidates) {
    const githubIssue = findGithubIssue(issue);
    const commandArgs = [
      "scripts/dev/dispatch-agent-factory.mjs",
      "--source",
      "linear",
      "--linear-issue",
      issue.identifier,
      "--github-issue",
      githubIssue || "none",
      "--github-issue-labels",
      "agent-ready,agent:ona",
      "--github-issue-title",
      issue.title ?? `Linear ${issue.identifier}`,
      "--github-issue-body",
      issue.description ?? "",
      "--ona-automation",
      args.onaAutomation,
      "--ona-project",
      args.onaProject,
      "--output",
      `.minelink-dev/reports/agent-factory-dispatch-${issue.identifier}.md`,
    ];
    if (dryRun) commandArgs.push("--dry-run");
    if (requireOna) commandArgs.push("--require-ona");
    const result = run("node", commandArgs);
    const dispatchReport = `.minelink-dev/reports/agent-factory-dispatch-${issue.identifier}.md`;
    report.dispatched.push({
      identifier: issue.identifier,
      githubIssue,
      status: result.status === 0 ? "queued_or_dry_run" : "blocked",
      report: dispatchReport,
    });
    if (result.status !== 0) {
      report.errors.push(
        `Dispatcher failed for ${issue.identifier}: ${sanitize(result.stderr || result.stdout)}`,
      );
      if (requireOna) break;
    }
  }

  report.result = report.errors.length === 0 ? "completed" : "blocked";
  await writeReport(report);
  console.log(`Linear watcher wrote ${args.output}`);
  process.exit(report.errors.length > 0 && requireOna ? 1 : 0);
} catch (error) {
  report.result = "blocked";
  report.errors.push(sanitize(error instanceof Error ? error.message : error));
  await writeReport(report);
  console.error(`Linear watcher failed; wrote ${args.output}`);
  process.exit(1);
}
