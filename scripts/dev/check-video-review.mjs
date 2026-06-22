#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

let reviewPath = ".minelink-dev/reports/artifacts/video-review.md";
let summaryPath = ".minelink-dev/reports/artifacts/acceptance-summary.md";
let mp4Path = ".minelink-dev/reports/artifacts/acceptance.mp4";
let originPath = ".minelink-dev/reports/artifacts/acceptance-video-origin.json";
let outputPath = ".minelink-dev/reports/artifacts/video-release-gate.md";
let requireMp4 = false;
let requireProducer = "";

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--review") {
    reviewPath = process.argv[++index] ?? "";
  } else if (arg === "--summary") {
    summaryPath = process.argv[++index] ?? "";
  } else if (arg === "--mp4") {
    mp4Path = process.argv[++index] ?? "";
  } else if (arg === "--origin") {
    originPath = process.argv[++index] ?? "";
  } else if (arg === "--output") {
    outputPath = process.argv[++index] ?? "";
  } else if (arg === "--require-producer") {
    requireProducer = process.argv[++index] ?? "";
  } else if (arg === "--require-mp4") {
    requireMp4 = true;
  } else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/check-video-review.mjs [--require-mp4]

Checks the same-session acceptance-video verifier report before release. The
verifier report must explicitly contain:

Verifier: Ona Platform Codex
Release decision: pass
Task matched: yes
Video matched: yes
Summary sha256: <current acceptance-summary.md sha256>
MP4 sha256: <current acceptance.mp4 sha256>

Any missing video, missing report, negative marker, or non-pass decision fails
the release gate. Use --require-producer <producer> to require a specific video
origin such as ona-environment.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!reviewPath || !summaryPath || !mp4Path || !outputPath) {
  console.error("--review, --summary, --mp4, and --output cannot be empty");
  process.exit(2);
}

async function stat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function marker(text, label) {
  const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim().toLowerCase() ?? "";
}

function summaryCount(text, label) {
  const match = text.match(new RegExp(`^-\\s*${label}:\\s*\`?(\\d+)\`?\\s*$`, "im"));
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

const failures = [];
const reviewStat = await stat(reviewPath);
const summaryStat = await stat(summaryPath);
const mp4Stat = await stat(mp4Path);
const origin = await readJson(originPath);
const producer = origin?.producer ?? "unknown";
const review = await readText(reviewPath);
const summary = await readText(summaryPath);
const scenarioReportCount = summaryCount(summary, "Scenario reports");

if (!summaryStat || !summaryStat.isFile() || summaryStat.size === 0) {
  failures.push(`Missing acceptance summary: ${summaryPath}`);
} else {
  if (scenarioReportCount === null) {
    failures.push("Acceptance summary does not declare Scenario reports");
  } else if (scenarioReportCount <= 0) {
    failures.push(
      "Acceptance video has zero scenario reports; placeholder videos cannot be released as final evidence",
    );
  }
  if (/^\s*-\s*No scenario reports found\./im.test(summary)) {
    failures.push("Acceptance summary contains no scenario reports");
  }
}

if (requireMp4 && (!mp4Stat || !mp4Stat.isFile() || mp4Stat.size === 0)) {
  failures.push(`Missing required acceptance MP4: ${mp4Path}`);
}

if (!reviewStat || !reviewStat.isFile() || reviewStat.size === 0) {
  failures.push(`Missing same-session video verifier report: ${reviewPath}`);
} else {
  const releaseDecision = marker(review, "Release decision");
  const taskMatched = marker(review, "Task matched");
  const videoMatched = marker(review, "Video matched");
  const reviewedProducer = marker(review, "Video producer");
  const verifier = marker(review, "Verifier");
  const reviewedSummaryHash = marker(review, "Summary sha256");
  const reviewedMp4Hash = marker(review, "MP4 sha256");
  if (!verifier.includes("ona platform") || !verifier.includes("codex")) {
    failures.push(`Video verifier is not Ona Platform Codex: ${verifier || "missing"}`);
  }
  if (releaseDecision !== "pass") {
    failures.push(`Video verifier release decision is not pass: ${releaseDecision || "missing"}`);
  }
  if (taskMatched !== "yes") {
    failures.push(`Video verifier task match is not yes: ${taskMatched || "missing"}`);
  }
  if (videoMatched !== "yes") {
    failures.push(`Video verifier video match is not yes: ${videoMatched || "missing"}`);
  }
  if (reviewedProducer && reviewedProducer !== String(producer).toLowerCase()) {
    failures.push(`Video verifier producer mismatch: ${reviewedProducer}`);
  }
  if (requireProducer && producer !== requireProducer) {
    failures.push(`Acceptance video producer is ${producer}, expected ${requireProducer}`);
  }
  if (/^Release decision:\s*fail/im.test(review)) {
    failures.push("Video verifier reported fail");
  }
  if (/^Task matched:\s*no/im.test(review)) {
    failures.push("Video verifier reported task mismatch");
  }
  if (/^Video matched:\s*no/im.test(review)) {
    failures.push("Video verifier reported video mismatch");
  }
  if (summaryStat?.isFile()) {
    const currentSummaryHash = await sha256(summaryPath);
    if (reviewedSummaryHash !== currentSummaryHash) {
      failures.push(`Video verifier summary hash mismatch: ${reviewedSummaryHash || "missing"}`);
    }
  }
  if (mp4Stat?.isFile()) {
    const currentMp4Hash = await sha256(mp4Path);
    if (reviewedMp4Hash !== currentMp4Hash) {
      failures.push(`Video verifier MP4 hash mismatch: ${reviewedMp4Hash || "missing"}`);
    }
  }
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const lines = [
  "# MineLink Acceptance Video Release Gate",
  "",
  `- Review report: \`${reviewPath}\``,
  `- Acceptance summary: \`${summaryPath}\``,
  `- Acceptance MP4: \`${mp4Path}\``,
  `- Acceptance video origin: \`${originPath}\``,
  `- Video producer: \`${producer}\``,
  `- Required producer: \`${requireProducer || "none"}\``,
  `- MP4 required: \`${requireMp4 ? "yes" : "no"}\``,
  `- Scenario reports: \`${scenarioReportCount ?? "unknown"}\``,
  `- Result: \`${failures.length === 0 ? "passed" : "failed"}\``,
  "",
  "## Failures",
  "",
  ...(failures.length === 0 ? ["- none"] : failures.map((failure) => `- ${failure}`)),
  "",
];
await fs.writeFile(outputPath, lines.join("\n"), "utf8");

if (failures.length > 0) {
  console.error(`Acceptance video release gate failed; wrote ${outputPath}`);
  process.exit(1);
}

console.log(`Acceptance video release gate passed; wrote ${outputPath}`);
