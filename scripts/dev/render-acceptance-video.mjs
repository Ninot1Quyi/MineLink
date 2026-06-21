#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let root = ".minelink-dev";
let outputDir = ".minelink-dev/reports/artifacts";
let taskId = process.env.MINELINK_TASK_ID ?? "local";
let branch = process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME ?? "";
let prUrl = process.env.MINELINK_PR_URL ?? "";
let taskRequirements = process.env.MINELINK_TASK_REQUIREMENTS ?? "";
let requireMp4 = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--root") {
    root = process.argv[++index] ?? "";
  } else if (arg === "--output-dir") {
    outputDir = process.argv[++index] ?? "";
  } else if (arg === "--task-id") {
    taskId = process.argv[++index] ?? "";
  } else if (arg === "--branch") {
    branch = process.argv[++index] ?? "";
  } else if (arg === "--pr-url") {
    prUrl = process.argv[++index] ?? "";
  } else if (arg === "--task-requirements") {
    taskRequirements = process.argv[++index] ?? "";
  } else if (arg === "--require-mp4") {
    requireMp4 = true;
  } else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/render-acceptance-video.mjs [--root .minelink-dev] [--output-dir .minelink-dev/reports/artifacts] [--task-id id] [--branch branch] [--pr-url url] [--task-requirements text] [--require-mp4]

Creates trace-driven MineLink acceptance artifacts from existing reports. The
summary is always written. MP4 rendering requires ffmpeg; use --require-mp4 to
make missing video support fail the command.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!root || !outputDir || !taskId) {
  console.error("--root, --output-dir, and --task-id cannot be empty");
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

async function gitBranch() {
  if (branch) return branch;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

function rel(filePath) {
  return path.relative(process.cwd(), filePath) || filePath;
}

function status(value) {
  if (value === true) return "passed";
  if (value === false) return "failed";
  return "unknown";
}

function toolTimelineStatus(payload) {
  if (!payload || typeof payload !== "object") {
    return "unknown";
  }
  if (payload.ok === false) {
    return "failed";
  }
  if (payload.ok === true) {
    return "passed";
  }
  if (typeof payload.status === "string" && payload.status) {
    return payload.status;
  }
  if (payload.reason || payload.failure_reason || payload.error) {
    return "failed";
  }
  return "passed";
}

function md(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

function ffmpegText(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 .:()/_-]/g, " ")
    .slice(0, 100);
}

const font = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  "J": ["00001", "00001", "00001", "00001", "10001", "10001", "01110"],
  "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
};

function setPixel(buffer, width, x, y, color) {
  if (x < 0 || y < 0 || x >= width) return;
  const offset = (y * width + x) * 3;
  if (offset < 0 || offset + 2 >= buffer.length) return;
  buffer[offset] = color[0];
  buffer[offset + 1] = color[1];
  buffer[offset + 2] = color[2];
}

function drawText(buffer, width, height, x, y, text, scale, color) {
  let cursor = x;
  for (const char of ffmpegText(text)) {
    const glyph = font[char] ?? font[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] !== "1") continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            setPixel(buffer, width, cursor + col * scale + dx, y + row * scale + dy, color);
          }
        }
      }
    }
    cursor += 6 * scale;
    if (cursor > width - 40) break;
  }
}

async function writePpmFrame(filePath, linesForFrame) {
  const width = 1280;
  const height = 720;
  const background = [16, 24, 32];
  const foreground = [238, 244, 248];
  const accent = [112, 202, 168];
  const buffer = Buffer.alloc(width * height * 3);
  for (let index = 0; index < buffer.length; index += 3) {
    buffer[index] = background[0];
    buffer[index + 1] = background[1];
    buffer[index + 2] = background[2];
  }
  linesForFrame.slice(0, 16).forEach((line, index) => {
    drawText(buffer, width, height, 60, 58 + index * 40, line, index === 0 ? 4 : 3, index === 0 ? accent : foreground);
  });
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  await fs.writeFile(filePath, Buffer.concat([header, buffer]));
}

function collectToolTimeline(report) {
  const timeline = [];
  for (const result of report.tool_results ?? []) {
    const tool =
      result?.tool ??
      result?.name ??
      result?.request?.tool ??
      result?.request?.name ??
      result?.call?.tool ??
      "tool";
    const payload = result?.result ?? {};
    const reason =
      payload?.error?.reason ??
      payload?.failure_reason ??
      payload?.reason ??
      "";
    timeline.push(`${tool} -> ${toolTimelineStatus(payload)}${reason ? ` (${reason})` : ""}`);
  }
  return timeline;
}

