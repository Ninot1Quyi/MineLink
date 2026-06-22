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
let producer =
  process.env.MINELINK_ACCEPTANCE_VIDEO_PRODUCER ??
  (process.env.ONA_ENVIRONMENT_ID || process.env.GITPOD_WORKSPACE_ID
    ? "ona-environment"
    : process.env.GITHUB_ACTIONS
      ? "github-actions"
      : "local");
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
  } else if (arg === "--producer") {
    producer = process.argv[++index] ?? "";
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
if (!producer) {
  console.error("--producer cannot be empty");
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

function fillRect(buffer, width, height, x, y, rectWidth, rectHeight, color) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(width, Math.ceil(x + rectWidth));
  const bottom = Math.min(height, Math.ceil(y + rectHeight));
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      setPixel(buffer, width, px, py, color);
    }
  }
}

function strokeRect(buffer, width, height, x, y, rectWidth, rectHeight, color) {
  fillRect(buffer, width, height, x, y, rectWidth, 2, color);
  fillRect(buffer, width, height, x, y + rectHeight - 2, rectWidth, 2, color);
  fillRect(buffer, width, height, x, y, 2, rectHeight, color);
  fillRect(buffer, width, height, x + rectWidth - 2, y, 2, rectHeight, color);
}

function wrapText(value, maxChars) {
  const words = ffmpegText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word.slice(0, maxChars);
    } else if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word.slice(0, maxChars);
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function drawTextBlock(buffer, width, height, x, y, textLines, options = {}) {
  const scale = options.scale ?? 2;
  const color = options.color ?? [238, 244, 248];
  const maxWidth = options.maxWidth ?? width - x - 20;
  const lineGap = options.lineGap ?? Math.ceil(9 * scale);
  const maxLines = options.maxLines ?? 12;
  const maxChars = Math.max(1, Math.floor(maxWidth / (6 * scale)));
  let cursorY = y;
  let drawn = 0;
  for (const rawLine of textLines) {
    for (const line of wrapText(rawLine, maxChars)) {
      if (drawn >= maxLines) return cursorY;
      drawText(buffer, width, height, x, cursorY, line, scale, color);
      cursorY += lineGap;
      drawn += 1;
    }
  }
  return cursorY;
}

function createFrameBuffer(width, height, background) {
  const buffer = Buffer.alloc(width * height * 3);
  for (let index = 0; index < buffer.length; index += 3) {
    buffer[index] = background[0];
    buffer[index + 1] = background[1];
    buffer[index + 2] = background[2];
  }
  return buffer;
}

