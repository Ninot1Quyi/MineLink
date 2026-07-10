#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const defaults = {
  implementationReadback: ".minelink-dev/reports/ona-codex-implementation-session.md",
  verifierReadback: ".minelink-dev/reports/ona-codex-video-verifier-session.md",
  output: ".minelink-dev/reports/platform-codex-evidence.md",
  taskId: process.env.MINELINK_TASK_ID ?? "",
  branch: process.env.MINELINK_BRANCH ?? "",
  commit: process.env.MINELINK_COMMIT ?? "",
};

const args = { ...defaults };
let requireImplementation = false;
let requireVerifier = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--implementation") requireImplementation = true;
  else if (arg === "--verifier") requireVerifier = true;
  else if (arg === "--implementation-readback") args.implementationReadback = readValue();
  else if (arg === "--verifier-readback") args.verifierReadback = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--task-id") args.taskId = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--commit") args.commit = readValue();
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/check-platform-codex-evidence.mjs [--implementation] [--verifier]

Fails unless the requested Ona Platform Codex readback files identify:

Agent mode: Ona Platform Codex
Agent execution mode: AGENT_MODE_RALPH
Identity: I am Codex running in Ona Platform Codex
Platform evidence: <Ona UI/API evidence that this session was created with Codex selected>
Session id: <Ona session id>
Result: passed
Task id: <expected task id>
Branch: <expected branch>
Commit: <expected commit>

This is a fail-closed guard for the MineLink factory finalizer.
Self-reported identity is not sufficient: generic Ona automation, SSH, task,
or default-agent output must not satisfy it.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!requireImplementation && !requireVerifier) {
  requireImplementation = true;
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function statFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

function markerValue(text, names) {
  const keys = Array.isArray(names) ? names : [names];
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(text ?? "").match(new RegExp(`^${escaped}:\\s*` + "(.+?)\\s*$", "im"));
    if (match?.[1]) return match[1].replace(/^`|`$/g, "").trim();
  }
  return "";
}

function hasValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.length > 0 && !["none", "null", "undefined", "-"].includes(normalized);
}

function agentModeAccepted(text) {
  const mode = markerValue(text, ["Agent mode", "Agent", "Verifier"]);
  return /Ona Platform Codex/i.test(mode);
}

function goalModeAccepted(text) {
  const mode = markerValue(text, "Agent execution mode");
  return mode === "AGENT_MODE_RALPH";
}

function identityAccepted(text) {
  const identity = markerValue(text, "Identity");
  return /\bCodex\b/i.test(identity) && /Ona Platform Codex/i.test(identity);
}

function platformEvidenceAccepted(text) {
  const evidence = markerValue(text, ["Platform evidence", "Provider evidence", "Agent selector"]);
  if (/(missing|unavailable|blocked|none|null|unknown)/i.test(evidence)) return false;
  if (!/\bCodex\b/i.test(evidence)) return false;
  return !/(Ai-Automations Action Execution|default Ona Agent|Claude)/i.test(evidence);
}

function resultPassed(text) {
  const result = markerValue(text, ["Result", "Status", "Release decision"]);
  return /^(passed|pass|completed|complete|succeeded|success)$/i.test(result);
}

function expectedValuePresent(value) {
  return hasValue(value) && !["unknown", "manual"].includes(String(value).trim().toLowerCase());
}

function commitMatches(actual, expected) {
  if (!hasValue(actual) || !hasValue(expected)) return false;
  const actualText = String(actual).trim();
  const expectedText = String(expected).trim();
  return actualText === expectedText || expectedText.startsWith(actualText) || actualText.startsWith(expectedText);
}