const files = await walk(root);
const scenarioReports = [];
for (const file of files) {
  if (!file.replaceAll(path.sep, "/").endsWith("-result.json")) continue;
  const report = await readJson(file);
  const assertions = Array.isArray(report.final_assertions) ? report.final_assertions : [];
  scenarioReports.push({
    path: rel(file),
    scenario: report.scenario ?? path.basename(file).replace(/-result\.json$/, ""),
    runtime: report.runtime ?? report.connect?.hello?.server?.loader ?? "unknown",
    passed: report.passed,
    assertions: assertions.length,
    failedAssertions: assertions
      .filter((assertion) => assertion?.passed === false)
      .map((assertion) => assertion?.name ?? assertion?.kind ?? "unnamed_assertion"),
    timeline: collectToolTimeline(report),
    parseError: report.__parseError,
  });
}

const resolvedBranch = await gitBranch();
await fs.mkdir(outputDir, { recursive: true });

const summaryPath = path.join(outputDir, "acceptance-summary.md");
const mp4Path = path.join(outputDir, "acceptance.mp4");
const unavailablePath = path.join(outputDir, "acceptance.mp4.unavailable.txt");
const framePath = path.join(outputDir, "acceptance-frame.ppm");

const lines = [];
lines.push("# MineLink Acceptance Artifact Summary");
lines.push("");
lines.push(`- Generated: \`${new Date().toISOString()}\``);
lines.push(`- Task id: \`${taskId}\``);
lines.push(`- Branch: \`${resolvedBranch}\``);
lines.push(`- PR: ${prUrl ? `[${prUrl}](${prUrl})` : "`unknown`"}`);
lines.push(`- Evidence root: \`${root}\``);
lines.push(`- Scenario reports: \`${scenarioReports.length}\``);
lines.push(`- Task requirements: \`${taskRequirements || "unspecified"}\``);
lines.push("");
lines.push("## Acceptance Boundary");
lines.push("");
lines.push(
  "This is a trace-driven evidence artifact. It does not prove client GUI perception, and it does not upgrade mock, replay, smoke, or short-soak evidence to `product-accepted`.",
);
lines.push("");
lines.push("## Scenario Results");
lines.push("");
if (scenarioReports.length === 0) {
  lines.push("- No scenario reports found.");
} else {
  lines.push("| Result | Runtime | Scenario | Assertions | Failed Assertions | Report |");
  lines.push("| --- | --- | --- | ---: | --- | --- |");
  for (const report of scenarioReports) {
    const failed = report.parseError ?? (report.failedAssertions.join(", ") || "none");
    lines.push(
      `| ${md(status(report.passed))} | ${md(report.runtime)} | ${md(report.scenario)} | ${report.assertions} | ${md(failed)} | \`${md(report.path)}\` |`,
    );
  }
}
lines.push("");
lines.push("## Key Action Timeline");
lines.push("");
const timeline = scenarioReports.flatMap((report) =>
  report.timeline.slice(0, 8).map((entry) => `${report.scenario}: ${entry}`),
);
if (timeline.length === 0) {
  lines.push("- No action timeline entries found.");
} else {
  for (const entry of timeline.slice(0, 24)) {
    lines.push(`- ${entry}`);
  }
}
lines.push("");
lines.push("## Remaining Gaps");
lines.push("");
lines.push("- Human review must compare these artifacts with the task contract.");
lines.push("- Real game claims still require real NeoForge reports.");
lines.push("- GUI/client-video evidence remains future observer-client work.");
lines.push("");

await fs.writeFile(summaryPath, `${lines.join("\n")}\n`);

const videoLines = [
  "MineLink Acceptance Evidence",
  `Task: ${taskId}`,
  `Branch: ${resolvedBranch}`,
  `PR: ${prUrl || "unknown"}`,
  `Task: ${taskRequirements || "requirements unspecified"}`,
  `Reports: ${scenarioReports.length}`,
  ...scenarioReports.slice(0, 8).map((report) => `${report.scenario}: ${status(report.passed)} (${report.runtime})`),
  "Boundary: trace-driven artifact, not product acceptance",
];

try {
  await writePpmFrame(framePath, videoLines);
  await execFileAsync("ffmpeg", [
    "-y",
    "-loop",
    "1",
    "-t",
    "10",
    "-i",
    framePath,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    mp4Path,
  ]);
  await fs.rm(unavailablePath, { force: true });
  console.log(`Wrote ${summaryPath}`);
  console.log(`Wrote ${mp4Path}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await fs.writeFile(
    unavailablePath,
    `acceptance.mp4 was not rendered because ffmpeg was unavailable or failed.\n\n${message}\n`,
  );
  console.log(`Wrote ${summaryPath}`);
  console.log(`MP4 unavailable; wrote ${unavailablePath}`);
  if (requireMp4) {
    process.exit(1);
  }
}
