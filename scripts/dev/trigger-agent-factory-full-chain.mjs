#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const defaults = {
  repository: process.env.GITHUB_REPOSITORY ?? "",
  ref: process.env.GITHUB_REF_NAME ?? "",
  dispatchJson: ".minelink-dev/reports/agent-factory-dispatch.json",
  workflow: "ona-platform-codex-probe.yml",
  mode: process.env.MINELINK_AGENT_FACTORY_WORKFLOW_MODE ?? "full-chain-task",
  taskSuffix: "",
  waitSeconds: process.env.MINELINK_CODEX_WAIT_SECONDS ?? "900",
  environmentWaitSeconds: "600",
  environmentClassId: process.env.MINELINK_ONA_ENVIRONMENT_CLASS_ID ?? "",
  branchWaitSeconds: process.env.MINELINK_BRANCH_WAIT_SECONDS ?? "",
  ciWaitSeconds: "900",
  prBaseBranch: process.env.MINELINK_PR_BASE_BRANCH ?? "codex/minelink-mvp-engineering",
  githubAttachmentPreflight: process.env.MINELINK_GITHUB_ATTACHMENT_PREFLIGHT ?? "deferred",
  validationScope: process.env.MINELINK_VALIDATION_SCOPE ?? "",
  scenarios: process.env.MINELINK_SCENARIOS ?? "",
  output: ".minelink-dev/reports/agent-factory-full-chain-trigger.md",
  jsonOutput: ".minelink-dev/reports/agent-factory-full-chain-trigger.json",
};

const args = { ...defaults };
let dryRun = false;
let requireTrigger = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repository") args.repository = readValue();
  else if (arg === "--ref") args.ref = readValue();
  else if (arg === "--dispatch-json") args.dispatchJson = readValue();
  else if (arg === "--workflow") args.workflow = readValue();
  else if (arg === "--mode") args.mode = readValue();
  else if (arg === "--task-suffix") args.taskSuffix = readValue();
  else if (arg === "--wait-seconds") args.waitSeconds = readValue();
  else if (arg === "--environment-wait-seconds") args.environmentWaitSeconds = readValue();
  else if (arg === "--environment-class-id") args.environmentClassId = readValue();
  else if (arg === "--branch-wait-seconds") args.branchWaitSeconds = readValue();
  else if (arg === "--ci-wait-seconds") args.ciWaitSeconds = readValue();
  else if (arg === "--pr-base-branch") args.prBaseBranch = readValue();
  else if (arg === "--github-attachment-preflight") args.githubAttachmentPreflight = readValue();
  else if (arg === "--validation-scope") args.validationScope = readValue();
  else if (arg === "--scenarios") args.scenarios = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "--require-trigger") requireTrigger = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/trigger-agent-factory-full-chain.mjs --repository owner/repo --ref branch

Reads agent-factory-dispatch.json and starts the full-chain Platform Codex
workflow for that issue task. This bridges GitHub/Linear source dispatch to
the guarded Codex -> video -> PR -> CI -> status path.`);
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

function runGh(commandArgs) {
  return spawnSync("gh", commandArgs, { encoding: "utf8", stdio: "pipe" });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : error}`);
  }
}

function workflowRunUrl(run) {
  return run?.url || (run?.databaseId && hasValue(args.repository)
    ? `https://github.com/${args.repository}/actions/runs/${run.databaseId}`
    : "");
}

