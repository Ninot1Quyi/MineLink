#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const defaults = {
  stage: "",
  taskId: process.env.MINELINK_TASK_ID ?? "manual",
  githubIssue: process.env.MINELINK_GITHUB_ISSUE ?? "none",
  linearIssue: process.env.MINELINK_LINEAR_ISSUE ?? "none",
  onaProject: process.env.MINELINK_ONA_PROJECT ?? "",
  onaAutomation: process.env.MINELINK_ONA_AUTOMATION ?? "",
  branch: process.env.MINELINK_BRANCH ?? "",
  prTitle: process.env.MINELINK_PR_TITLE ?? "",
  acceptanceGate: process.env.MINELINK_ACCEPTANCE_GATE ?? "unspecified",
  validationScope: process.env.MINELINK_VALIDATION_SCOPE ?? "docs",
  scenarios: process.env.MINELINK_SCENARIOS ?? "none",
  outputDir: ".minelink-dev/reports",
};
const videoReviewRequestArtifact = ".minelink-dev/reports/artifacts/video-review-request.md";
const allStages = [
  "initial-report",
  "sync-in-progress",
  "validate",
  "summarize",
  "render-video",
  "prepare-video",
  "check-video-release",
  "sync-in-review",
  "create-pr",
  "final-report",
];
const groupedStages = {
  "implementation-finalize": [
    "initial-report",
    "sync-in-progress",
    "validate",
    "summarize",
    "render-video",
    "prepare-video",
  ],
  "release-finalize": ["check-video-release", "sync-in-review", "create-pr", "final-report"],
  all: allStages,
};

const args = { ...defaults };

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--stage") args.stage = readValue();
  else if (arg === "--task-id") args.taskId = readValue();
  else if (arg === "--github-issue") args.githubIssue = readValue();
  else if (arg === "--linear-issue") args.linearIssue = readValue();
  else if (arg === "--ona-project") args.onaProject = readValue();
  else if (arg === "--ona-automation") args.onaAutomation = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--pr-title") args.prTitle = readValue();
  else if (arg === "--acceptance-gate") args.acceptanceGate = readValue();
  else if (arg === "--validation-scope") args.validationScope = readValue();
  else if (arg === "--scenarios") args.scenarios = readValue();
  else if (arg === "--output-dir") args.outputDir = readValue();
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/run-agent-factory-stage.mjs --stage <stage> [context]

Runs one MineLink Ona finalizer stage. Missing Ona Platform Codex evidence is
recorded as a blocked stage and exits 0 so Ona automation terminates with a
readable report instead of staying in a long-running failed task loop.

Use --stage implementation-finalize to run validation, evidence summary,
acceptance video rendering, and video-review request preparation after the
implementation Platform Codex readback exists.

Use --stage release-finalize to run video release, status sync, PR creation,
and final reporting after both implementation and verifier readbacks exist.

Use --stage all to run every guarded finalizer stage inside one Ona task. This
keeps the evidence gates per stage while avoiding repeated Ona/Codex task
scheduling overhead in manual diagnostics.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

function sanitize(text) {
  return String(text ?? "")
    .replace(/(lin_api_)[A-Za-z0-9]+/g, "$1[redacted]")
    .replace(/(github_pat_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(ghp_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .slice(0, 6000)
    .trim();
}

function selfInvocationArgs(stage) {
  return [
    "scripts/dev/run-agent-factory-stage.mjs",
    "--stage",
    stage,
    "--task-id",
    args.taskId,
    "--github-issue",
    args.githubIssue || "none",
    "--linear-issue",
    args.linearIssue || "none",
    "--ona-project",
    args.onaProject || "",
    "--ona-automation",
    args.onaAutomation || "",
    "--branch",
    args.branch || "",
    "--pr-title",
    args.prTitle || "",
    "--acceptance-gate",
    args.acceptanceGate || "unspecified",
    "--validation-scope",
    args.validationScope || "docs",
    "--scenarios",
    args.scenarios || "none",
    "--output-dir",
    args.outputDir,
  ];
}

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: "pipe",
    env: process.env,
  });
}

function node(script, scriptArgs = []) {
  return run(process.execPath, [script, ...scriptArgs]);
}

function git(argsList) {
  const result = run("git", argsList);
  return result.status === 0 ? result.stdout.trim() : "";
}

function currentCommit() {
  return git(["rev-parse", "--short", "HEAD"]) || process.env.MINELINK_COMMIT || "";
}

function stageReportPath(stage) {
  return path.join(args.outputDir, `agent-factory-stage-${stage}.md`);
}

