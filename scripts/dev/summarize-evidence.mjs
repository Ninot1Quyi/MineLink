#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

let root = ".minelink-dev";
let output = ".minelink-dev/reports/ci-evidence-summary.md";
let appendStepSummary = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--root") {
    root = process.argv[++index] ?? "";
  } else if (arg === "--output") {
    output = process.argv[++index] ?? "";
  } else if (arg === "--append-step-summary") {
    appendStepSummary = true;
  } else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/summarize-evidence.mjs [--root .minelink-dev] [--output path] [--append-step-summary]

Aggregates existing MineLink evidence reports into a Markdown summary. This
script never upgrades mock or smoke evidence into product acceptance; it only
links and summarizes reports already produced by other commands.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!root || !output) {
  console.error("--root and --output cannot be empty");
  process.exit(2);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  if (!(await exists(dir))) {
    return [];
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (fullPath.includes(`${path.sep}install-smoke${path.sep}work${path.sep}`)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    return { __parseError: error instanceof Error ? error.message : String(error) };
  }
}

function rel(filePath) {
  return path.relative(process.cwd(), filePath) || filePath;
}

function md(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

function boolStatus(value) {
  if (value === true) return "passed";
  if (value === false) return "failed";
  return "unknown";
}

function inferRuntime(filePath, report) {
  if (typeof report.runtime === "string") return report.runtime;
  const normalized = filePath.replaceAll(path.sep, "/");
  if (normalized.includes("neoforge")) return "neoforge";
  const loader = report.connect?.hello?.server?.loader ?? report.hello?.server?.loader;
  if (typeof loader === "string" && loader.includes("mock")) return "mock";
  if (typeof loader === "string" && loader.includes("neoforge")) return "neoforge";
  return "unknown";
}

function collectToolFailureReasons(report) {
  const reasons = new Set();
  for (const result of report.tool_results ?? []) {
    const reason =
      result?.result?.error?.reason ??
      result?.result?.failure_reason ??
      result?.result?.reason;
    if (typeof reason === "string" && reason.length > 0) {
      reasons.add(reason);
    }
  }
  return [...reasons].sort();
}

function summarizeScenario(filePath, report) {
  const assertions = Array.isArray(report.final_assertions)
    ? report.final_assertions
    : [];
  const failedAssertions = assertions
    .filter((assertion) => assertion?.passed === false)
    .map((assertion) => assertion?.name ?? assertion?.kind ?? "unnamed_assertion");
  return {
    path: rel(filePath),
    scenario: report.scenario ?? path.basename(filePath).replace(/-result\.json$/, ""),
    runtime: inferRuntime(filePath, report),
    passed: report.passed,
    transport: report.mcp_transport?.transport ?? "unknown",
    assertions: assertions.length,
    failedAssertions,
    toolResults: Array.isArray(report.tool_results) ? report.tool_results.length : 0,
    failureReasons: collectToolFailureReasons(report),
    parseError: report.__parseError,
  };
}

function summarizeSoak(filePath, report) {
  return {
    path: rel(filePath),
    runtime: report.runtime ?? "unknown",
    passed: report.passed,
    iterations: report.iterations ?? "unknown",
    runCount: report.run_count ?? (Array.isArray(report.runs) ? report.runs.length : "unknown"),
    scenarios: Array.isArray(report.scenarios)
      ? report.scenarios.join(", ")
      : Array.isArray(report.runs)
        ? [...new Set(report.runs.map((run) => run.scenario).filter(Boolean))].join(", ")
        : "unknown",
    parseError: report.__parseError,
  };
}

function summarizeCleanup(filePath, report) {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const openPorts = checks.flatMap((check) => check.ports ?? []).filter((port) => port.open);
  return {
    path: rel(filePath),
    runtime: report.runtime ?? "unknown",
    passed: report.passed,
    checks: checks.length,
    openPorts: openPorts.map((port) => port.port).join(", ") || "none",
    parseError: report.__parseError,
  };
}

function summarizeQueue(filePath, report) {
  const failureReasons =
    report.failure_reasons && typeof report.failure_reasons === "object"
      ? Object.entries(report.failure_reasons)
          .map(([reason, count]) => `${reason}:${count}`)
          .join(", ")
      : "none";
  return {
    path: rel(filePath),
    runtime: report.runtime ?? "unknown",
    passed: report.passed,
    runCount: report.run_count ?? "unknown",
    totalToolResults: report.total_tool_results ?? "unknown",
    failureReasons,
    parseError: report.__parseError,
  };
}

async function summarizeInstallSmoke(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  const valueFor = (label) => {
    const regex = new RegExp(`^- ${label}: \\\`([^\\\`]+)\\\``, "m");
    return text.match(regex)?.[1] ?? "unknown";
  };
  return {
    path: rel(filePath),
    result: valueFor("Result"),
    evidenceClass: valueFor("Evidence class"),
    sourceCommit: valueFor("Source commit"),
    sourceDirty: valueFor("Source dirty"),
    scope: valueFor("Verification scope"),
  };
}

const files = await walk(root);
const scenarios = [];
const soaks = [];
const cleanups = [];
const queues = [];
const installs = [];
const parseErrors = [];

for (const file of files) {
  const normalized = file.replaceAll(path.sep, "/");
  if (normalized.endsWith("-result.json")) {
    const report = await readJson(file);
    const summary = summarizeScenario(file, report);
    scenarios.push(summary);
    if (summary.parseError) parseErrors.push({ path: summary.path, error: summary.parseError });
  } else if (normalized.endsWith("/soak-report.json")) {
    const report = await readJson(file);
    const summary = summarizeSoak(file, report);
    soaks.push(summary);
    if (summary.parseError) parseErrors.push({ path: summary.path, error: summary.parseError });
  } else if (normalized.endsWith("/process-cleanup.json")) {
    const report = await readJson(file);
    const summary = summarizeCleanup(file, report);
    cleanups.push(summary);
    if (summary.parseError) parseErrors.push({ path: summary.path, error: summary.parseError });
  } else if (normalized.endsWith("/queue-metrics.json")) {
    const report = await readJson(file);
    const summary = summarizeQueue(file, report);
    queues.push(summary);
    if (summary.parseError) parseErrors.push({ path: summary.path, error: summary.parseError });
  } else if (normalized.endsWith("/install-smoke-report.md")) {
    installs.push(await summarizeInstallSmoke(file));
  }
}

const failedScenarios = scenarios.filter((scenario) => scenario.passed === false);
const failedSoaks = soaks.filter((soak) => soak.passed === false);
const failedCleanups = cleanups.filter((cleanup) => cleanup.passed === false);
const failedQueues = queues.filter((queue) => queue.passed === false);
const failedInstalls = installs.filter((install) => install.result === "failed");
const evidenceCount =
  scenarios.length + soaks.length + cleanups.length + queues.length + installs.length;
let aggregateStatus = "no_reported_failures";
if (evidenceCount === 0) {
  aggregateStatus = "no_evidence_found";
}
if (
  parseErrors.length > 0 ||
  failedScenarios.length > 0 ||
  failedSoaks.length > 0 ||
  failedCleanups.length > 0 ||
  failedQueues.length > 0 ||
  failedInstalls.length > 0
) {
  aggregateStatus = "attention_required";
}

const runUrl =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "local";

const lines = [];
lines.push("# MineLink CI Evidence Summary");
lines.push("");
lines.push(`- Generated: \`${new Date().toISOString()}\``);
lines.push(`- Aggregate status: \`${aggregateStatus}\``);
lines.push(`- Workflow: \`${process.env.GITHUB_WORKFLOW ?? "local"}\``);
lines.push(`- Run: ${runUrl === "local" ? "`local`" : `[${process.env.GITHUB_RUN_ID}](${runUrl})`}`);
lines.push(`- Commit: \`${process.env.GITHUB_SHA ?? "local"}\``);
lines.push(`- Evidence root: \`${root}\``);
lines.push(`- Evidence reports found: \`${evidenceCount}\``);
lines.push("");
lines.push("## Acceptance Boundary");
lines.push("");
lines.push(
  "This summary aggregates reports already produced by MineLink verification commands. It does not convert mock, replay, smoke, or short-soak evidence into `product-accepted` status. Gate status remains governed by `docs/minelink-acceptance.md`.",
);
lines.push("");

lines.push("## Scenario Results");
lines.push("");
if (scenarios.length === 0) {
  lines.push("- No scenario result reports found.");
} else {
  lines.push("| Result | Runtime | Scenario | Assertions | Tool Results | Transport | Failure Reasons | Report |");
  lines.push("| --- | --- | --- | ---: | ---: | --- | --- | --- |");
  for (const scenario of scenarios) {
    const failureText =
      scenario.parseError ??
      (scenario.failedAssertions.length > 0
        ? `failed assertions: ${scenario.failedAssertions.join(", ")}`
        : scenario.failureReasons.join(", ") || "none");
    lines.push(
      `| ${md(boolStatus(scenario.passed))} | ${md(scenario.runtime)} | ${md(scenario.scenario)} | ${scenario.assertions} | ${scenario.toolResults} | ${md(scenario.transport)} | ${md(failureText)} | \`${md(scenario.path)}\` |`,
    );
  }
}
lines.push("");

lines.push("## Soak Reports");
lines.push("");
if (soaks.length === 0) {
  lines.push("- No soak reports found.");
} else {
  lines.push("| Result | Runtime | Iterations | Runs | Scenarios | Report |");
  lines.push("| --- | --- | ---: | ---: | --- | --- |");
  for (const soak of soaks) {
    lines.push(
      `| ${md(boolStatus(soak.passed))} | ${md(soak.runtime)} | ${md(soak.iterations)} | ${md(soak.runCount)} | ${md(soak.parseError ?? soak.scenarios)} | \`${md(soak.path)}\` |`,
    );
  }
}
lines.push("");

lines.push("## Stability Checks");
lines.push("");
if (cleanups.length === 0 && queues.length === 0) {
  lines.push("- No process cleanup or queue metrics reports found.");
} else {
  if (cleanups.length > 0) {
    lines.push("### Process Cleanup");
    lines.push("");
    lines.push("| Result | Runtime | Checks | Open Ports | Report |");
    lines.push("| --- | --- | ---: | --- | --- |");
    for (const cleanup of cleanups) {
      lines.push(
        `| ${md(boolStatus(cleanup.passed))} | ${md(cleanup.runtime)} | ${md(cleanup.checks)} | ${md(cleanup.parseError ?? cleanup.openPorts)} | \`${md(cleanup.path)}\` |`,
      );
    }
    lines.push("");
  }
  if (queues.length > 0) {
    lines.push("### Queue Metrics");
    lines.push("");
    lines.push("| Result | Runtime | Runs | Tool Results | Failure Reasons | Report |");
    lines.push("| --- | --- | ---: | ---: | --- | --- |");
    for (const queue of queues) {
      lines.push(
        `| ${md(boolStatus(queue.passed))} | ${md(queue.runtime)} | ${md(queue.runCount)} | ${md(queue.totalToolResults)} | ${md(queue.parseError ?? queue.failureReasons)} | \`${md(queue.path)}\` |`,
      );
    }
    lines.push("");
  }
}

lines.push("## Install Smoke");
lines.push("");
if (installs.length === 0) {
  lines.push("- No install smoke report found.");
} else {
  lines.push("| Result | Evidence Class | Source Dirty | Scope | Source Commit | Report |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const install of installs) {
    lines.push(
      `| ${md(install.result)} | ${md(install.evidenceClass)} | ${md(install.sourceDirty)} | ${md(install.scope)} | \`${md(install.sourceCommit)}\` | \`${md(install.path)}\` |`,
    );
  }
}
lines.push("");

if (parseErrors.length > 0) {
  lines.push("## Parse Errors");
  lines.push("");
  for (const error of parseErrors) {
    lines.push(`- \`${md(error.path)}\`: ${md(error.error)}`);
  }
  lines.push("");
}

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${lines.join("\n")}\n`);

if (appendStepSummary && process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

console.log(`Wrote ${output}`);