async function checkReadback(label, filePath) {
  const stat = await statFile(filePath);
  const text = await readText(filePath);
  const failures = [];
  const evidence = [];

  if (!stat || stat.size === 0) {
    failures.push(`${label} readback is missing or empty: ${filePath}`);
  } else {
    evidence.push(`${label} readback: ${filePath} (${stat.size} bytes)`);
  }

  if (!agentModeAccepted(text)) {
    failures.push(`${label} readback must contain Agent mode: Ona Platform Codex`);
  } else {
    evidence.push(`${label} agent mode accepted`);
  }

  if (!goalModeAccepted(text)) {
    failures.push(`${label} readback must contain Agent execution mode: AGENT_MODE_RALPH`);
  } else {
    evidence.push(`${label} Goal/Ralph execution mode accepted`);
  }

  if (!identityAccepted(text)) {
    failures.push(`${label} readback must contain Identity: I am Codex running in Ona Platform Codex`);
  } else {
    evidence.push(`${label} identity statement present as a diagnostic`);
  }

  if (!platformEvidenceAccepted(text)) {
    failures.push(`${label} readback must contain Platform evidence showing the Ona session was created with Codex selected; self-reported identity is not accepted`);
  } else {
    evidence.push(`${label} platform Codex selector/API evidence present`);
  }

  const sessionId = markerValue(text, "Session id") || markerValue(text, "Session");
  if (!hasValue(sessionId)) {
    failures.push(`${label} readback must contain Session id`);
  } else {
    evidence.push(`${label} session id present`);
  }

  if (!resultPassed(text)) {
    failures.push(`${label} readback must contain Result: passed`);
  } else {
    evidence.push(`${label} result passed`);
  }

  const taskId = markerValue(text, ["Task id", "Task"]);
  if (expectedValuePresent(args.taskId)) {
    if (taskId !== args.taskId) {
      failures.push(`${label} readback Task id mismatch: expected ${args.taskId}, got ${taskId || "missing"}`);
    } else {
      evidence.push(`${label} task id matches ${args.taskId}`);
    }
  }

  const branch = markerValue(text, "Branch");
  if (expectedValuePresent(args.branch)) {
    if (branch !== args.branch) {
      failures.push(`${label} readback Branch mismatch: expected ${args.branch}, got ${branch || "missing"}`);
    } else {
      evidence.push(`${label} branch matches ${args.branch}`);
    }
  }

  const commit = markerValue(text, "Commit");
  if (expectedValuePresent(args.commit)) {
    if (!commitMatches(commit, args.commit)) {
      failures.push(`${label} readback Commit mismatch: expected ${args.commit}, got ${commit || "missing"}`);
    } else {
      evidence.push(`${label} commit matches ${args.commit}`);
    }
  }

  return { failures, evidence };
}

const checks = [];
if (requireImplementation) {
  checks.push(await checkReadback("Implementation", args.implementationReadback));
}
if (requireVerifier) {
  checks.push(await checkReadback("Video verifier", args.verifierReadback));
}

const failures = checks.flatMap((check) => check.failures);
const evidence = checks.flatMap((check) => check.evidence);

await fs.mkdir(path.dirname(args.output), { recursive: true });
const lines = [
  "# MineLink Platform Codex Evidence Gate",
  "",
  `- Implementation required: \`${requireImplementation ? "yes" : "no"}\``,
  `- Video verifier required: \`${requireVerifier ? "yes" : "no"}\``,
  `- Expected task id: \`${args.taskId || "none"}\``,
  `- Expected branch: \`${args.branch || "none"}\``,
  `- Expected commit: \`${args.commit || "none"}\``,
  `- Result: \`${failures.length === 0 ? "passed" : "failed"}\``,
  "- Boundary: `Ona Platform Codex readback plus platform selector/API evidence only; generic Ona automation evidence and self-reported identity are not accepted`",
  "",
  "## Evidence",
  "",
  ...(evidence.length > 0 ? evidence.map((item) => `- ${item}`) : ["- none"]),
  "",
  "## Failures",
  "",
  ...(failures.length === 0 ? ["- none"] : failures.map((failure) => `- ${failure}`)),
  "",
];
await fs.writeFile(args.output, lines.join("\n"), "utf8");

if (failures.length > 0) {
  console.error(`Platform Codex evidence gate failed; wrote ${args.output}`);
  process.exit(1);
}

console.log(`Platform Codex evidence gate passed; wrote ${args.output}`);
