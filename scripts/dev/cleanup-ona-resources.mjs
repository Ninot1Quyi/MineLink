#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const defaults = {
  output: ".minelink-dev/reports/ona-resource-cleanup.md",
  jsonOutput: ".minelink-dev/reports/ona-resource-cleanup.json",
  projectId: process.env.MINELINK_ONA_PROJECT_ID ?? "",
  onaTimeout: process.env.MINELINK_ONA_CLEANUP_TIMEOUT ?? "30s",
};
const defaultReportPath = ".minelink-dev/reports/ona-platform-codex-api-session.json";

const args = {
  ...defaults,
  environmentIds: [],
  reportPaths: [],
  stop: false,
  delete: false,
  allowDirty: false,
  dontWait: false,
  pruneStaleStopped: false,
  maxPrune: Number(process.env.MINELINK_ONA_MAX_PRUNE ?? 5),
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
  else if (arg === "--delete") args.delete = true;
  else if (arg === "--allow-dirty") args.allowDirty = true;
  else if (arg === "--dont-wait") args.dontWait = true;
  else if (arg === "--prune-stale-stopped") args.pruneStaleStopped = true;
  else if (arg === "--max-prune") args.maxPrune = Number(readValue());
  else if (arg === "--ona-timeout") args.onaTimeout = readValue();
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
  --delete                   Delete selected environments. Only safe for clean,
                             stopped environments unless --allow-dirty is set.
  --allow-dirty              Stop even when Ona reports changed workspace files.
  --dont-wait                Request stop without waiting for completion.
  --prune-stale-stopped      Add old stopped, clean project environments from
                             'ona environment list' to the cleanup set.
  --max-prune <n>            Maximum stale stopped environments to add.
  --ona-timeout <duration>   Per Ona CLI operation timeout. Defaults to 30s.
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
  const finalArgs = ["--timeout", args.onaTimeout, ...commandArgs];
  return spawnSync("ona", finalArgs, {
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

function envDesiredPhase(environment) {
  return environment?.spec?.desiredPhase ?? "";
}

function envCreatedAt(environment) {
  return environment?.metadata?.createdAt ?? environment?.createdAt ?? "";
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
    desiredPhase: envDesiredPhase(environment),
    createdAt: envCreatedAt(environment),
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
    /STOPPED|STOPPING|DELETED|DELETING/i.test(summary?.machinePhase ?? "") ||
    /STOPPED|STOPPING|DELETED|DELETING/i.test(summary?.desiredPhase ?? "");
}

function isDeleted(summary) {
  return /DELETED|DELETING/i.test(summary?.phase ?? "") ||
    /DELETED|DELETING/i.test(summary?.machinePhase ?? "") ||
    /DELETED|DELETING/i.test(summary?.desiredPhase ?? "");
}

function isRunningOrStarting(summary) {
  return /RUNNING|STARTING|PENDING|CREATING/i.test(summary?.phase ?? "") ||
    /RUNNING|STARTING|PENDING|CREATING/i.test(summary?.machinePhase ?? "");
}

function shouldDelete(summary) {
  if (!args.delete) return { ok: false, reason: "delete_not_requested" };
  if (args.projectId && summary.projectId !== args.projectId) {
    return { ok: false, reason: `project_mismatch:${summary.projectId || "missing"}` };
  }
  if (!isStopped(summary)) return { ok: false, reason: "not_stopped" };
  if (isRunningOrStarting(summary)) return { ok: false, reason: "running_or_starting" };
  if (!args.allowDirty && summary.changedFiles > 0) {
    return { ok: false, reason: `dirty_workspace:${summary.changedFiles}` };
  }
  return { ok: true, reason: "" };
}

function parseList(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function collectPruneCandidates(existingIds) {
  if (!args.pruneStaleStopped || !args.projectId) return { candidates: [], warning: "" };
  if (!Number.isFinite(args.maxPrune) || args.maxPrune < 0) {
    return { candidates: [], warning: "--max-prune must be a non-negative number." };
  }
  const result = run(["environment", "list", "-o", "json", "--limit", "1000"]);
  if (result.status !== 0) {
    return { candidates: [], warning: sanitize(result.stderr || result.stdout) };
  }
  const candidates = parseList(result.stdout)
    .map((environment) => envSummary(environment))
    .filter((summary) => summary.id)
    .filter((summary) => !existingIds.has(summary.id))
    .filter((summary) => summary.projectId === args.projectId)
    .filter((summary) => isStopped(summary))
    .filter((summary) => !isDeleted(summary))
    .filter((summary) => !isRunningOrStarting(summary))
    .filter((summary) => args.allowDirty || summary.changedFiles === 0)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
    .slice(0, args.maxPrune);
  return { candidates, warning: "" };
}

async function cleanupEnvironment(environmentId) {
  const getResult = run(["environment", "get", environmentId, "-o", "json"]);
  const record = {
    environmentId,
    before: null,
    after: null,
    action: args.delete ? "delete" : args.stop ? "stop" : "dry-run",
    result: "pending",
    reason: "",
    output: "",
    error: "",
    warning: "",
  };

  if (getResult.status !== 0) {
    const error = sanitize(getResult.stderr || getResult.stdout);
    if (args.delete && /not_found|environment not found/i.test(error)) {
      record.result = "deleted";
      record.reason = "already_deleted";
      record.after = {
        id: environmentId,
        phase: "deleted_or_unreadable",
        machinePhase: "",
        desiredPhase: "",
        changedFiles: 0,
      };
      return record;
    }
    record.result = "readback_failed";
    record.error = error;
    return record;
  }

  const before = parseEnvironment(getResult.stdout);
  record.before = before ? envSummary(before) : null;
  if (!record.before) {
    record.result = "readback_parse_failed";
    record.error = "ona environment get did not return JSON.";
    return record;
  }

  if (args.delete) {
    const decision = shouldDelete(record.before);
    if (!decision.ok) {
      record.result = "skipped";
      record.reason = decision.reason;
      return record;
    }

    const deleteArgs = ["environment", "delete", environmentId];
    if (args.dontWait) deleteArgs.push("--dont-wait");
    const deleteResult = run(deleteArgs);
    record.output = sanitize([deleteResult.stdout, deleteResult.status === 0 ? deleteResult.stderr : ""].filter(Boolean).join("\n"));
    record.error = deleteResult.status === 0 ? "" : sanitize(deleteResult.stderr);

    const afterResult = run(["environment", "get", environmentId, "-o", "json"]);
    if (afterResult.status === 0) {
      const after = parseEnvironment(afterResult.stdout);
      record.after = after ? envSummary(after) : null;
    } else if (deleteResult.status === 0) {
      record.after = {
        id: environmentId,
        phase: "deleted_or_unreadable",
        machinePhase: "",
        desiredPhase: "",
        changedFiles: 0,
      };
    }

    if (deleteResult.status !== 0 && !isDeleted(record.after)) {
      record.result = "delete_failed";
      return record;
    }
    if (deleteResult.status !== 0 && isDeleted(record.after)) {
      record.reason = "delete_reported_error_but_environment_deleted";
      record.warning = record.error;
      record.error = "";
    }
    record.result = "deleted";
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
  record.output = sanitize([stopResult.stdout, stopResult.status === 0 ? stopResult.stderr : ""].filter(Boolean).join("\n"));
  record.error = stopResult.status === 0 ? "" : sanitize(stopResult.stderr);

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
    record.warning = record.error;
    record.error = "";
  }
  record.result = "stopped";
  return record;
}

const environmentIds = await collectEnvironmentIds();
const prune = collectPruneCandidates(new Set(environmentIds));
for (const candidate of prune.candidates) {
  environmentIds.push(candidate.id);
}
const records = [];
for (const environmentId of environmentIds) {
  records.push(await cleanupEnvironment(environmentId));
}

const stopped = records.filter((record) => record.result === "stopped").length;
const deleted = records.filter((record) => record.result === "deleted").length;
const failed = records.filter((record) => record.result.endsWith("_failed")).length;
const dirtySkipped = records.filter((record) => record.reason.startsWith("dirty_workspace")).length;
const report = {
  generatedAt: new Date().toISOString(),
  stopRequested: args.stop,
  deleteRequested: args.delete,
  allowDirty: args.allowDirty,
  dontWait: args.dontWait,
  pruneStaleStopped: args.pruneStaleStopped,
  maxPrune: args.maxPrune,
  onaTimeout: args.onaTimeout,
  projectId: args.projectId || "",
  reportPaths: args.reportPaths,
  environmentIds,
  pruneWarning: prune.warning,
  pruneCandidates: prune.candidates,
  result: failed > 0 ? "partial" : "completed",
  stopped,
  deleted,
  skipped: records.filter((record) => record.result === "skipped").length,
  dirtySkipped,
  records,
  boundary:
    "Cleanup evidence only. Stopping or deleting an Ona task environment does not prove MineLink product acceptance.",
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
  `- Delete requested: \`${report.deleteRequested ? "yes" : "no"}\``,
  `- Prune stale stopped: \`${report.pruneStaleStopped ? "yes" : "no"}\``,
  `- Max prune: \`${report.maxPrune}\``,
  `- Ona operation timeout: \`${report.onaTimeout}\``,
  `- Project guard: \`${report.projectId || "none"}\``,
  `- Stopped: \`${report.stopped}\``,
  `- Deleted: \`${report.deleted}\``,
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
          return `| ${md(record.result)} | ${md(record.reason || "none")} | \`${md(record.environmentId)}\` | ${md(before.name || "none")} | ${md(before.branch || "none")} | ${md(before.phase || "unknown")}/${md(before.machinePhase || "unknown")}/${md(before.desiredPhase || "unknown")} | ${md(after.phase || "not-read")}/${md(after.machinePhase || "not-read")}/${md(after.desiredPhase || "not-read")} | ${Number(before.changedFiles ?? 0)} |`;
        }),
      ].join("\n"),
  report.pruneWarning ? `\nPrune warning: ${md(report.pruneWarning)}\n` : "",
  "",
  "## Errors",
  "",
  ...records
    .filter((record) => record.error)
    .map((record) => `- \`${record.environmentId}\`: ${md(record.error)}`),
  records.some((record) => record.error) ? "" : "- none",
  "",
  "## Warnings",
  "",
  ...records
    .filter((record) => record.warning)
    .map((record) => `- \`${record.environmentId}\`: ${md(record.warning)}`),
  records.some((record) => record.warning) ? "" : "- none",
  "",
];

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, `${lines.join("\n")}\n`, "utf8");
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Ona cleanup report wrote ${args.output} and ${args.jsonOutput}`);