const failures = [];
let dispatch = {};
try {
  dispatch = await readJson(args.dispatchJson);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

if (!hasValue(args.repository)) failures.push("--repository or GITHUB_REPOSITORY is required.");
if (!hasValue(args.ref)) failures.push("--ref or GITHUB_REF_NAME is required.");

const baseTaskId = dispatch.taskId || "manual";
const taskId = args.taskSuffix ? `${baseTaskId}-${args.taskSuffix}` : baseTaskId;
const branch = dispatch.branch || `codex/${taskId}`;
const title = dispatch.prTitle || `Advance ${taskId}`;
const githubIssue = dispatch.githubIssue || "none";
const linearIssue = dispatch.linearIssue || "none";
const validationScope = args.validationScope || dispatch.validationScope || dispatch.validation_scope || "docs";
const scenarios = args.scenarios || dispatch.scenarios || "none";
const branchWaitSeconds =
  args.branchWaitSeconds || (validationScope === "neoforge" ? "3600" : "900");
const taskRequirements = dispatch.taskRequirements || [
  `Task id: ${taskId}`,
  `PR title: ${title}`,
  `GitHub issue: ${githubIssue}`,
  `Linear issue: ${linearIssue}`,
  `Validation scope: ${validationScope}`,
  `Scenarios: ${scenarios}`,
  "",
  "## Issue body",
  "",
  dispatch.githubIssueBody || "No issue body was captured by the dispatcher.",
].join("\n");

const workflowArgs = [
  "workflow",
  "run",
  args.workflow,
  "--repo",
  args.repository,
  "--ref",
  args.ref,
  "-f",
  `mode=${args.mode}`,
  "-f",
  `wait_seconds=${args.waitSeconds}`,
  "-f",
  `environment_wait_seconds=${args.environmentWaitSeconds}`,
  "-f",
  `environment_class_id=${args.environmentClassId}`,
  "-f",
  `branch_wait_seconds=${branchWaitSeconds}`,
  "-f",
  `ci_wait_seconds=${args.ciWaitSeconds}`,
  "-f",
  `task_id=${taskId}`,
  "-f",
  `target_branch=${branch}`,
  "-f",
  `github_issue=${githubIssue}`,
  "-f",
  `linear_issue=${linearIssue}`,
  "-f",
  `task_requirements=${taskRequirements}`,
  "-f",
  `validation_scope=${validationScope}`,
  "-f",
  `scenarios=${scenarios}`,
  "-f",
  "create_pr=true",
  "-f",
  `pr_base_branch=${args.prBaseBranch}`,
  "-f",
  `pr_title=${title}`,
  "-f",
  `github_attachment_preflight=${args.githubAttachmentPreflight}`,
];

let ghOutput = "";
let runUrl = "";
let runId = "";
if (failures.length === 0) {
  if (dryRun) {
    ghOutput = `dry-run: gh ${workflowArgs.join(" ")}`;
    runUrl = `dry-run:${args.workflow}:${taskId}`;
  } else {
    const triggerStartedAt = new Date();
    const result = runGh(workflowArgs);
    ghOutput = compact(result.stdout || result.stderr);
    if (result.status !== 0) {
      failures.push(`workflow dispatch failed: ${ghOutput}`);
    } else {
      for (let attempt = 0; attempt < 8 && !runUrl; attempt += 1) {
        if (attempt > 0) await sleep(2000);
        const listed = runGh([
          "run",
          "list",
          "--repo",
          args.repository,
          "--workflow",
          args.workflow,
          "--branch",
          args.ref,
          "--event",
          "workflow_dispatch",
          "--limit",
          "1",
          "--json",
          "databaseId,url,status,conclusion,createdAt",
        ]);
        if (listed.status === 0) {
          try {
            const runs = JSON.parse(listed.stdout) ?? [];
            const run = runs.find((candidate) => {
              const createdAt = Date.parse(candidate?.createdAt ?? "");
              return Number.isFinite(createdAt) && createdAt >= triggerStartedAt.getTime() - 5000;
            }) ?? null;
            runId = run?.databaseId ? String(run.databaseId) : "";
            runUrl = workflowRunUrl(run);
          } catch {
            // The dispatch itself already succeeded; run URL is best-effort.
          }
        }
      }
    }
  }
}

const report = {
  result: failures.length === 0 ? "passed" : "failed",
  workflow: args.workflow,
  mode: args.mode,
  repository: args.repository,
  ref: args.ref,
  taskId,
  branch,
  githubIssue,
  linearIssue,
  validationScope,
  scenarios,
  environmentClassId: args.environmentClassId,
  branchWaitSeconds,
  prTitle: title,
  githubAttachmentPreflight: args.githubAttachmentPreflight,
  runId,
  runUrl,
  dryRun,
  failures,
  ghOutput: ghOutput ? "[redacted command output present in markdown report]" : "",
};

const lines = [
  "# MineLink Agent Factory Full-Chain Trigger",
  "",
  `- Result: \`${report.result}\``,
  `- Workflow: \`${args.workflow}\``,
  `- Mode: \`${args.mode}\``,
  `- Ref: \`${args.ref || "none"}\``,
  `- Task id: \`${taskId}\``,
  `- Branch: \`${branch}\``,
  `- GitHub issue: ${githubIssue}`,
  `- Linear issue: \`${linearIssue}\``,
  `- Validation scope: \`${validationScope}\``,
  `- Scenarios: \`${scenarios}\``,
  `- Environment class id: \`${args.environmentClassId || "default"}\``,
  `- Branch wait seconds: \`${branchWaitSeconds}\``,
  `- PR title: \`${title}\``,
  `- GitHub attachment preflight: \`${args.githubAttachmentPreflight}\``,
  `- Workflow run: ${runUrl || "best-effort-unavailable"}`,
  "",
  "## Failures",
  "",
  ...(failures.length > 0 ? failures.map((failure) => `- ${failure}`) : ["- none"]),
  "",
  "## GitHub CLI Output",
  "",
  ghOutput ? ["```text", ghOutput, "```"].join("\n") : "- none",
  "",
  "## Boundary",
  "",
  "- This report proves the source dispatcher requested the full-chain workflow. The downstream workflow must still produce Platform Codex, video, PR, CI, and status evidence.",
  "",
];

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, lines.join("\n"), "utf8");
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (failures.length > 0 || (requireTrigger && !runUrl)) {
  if (requireTrigger && !runUrl && failures.length === 0) {
    console.error("Full-chain workflow dispatch succeeded, but no run URL was found.");
  } else {
    console.error(`Full-chain workflow trigger failed; wrote ${args.output}`);
  }
  process.exit(1);
}

console.log(`Full-chain workflow trigger wrote ${args.output}`);