async function writeStageReport(stage, report) {
  await fs.mkdir(args.outputDir, { recursive: true });
  const lines = [
    `# MineLink Agent Factory Stage: ${stage}`,
    "",
    `- Result: \`${report.result}\``,
    `- Task id: \`${args.taskId}\``,
    `- GitHub issue: \`${args.githubIssue || "none"}\``,
    `- Linear issue: \`${args.linearIssue || "none"}\``,
    `- Branch: \`${args.branch || "none"}\``,
    `- Boundary: \`Ona finalizer stage evidence only; not product acceptance\``,
    "",
    "## Operations",
    "",
    ...(report.operations?.length ? report.operations.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Errors",
    "",
    ...(report.errors?.length ? report.errors.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Output",
    "",
    report.output ? ["```text", report.output, "```"].join("\n") : "- none",
    "",
  ];
  await fs.writeFile(stageReportPath(stage), lines.join("\n"), "utf8");
}

function chainArgs(status, requireVerifier = false) {
  const result = [
    "--task-id",
    args.taskId,
    "--github-issue",
    args.githubIssue || "none",
    "--linear-issue",
    args.linearIssue || "none",
    "--issue-contract-status",
    "passed",
    "--github-dispatcher-status",
    "passed",
    "--ona-project",
    args.onaProject || "none",
    "--ona-automation",
    args.onaAutomation || "none",
    "--ona-automation-status",
    status,
    "--ona-prebuild-status",
    "partial",
    "--branch",
    args.branch || "unknown",
    "--acceptance-gate",
    args.acceptanceGate || "unspecified",
    "--require-platform-codex-implementation",
  ];
  if (requireVerifier) result.push("--require-platform-codex-verifier");
  return result;
}

function runChain(status, requireVerifier = false) {
  return node("scripts/dev/report-agent-factory-chain.mjs", chainArgs(status, requireVerifier));
}

function checkGate({ verifier = false } = {}) {
  const gateArgs = [
    "--implementation",
    "--task-id",
    args.taskId,
    "--branch",
    args.branch || git(["rev-parse", "--abbrev-ref", "HEAD"]) || "",
    "--commit",
    currentCommit(),
  ];
  if (verifier) gateArgs.push("--verifier");
  return node("scripts/dev/check-platform-codex-evidence.mjs", gateArgs);
}

async function requireGate(stage, options = {}) {
  const result = checkGate(options);
  if (result.status === 0) {
    return true;
  }
  await writeStageReport(stage, {
    result: "blocked_waiting_for_platform_codex_evidence",
    operations: [
      `Checked ${options.verifier ? "implementation and verifier" : "implementation"} Platform Codex evidence.`,
      "Skipped downstream side effects because the required readback is missing or failed.",
      "Wrote .minelink-dev/reports/platform-codex-evidence.md.",
    ],
    errors: [sanitize(result.stderr || result.stdout) || "Platform Codex evidence gate failed."],
  });
  runChain("partial", options.verifier);
  return false;
}

async function runCommandStage(stage, command, commandArgs, options = {}) {
  if (options.requireImplementation && !(await requireGate(stage))) return;
  if (options.requireVerifier && !(await requireGate(stage, { verifier: true }))) return;

  const result = run(command, commandArgs);
  const output = sanitize([result.stdout, result.stderr].filter(Boolean).join("\n"));
  await writeStageReport(stage, {
    result: result.status === 0 ? "passed" : "blocked",
    operations: [`Ran: ${[command, ...commandArgs].join(" ")}`],
    errors: result.status === 0 ? [] : [`Command exited ${result.status ?? 1}`],
    output,
  });

  if (result.status !== 0) {
    runChain("partial", options.requireVerifier);
  }
}

const commonSyncArgs = [
  "--issue",
  args.linearIssue || "none",
  "--require-key",
  "--require-update",
];

async function runStageGroup(groupName, stages) {
  const operations = [];
  const errors = [];
  for (const stage of stages) {
    const stageResult = run(process.execPath, selfInvocationArgs(stage));
    operations.push(`Ran guarded stage ${stage} with exit ${stageResult.status ?? 1}.`);
    if (stageResult.status !== 0) {
      errors.push(`Stage ${stage} exited ${stageResult.status ?? 1}: ${sanitize(stageResult.stderr || stageResult.stdout)}`);
    }
  }
  await writeStageReport(groupName, {
    result: errors.length === 0 ? "completed_guarded_stages" : "blocked",
    operations,
    errors,
    output:
      "This grouped stage is a scheduling wrapper only. Inspect agent-factory-stage-<stage>.md and agent-factory-chain.md for accepted or blocked gate evidence.",
  });
  console.log(`Agent factory stage ${groupName} wrote ${stageReportPath(groupName)}`);
  process.exit(errors.length === 0 ? 0 : 1);
}

if (groupedStages[args.stage]) {
  await runStageGroup(args.stage, groupedStages[args.stage]);
}

switch (args.stage) {
  case "initial-report": {
    const result = runChain("partial");
    await writeStageReport(args.stage, {
      result: result.status === 0 ? "passed" : "blocked",
      operations: ["Wrote initial chain report."],
      errors: result.status === 0 ? [] : [`Command exited ${result.status ?? 1}`],
      output: sanitize(result.stdout || result.stderr),
    });
    break;
  }
  case "sync-in-progress":
    await runCommandStage(
      args.stage,
      process.execPath,
      [
        "scripts/dev/sync-linear-status.mjs",
        ...commonSyncArgs,
        "--status",
        "In Progress",
        "--comment",
        `Ona automation observed Platform Codex implementation evidence for ${args.taskId} on branch ${args.branch}. Source issue: ${args.githubIssue}`,
        "--attachment-title",
        `MineLink source task ${args.taskId}`,
        "--attachment-url",
        args.githubIssue || "none",
      ],
      { requireImplementation: true },
    );
    break;
  case "validate":
    await runCommandStage(
      args.stage,
      "bash",
      [
        "scripts/dev/verify-agent-task.sh",
        "--scope",
        args.validationScope || "docs",
        "--scenarios",
        args.scenarios || "none",
      ],
      { requireImplementation: true },
    );
    break;
  case "summarize":
    await runCommandStage(
      args.stage,
      process.execPath,
      ["scripts/dev/summarize-evidence.mjs"],
      { requireImplementation: true },
    );
    break;
  case "render-video":
    await runCommandStage(
      args.stage,
      process.execPath,
      [
        "scripts/dev/render-acceptance-video.mjs",
        "--task-id",
        args.taskId,
        "--branch",
        args.branch || "unknown",
        "--task-requirements",
        "docs/minelink-acceptance.md",
        "--require-mp4",
      ],
      { requireImplementation: true },
    );
    break;
  case "prepare-video":
    await runCommandStage(
      args.stage,
      process.execPath,
      ["scripts/dev/prepare-video-review-request.mjs", "--require-mp4"],
      { requireImplementation: true },
    );
    break;
  case "check-video-release":
    await runCommandStage(
      args.stage,
      process.execPath,
      ["scripts/dev/check-video-review.mjs", "--require-mp4"],
      { requireImplementation: true, requireVerifier: true },
    );
    break;
  case "sync-in-review":
    await runCommandStage(
      args.stage,
      process.execPath,
      [
        "scripts/dev/sync-linear-status.mjs",
        ...commonSyncArgs,
        "--status",
        "In Review",
        "--comment",
        `Ona validation and acceptance artifact steps completed for ${args.taskId}. Evidence paths: .minelink-dev/reports/agent-task-summary.md, .minelink-dev/reports/ci-evidence-summary.md, .minelink-dev/reports/artifacts/acceptance-summary.md, .minelink-dev/reports/artifacts/acceptance.mp4, .minelink-dev/reports/artifacts/video-review.md, and .minelink-dev/reports/artifacts/video-release-gate.md.`,
      ],
      { requireImplementation: true, requireVerifier: true },
    );
    break;
  case "create-pr":
    await runCommandStage(
      args.stage,
      process.execPath,
      [
        "scripts/dev/create-agent-factory-pr.mjs",
        "--branch",
        args.branch || "unknown",
        "--title",
        args.prTitle || `Advance ${args.taskId}`,
        "--task-id",
        args.taskId,
        "--github-issue",
        args.githubIssue || "none",
        "--linear-issue",
        args.linearIssue || "none",
        "--acceptance-gate",
        args.acceptanceGate || "unspecified",
        "--validation-scope",
        args.validationScope || "docs",
      ],
      { requireImplementation: true, requireVerifier: true },
    );
    break;
  case "final-report": {
    if (await requireGate(args.stage, { verifier: true })) {
      const result = runChain("passed", true);
      await writeStageReport(args.stage, {
        result: result.status === 0 ? "passed" : "blocked",
        operations: ["Wrote final chain report."],
        errors: result.status === 0 ? [] : [`Command exited ${result.status ?? 1}`],
        output: sanitize(result.stdout || result.stderr),
      });
    }
    break;
  }
  default:
    console.error(`Unknown or missing stage: ${args.stage}`);
    process.exit(2);
}

console.log(`Agent factory stage ${args.stage} wrote ${stageReportPath(args.stage)}`);