async function writePpmBuffer(filePath, width, height, buffer) {
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

function toolName(result) {
  return (
    result?.tool ??
    result?.name ??
    result?.request?.tool ??
    result?.request?.name ??
    result?.call?.tool ??
    "tool"
  );
}

function extractObservation(report) {
  for (const result of report.tool_results ?? []) {
    const payload = result?.result ?? result?.response ?? {};
    const scene = payload?.visible_scene ?? payload?.scene ?? {};
    const visibleBlocks = Array.isArray(scene?.visible_blocks) ? scene.visible_blocks : [];
    if (visibleBlocks.length === 0 && !payload?.self && !scene?.self) continue;
    return {
      tool: toolName(result),
      self: payload?.self ?? scene?.self ?? null,
      visibleBlocks,
    };
  }
  return {
    tool: "none",
    self: null,
    visibleBlocks: [],
  };
}

function summarizeInventory(report) {
  const inventory = report.final_inventory;
  if (!inventory) return [];
  if (Array.isArray(inventory)) {
    return inventory
      .filter((item) => item && (item.id || item.item || item.count))
      .slice(0, 8)
      .map((item) => `${item.id ?? item.item ?? "item"} x${item.count ?? "?"}`);
  }
  if (typeof inventory === "object") {
    return Object.entries(inventory)
      .slice(0, 8)
      .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value).slice(0, 36) : value}`);
  }
  return [String(inventory).slice(0, 80)];
}

function reportDirectory(filePath) {
  return path.dirname(path.dirname(filePath));
}

function resolveEvidencePath(reportFile, evidencePath) {
  if (!evidencePath) return "";
  if (path.isAbsolute(evidencePath)) return evidencePath;
  const reportRoot = reportDirectory(reportFile);
  const normalized = evidencePath.replaceAll("\\", "/");
  if (normalized.startsWith(".minelink-dev/")) {
    return path.join(root, normalized.slice(".minelink-dev/".length));
  }
  return path.resolve(reportRoot, evidencePath);
}

function inferLogPaths(reportFile, report) {
  const candidates = [];
  for (const key of [
    "agent_log",
    "host_log",
    "server_stdout_log",
    "server_stderr_log",
    "gateway_stdout_log",
    "gateway_stderr_log",
    "server_log",
  ]) {
    const value = report.evidence_paths?.[key];
    if (value) candidates.push(resolveEvidencePath(reportFile, value));
  }
  const logsDir = path.join(reportDirectory(reportFile), "logs");
  for (const name of [
    "agent.log",
    "host.log",
    "server.stdout.log",
    "server.stderr.log",
    "gateway.stdout.log",
    "gateway.stderr.log",
    "server.log",
  ]) {
    candidates.push(path.join(logsDir, name));
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function readTail(filePath, maxLines) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-maxLines);
  } catch {
    return [];
  }
}

async function collectTerminalLines(reportFile, report) {
  const lines = [];
  lines.push(`COMMAND PATH: scripts/dev/e2e.sh ${report.scenario ?? "scenario"}`);
  lines.push(`RUNTIME: ${report.runtime ?? report.connect?.hello?.server?.loader ?? "unknown"}`);
  lines.push(`RESULT: ${status(report.passed)}`);
  lines.push(`ASSERTIONS: ${(report.final_assertions ?? []).length}`);
  for (const entry of collectToolTimeline(report).slice(0, 8)) {
    lines.push(`TOOL: ${entry}`);
  }
  for (const logPath of inferLogPaths(reportFile, report).slice(0, 5)) {
    const tail = await readTail(logPath, 3);
    if (tail.length === 0) continue;
    lines.push(`[${path.basename(logPath)}]`);
    lines.push(...tail.map((line) => line.slice(0, 110)));
  }
  return lines.slice(0, 28);
}

function assertionLines(report) {
  const assertions = Array.isArray(report.final_assertions) ? report.final_assertions : [];
  return assertions.slice(0, 8).map((assertion) => {
    const name = assertion?.name ?? assertion?.kind ?? assertion?.id ?? "assertion";
    return `${status(assertion?.passed)} ${name}`;
  });
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
    terminal: await collectTerminalLines(file, report),
    observation: extractObservation(report),
    assertionLines: assertionLines(report),
    inventory: summarizeInventory(report),
    parseError: report.__parseError,
  });
}
scenarioReports.sort((left, right) => {
  const score = (report) =>
    (report.observation.visibleBlocks.length > 0 ? 100 : 0) +
    (report.runtime === "neoforge" ? 10 : 0) +
    (report.passed ? 1 : 0);
  return score(right) - score(left) || left.scenario.localeCompare(right.scenario) || left.path.localeCompare(right.path);
});

const resolvedBranch = await gitBranch();
await fs.mkdir(outputDir, { recursive: true });

const summaryPath = path.join(outputDir, "acceptance-summary.md");
const mp4Path = path.join(outputDir, "acceptance.mp4");
const unavailablePath = path.join(outputDir, "acceptance.mp4.unavailable.txt");
const framePath = path.join(outputDir, "acceptance-frame.ppm");
const originJsonPath = path.join(outputDir, "acceptance-video-origin.json");
const originMdPath = path.join(outputDir, "acceptance-video-origin.md");

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
lines.push(`- Video producer: \`${producer}\``);
lines.push("- Video mode: `composite server-observation + terminal-log evidence`");
lines.push("- Client GUI capture: `no`");
lines.push("");
lines.push("## Acceptance Boundary");
lines.push("");
lines.push(
  "This is a trace-driven evidence artifact rendered from MineLink reports, tool timelines, server observations, and terminal logs. It is not a Minecraft client GUI recording unless a separate client-capture artifact is attached, and it does not upgrade mock, replay, smoke, or short-soak evidence to `product-accepted`.",
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

const generatedAt = new Date().toISOString();
const origin = {
  generatedAt,
  taskId,
  branch: resolvedBranch,
  producer,
  videoKind: "composite-report-log-video",
  clientGuiCapture: false,
  scenarioReports: scenarioReports.length,
  runtime: {
    githubActions: process.env.GITHUB_ACTIONS === "true",
    githubRunId: process.env.GITHUB_RUN_ID ?? "",
    onaEnvironmentId: process.env.ONA_ENVIRONMENT_ID ?? "",
    gitpodWorkspaceId: process.env.GITPOD_WORKSPACE_ID ?? "",
  },
  boundary:
    producer.startsWith("github-actions")
      ? "GitHub Actions generated this trace-driven composite video; it is not an Ona-produced final acceptance recording."
      : "Acceptance video origin metadata; product acceptance still depends on the requested gate evidence.",
};
await fs.writeFile(originJsonPath, `${JSON.stringify(origin, null, 2)}\n`, "utf8");
await fs.writeFile(
  originMdPath,
  [
    "# MineLink Acceptance Video Origin",
    "",
    `- Generated: \`${generatedAt}\``,
    `- Task id: \`${taskId}\``,
    `- Branch: \`${resolvedBranch}\``,
    `- Producer: \`${producer}\``,
    `- Video kind: \`${origin.videoKind}\``,
    `- Client GUI capture: \`${origin.clientGuiCapture ? "yes" : "no"}\``,
    `- Scenario reports: \`${origin.scenarioReports}\``,
    `- GitHub Actions: \`${origin.runtime.githubActions ? "yes" : "no"}\``,
    `- GitHub run id: \`${origin.runtime.githubRunId || "none"}\``,
    `- Ona environment id: \`${origin.runtime.onaEnvironmentId || "none"}\``,
    `- Boundary: \`${origin.boundary}\``,
    "",
  ].join("\n"),
  "utf8",
);

const colors = {
  background: [10, 19, 27],
  panel: [18, 31, 42],
  panelAlt: [12, 23, 32],
  border: [77, 103, 125],
  text: [238, 244, 248],
  muted: [145, 164, 178],
  accent: [112, 202, 168],
  warning: [242, 160, 96],
  danger: [240, 96, 96],
  ok: [120, 210, 136],
  terminal: [184, 240, 198],
};

function blockColor(blockId) {
  const id = String(blockId ?? "");
  if (id.includes("log")) return [142, 92, 56];
  if (id.includes("leaves") || id.includes("sapling")) return [78, 155, 86];
  if (id.includes("chest") || id.includes("crafting_table")) return [191, 145, 74];
  if (id.includes("furnace") || id.includes("lava")) return [225, 111, 64];
  if (id.includes("water")) return [80, 146, 220];
  if (id.includes("obsidian") || id.includes("portal")) return [120, 84, 180];
  if (id.includes("create:")) return [82, 154, 184];
  return [150, 160, 165];
}

function drawPanel(buffer, width, height, x, y, rectWidth, rectHeight, title) {
  fillRect(buffer, width, height, x, y, rectWidth, rectHeight, colors.panel);
  strokeRect(buffer, width, height, x, y, rectWidth, rectHeight, colors.border);
  fillRect(buffer, width, height, x, y, rectWidth, 36, colors.panelAlt);
  drawText(buffer, width, height, x + 14, y + 10, title, 2, colors.accent);
}

function drawObservationMap(buffer, width, height, report, x, y, rectWidth, rectHeight) {
  fillRect(buffer, width, height, x, y, rectWidth, rectHeight, [8, 15, 20]);
  strokeRect(buffer, width, height, x, y, rectWidth, rectHeight, [46, 72, 88]);
  const observation = report?.observation;
  const self = observation?.self;
  const blocks = observation?.visibleBlocks ?? [];
  const centerX = x + Math.floor(rectWidth / 2);
  const centerY = y + Math.floor(rectHeight / 2);
  fillRect(buffer, width, height, centerX - 6, centerY - 6, 12, 12, colors.accent);
  drawText(buffer, width, height, x + 12, y + 12, "TOP DOWN SERVER OBSERVATION", 1, colors.muted);
  if (!self || blocks.length === 0) {
    drawTextBlock(buffer, width, height, x + 24, y + 64, ["NO OBSERVE.SCENE BLOCK MAP FOUND"], {
      scale: 2,
      color: colors.warning,
      maxWidth: rectWidth - 48,
      maxLines: 2,
    });
    return;
  }
  for (const block of blocks.slice(0, 48)) {
    const position = block.position ?? {};
    const dx = Number(position.x ?? 0) - Number(self.x ?? 0);
    const dz = Number(position.z ?? 0) - Number(self.z ?? 0);
    const px = Math.round(centerX + dx * 8);
    const py = Math.round(centerY + dz * 8);
    fillRect(buffer, width, height, px - 4, py - 4, 8, 8, blockColor(block.id));
  }
  drawText(buffer, width, height, centerX + 10, centerY - 4, "AGENT", 1, colors.accent);
}

function formatPosition(position) {
  if (!position) return "unknown";
  return `x${Number(position.x ?? 0).toFixed(1)} y${Number(position.y ?? 0).toFixed(1)} z${Number(position.z ?? 0).toFixed(1)}`;
}

function drawCompositeFrame(filePath, frameIndex, frameCount) {
  const width = 1280;
  const height = 720;
  const buffer = createFrameBuffer(width, height, colors.background);
  const report = scenarioReports.length > 0 ? scenarioReports[frameIndex % scenarioReports.length] : null;
  const titleColor = scenarioReports.length > 0 ? colors.accent : colors.danger;
  drawText(buffer, width, height, 28, 24, "MINELINK ACCEPTANCE EVIDENCE", 3, titleColor);
  drawTextBlock(
    buffer,
    width,
    height,
    28,
    62,
    [
      `TASK ${taskId}`,
      `BRANCH ${resolvedBranch}`,
      `PRODUCER ${producer}`,
      `REPORTS ${scenarioReports.length}`,
    ],
    { scale: 1, color: colors.muted, maxWidth: 800, maxLines: 3, lineGap: 14 },
  );
  drawText(buffer, width, height, 1092, 30, `FRAME ${frameIndex + 1}/${frameCount}`, 2, colors.muted);

  drawPanel(buffer, width, height, 28, 102, 790, 572, "GAME / SERVER EVIDENCE");
  drawPanel(buffer, width, height, 846, 102, 406, 572, "TERMINAL / ASSERTIONS");

  if (!report) {
    drawTextBlock(
      buffer,
      width,
      height,
      64,
      176,
      [
        "BLOCKED PLACEHOLDER VIDEO",
        "NO SCENARIO REPORTS WERE FOUND",
        "RELEASE GATE MUST FAIL THIS ARTIFACT",
      ],
      { scale: 3, color: colors.danger, maxWidth: 700, maxLines: 5, lineGap: 34 },
    );
    drawTextBlock(
      buffer,
      width,
      height,
      872,
      160,
      [
        "Scenario reports: 0",
        "No action timeline entries found",
        "This cannot be final acceptance evidence",
      ],
      { scale: 2, color: colors.terminal, maxWidth: 350, maxLines: 12, lineGap: 22 },
    );
    return writePpmBuffer(filePath, width, height, buffer);
  }

  const resultColor = report.passed ? colors.ok : colors.danger;
  drawText(buffer, width, height, 54, 154, `SCENARIO ${report.scenario}`, 2, colors.text);
  drawText(buffer, width, height, 54, 180, `RUNTIME ${report.runtime}`, 2, colors.muted);
  drawText(buffer, width, height, 54, 206, `RESULT ${status(report.passed)}`, 2, resultColor);
  drawText(buffer, width, height, 54, 232, `ASSERTIONS ${report.assertions}`, 2, colors.muted);

  drawObservationMap(buffer, width, height, report, 54, 270, 360, 220);
  const observation = report.observation;
  const blockLines = [
    `OBSERVE TOOL ${observation?.tool ?? "none"}`,
    `SELF ${formatPosition(observation?.self)}`,
    `VISIBLE BLOCKS ${(observation?.visibleBlocks ?? []).length}`,
    ...(observation?.visibleBlocks ?? [])
      .slice(0, 8)
      .map((block) => `${block.id ?? "block"} d${Number(block.distance ?? 0).toFixed(1)} ${block.block_ref ?? ""}`),
  ];
  drawTextBlock(buffer, width, height, 438, 270, blockLines, {
    scale: 2,
    color: colors.text,
    maxWidth: 342,
    maxLines: 11,
    lineGap: 22,
  });

  const assertionPanelLines = [
    "KEY ASSERTIONS",
    ...(report.assertionLines.length > 0 ? report.assertionLines : ["no final assertions listed"]),
    "FINAL INVENTORY",
    ...(report.inventory.length > 0 ? report.inventory : ["inventory not recorded"]),
  ];
  drawTextBlock(buffer, width, height, 54, 518, assertionPanelLines, {
    scale: 2,
    color: colors.text,
    maxWidth: 720,
    maxLines: 7,
    lineGap: 22,
  });

  const terminalLines = report.terminal.length > 0 ? report.terminal : ["no terminal log lines found"];
  const scroll = terminalLines.length > 19 ? (frameIndex * 2) % terminalLines.length : 0;
  const visibleTerminal = [...terminalLines.slice(scroll), ...terminalLines.slice(0, scroll)].slice(0, 20);
  drawTextBlock(buffer, width, height, 870, 154, visibleTerminal, {
    scale: 2,
    color: colors.terminal,
    maxWidth: 350,
    maxLines: 20,
    lineGap: 22,
  });

  fillRect(buffer, width, height, 846, 656, 406, 18, [7, 13, 18]);
  fillRect(buffer, width, height, 846, 656, Math.floor((406 * (frameIndex + 1)) / frameCount), 18, colors.accent);
  return writePpmBuffer(filePath, width, height, buffer);
}

try {
  const framesDir = path.join(outputDir, "acceptance-frames");
  await fs.rm(framesDir, { recursive: true, force: true });
  await fs.mkdir(framesDir, { recursive: true });
  const frameCount = Math.max(10, Math.min(24, scenarioReports.length * 3 || 10));
  for (let index = 0; index < frameCount; index += 1) {
    const numberedFramePath = path.join(framesDir, `frame-${String(index + 1).padStart(3, "0")}.ppm`);
    await drawCompositeFrame(numberedFramePath, index, frameCount);
    if (index === 0) {
      await fs.copyFile(numberedFramePath, framePath);
    }
  }
  await execFileAsync("ffmpeg", [
    "-y",
    "-framerate",
    "1",
    "-i",
    path.join(framesDir, "frame-%03d.ppm"),
    "-r",
    "24",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    mp4Path,
  ]);
  await fs.rm(framesDir, { recursive: true, force: true });
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
