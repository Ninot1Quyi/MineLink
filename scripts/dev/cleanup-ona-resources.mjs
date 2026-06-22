#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const defaults = {
  output: ".minelink-dev/reports/ona-resource-cleanup.md",
  jsonOutput: ".minelink-dev/reports/ona-resource-cleanup.json",
  projectId: process.env.MINELINK_ONA_PROJECT_ID ?? "",
};
const defaultReportPath = ".minelink-dev/reports/ona-platform-codex-api-session.json";

const args = {
  ...defaults,
  environmentIds: [],
  reportPaths: [],
  stop: false,
  allowDirty: false,
  dontWait: false,
};

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--environment-id") args.environmentIds.push(readValue());
  else if (arg === "--from-report") args.reportPaths.push(readValue());
  else if (arg === "--project-id") args.projectId = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--stop") args.stop = true;
  else if (arg === "--allow-dirty") args.allowDirty = true;
  else if (arg === "--dont-wait") args.dontWait = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/cleanup-ona-resources.mjs [--stop]

Stops task-bound Ona environments after the agent-factory chain reaches a
terminal state. The script is fail-soft by default: it writes a cleanup report
and exits 0 so cleanup problems do not hide the real validation result.

Options:
  --from-report <path>       Read environmentId fields from a JSON report.
  --environment-id <id>      Add an explicit environment id.
  --project-id <id>          Only clean environments from this Ona project.
  --stop                     Actually run 'ona environment stop'.
  --allow-dirty              Stop even when Ona reports changed workspace files.
  --dont-wait                Request stop without waiting for completion.
  --output <path>            Markdown report path.
  --json-output <path>       JSON report path.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (args.environmentIds.length === 0 && args.reportPaths.length === 0) {
  args.reportPaths.push(defaultReportPath);
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/(lin_api_)[A-Za-z0-9]+/g, "$1[redacted]")
    .replace(/(github_pat_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(ghp_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(ona_[A-Za-z0-9_-]*=)[A-Za-z0-9._-]+/g, "$1[redacted]")
    .slice(0, 6000)
    .trim();
}

function run(commandArgs) {
  return spawnSync("ona", commandArgs, {
    encoding: "utf8",
    stdio: "pipe",
    env: process.env,
  });
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function addEnvironmentIds(value, ids) {
  if (!value || typeof value !== "object") return;
  if (typeof value.environmentId === "string" && value.environmentId.trim()) {
    ids.add(value.environmentId.trim());
  }
  if (Array.isArray(value)) {
    for (const item of value) addEnvironmentIds(item, ids);
    return;
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") addEnvironmentIds(nested, ids);
  }
}

async function collectEnvironmentIds() {
  const ids = new Set(args.environmentIds.filter(Boolean));
  for (const envName of ["MINELINK_ONA_ENVIRONMENT_ID", "ONA_ENVIRONMENT_ID"]) {
    if (process.env[envName]) ids.add(process.env[envName]);
  }
  for (const reportPath of args.reportPaths) {
    const report = await readJson(reportPath);
    if (report) addEnvironmentIds(report, ids);
  }
  return [...ids];
}

function parseEnvironment(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    return null;
  }
}

function envProjectId(environment) {
  return environment?.metadata?.projectId ?? environment?.projectId ?? "";
}

function envPhase(environment) {
  return environment?.status?.phase ?? environment?.phase ?? "";
}

function envMachinePhase(environment) {
  return environment?.status?.machine?.phase ?? "";
}

function envChangedFiles(environment) {
  const total = Number(environment?.status?.content?.git?.totalChangedFiles ?? 0);
  if (Number.isFinite(total) && total > 0) return total;
  const changedFiles = environment?.status?.content?.git?.changedFiles;
  return Array.isArray(changedFiles) ? changedFiles.length : 0;
}

function envBranch(environment) {
  return environment?.status?.content?.git?.branch ?? "";
}

function envName(environment) {
  return environment?.metadata?.name ?? "";
}

function envSummary(environment) {
  return {
    id: environment?.id ?? "",
    name: envName(environment),
    projectId: envProjectId(environment),
    branch: envBranch(environment),
    phase: envPhase(environment),
    machinePhase: envMachinePhase(environment),
    desiredPhase: environment?.spec?.desiredPhase ?? "",
    changedFiles: envChangedFiles(environment),
  };
}

function shouldStop(summary) {
  if (!args.stop) return { ok: false, reason: "dry_run" };
  if (args.projectId && summary.projectId !== args.projectId) {
    return { ok: false, reason: `project_mismatch:${summary.projectId || "missing"}` };
  }
  if (!args.allowDirty && summary.changedFiles > 0) {
    return { ok: false, reason: `dirty_workspace:${summary.changedFiles}` };
  }
  if (!/RUNNING|STARTING|PENDING/i.test(summary.phase) && !/RUNNING|STARTING|PENDING/i.test(summary.machinePhase)) {
    return { ok: false, reason: "not_running" };
  }
  return { ok: true, reason: "" };
}

function isStopped(summary) {
  return /STOPPED|STOPPING|DELETED|DELETING/i.test(summary?.phase ?? "") ||
    /STOPPED|STOPPING|DELETED|DELETING/i.test(summary?.machinePhase ?? "");
}

async function cleanupEnvironment(environmentId) {
  const getResult = run(["environment", "get", environmentId, "-o", "json"]);
  const record = {
    environmentId,
    before: null,
    after: null,
    action: args.stop ? "stop" : "dry-run",
    result: "pending",
    reason: "",
    output: "",
    error: "",
  };

  if (getResult.status !== 0) {
    record.result = "readback_failed";
    record.error = sanitize(getResult.stderr || getResult.stdout);
    return record;
  }

  const before = parseEnvironment(getResult.stdout);
  record.before = before ? envSummary(before) : null;
  if (!record.before) {
    record.result = "readback_parse_failed";
    record.error = "ona environment get did not return JSON.";
    return record;
  }

  const decision = shouldStop(record.before);
  if (!decision.ok) {
    record.result = "skipped";
    record.reason = decision.reason;
    return record;
  }

  const stopArgs = ["environment", "stop", environmentId];
  if (args.dontWait) stopArgs.push("--dont-wait");
  const stopResult = run(stopArgs);
  record.output = sanitize(stopResult.stdout);
  record.error = sanitize(stopResult.stderr);

  const afterResult = run(["environment", "get", environmentId, "-o", "json"]);
  if (afterResult.status === 0) {
    const after = parseEnvironment(afterResult.stdout);
    record.after = after ? envSummary(after) : null;
  }
  if (stopResult.status !== 0 && !isStopped(record.after)) {
    record.result = "stop_failed";
    return record;
  }
  if (stopResult.status !== 0 && isStopped(record.after)) {
    record.reason = "stop_reported_error_but_environment_stopped";
  }
  record.result = "stopped";
  return record;
}

const environmentIds = await collectEnvironmentIds();
const records = [];
for (const environmentId of environmentIds) {
  records.push(await cleanupEnvironment(environmentId));
}

const stopped = records.filter((record) => record.result === "stopped").length;
const failed = records.filter((record) => record.result.endsWith("_failed")).length;
const dirtySkipped = records.filter((record) => record.reason.startsWith("dirty_workspace")).length;
const report = {
  generatedAt: new Date().toISOString(),
  stopRequested: args.stop,
  allowDirty: args.allowDirty,
  dontWait: args.dontWait,
  projectId: args.projectId || "",
  reportPaths: args.reportPaths,
  environmentIds,
  result: failed > 0 ? "partial" : "completed",
  stopped,
  skipped: records.filter((record) => record.result === "skipped").length,
  dirtySkipped,
  records,
  boundary:
    "Cleanup evidence only. Stopping an Ona task environment does not prove MineLink product acceptance.",
};

function md(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

const lines = [
  "# MineLink Ona Resource Cleanup",
  "",
  `- Generated: \`${report.generatedAt}\``,
  `- Result: \`${report.result}\``,
  `- Stop requested: \`${report.stopRequested ? "yes" : "no"}\``,
  `- Project guard: \`${report.projectId || "none"}\``,
  `- Stopped: \`${report.stopped}\``,
  `- Skipped: \`${report.skipped}\``,
  `- Dirty skipped: \`${report.dirtySkipped}\``,
  `- Boundary: \`${report.boundary}\``,
  "",
  "## Environments",
  "",
  records.length === 0
    ? "- none"
    : [
        "| Result | Reason | Environment | Name | Branch | Before | After | Changed Files |",
        "| --- | --- | --- | --- | --- | --- | --- | ---: |",
        ...records.map((record) => {
          const before = record.before ?? {};
          const after = record.after ?? {};
          return `| ${md(record.result)} | ${md(record.reason || "none")} | \`${md(record.environmentId)}\` | ${md(before.name || "none")} | ${md(before.branch || "none")} | ${md(before.phase || "unknown")}/${md(before.machinePhase || "unknown")} | ${md(after.phase || "not-read")}/${md(after.machinePhase || "not-read")} | ${Number(before.changedFiles ?? 0)} |`;
        }),
      ].join("\n"),
  "",
  "## Errors",
  "",
  ...records
    .filter((record) => record.error)
    .map((record) => `- \`${record.environmentId}\`: ${md(record.error)}`),
  records.some((record) => record.error) ? "" : "- none",
  "",
];

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, `${lines.join("\n")}\n`, "utf8");
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Ona cleanup report wrote ${args.output} and ${args.jsonOutput}`);
