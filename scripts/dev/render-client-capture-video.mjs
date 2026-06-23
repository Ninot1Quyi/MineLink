#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaults = {
  clientVideo: "",
  report: "",
  logDir: "",
  outputDir: ".minelink-dev/reports/artifacts",
  taskId: process.env.MINELINK_TASK_ID ?? process.env.GITHUB_RUN_ID ?? "local",
  branch: process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME ?? "",
  producer: process.env.MINELINK_ACCEPTANCE_VIDEO_PRODUCER ?? "ona-task-finalizer",
  requireMp4: false,
};

const args = { ...defaults };

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--client-video") args.clientVideo = readValue();
  else if (arg === "--report") args.report = readValue();
  else if (arg === "--log-dir") args.logDir = readValue();
  else if (arg === "--output-dir") args.outputDir = readValue();
  else if (arg === "--task-id") args.taskId = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--producer") args.producer = readValue();
  else if (arg === "--require-mp4") args.requireMp4 = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/render-client-capture-video.mjs --client-video path --report path --log-dir path [--require-mp4]

Creates MineLink acceptance artifacts from a real Minecraft client capture and
the matching e2e report/logs. The output MP4 is a 1280x720 composite: the left
960px are the Minecraft client view, and the right 320px are terminal evidence.
This is the only renderer that may set clientGuiCapture=true.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!args.clientVideo || !args.report || !args.logDir || !args.outputDir) {
  console.error("--client-video, --report, --log-dir, and --output-dir are required");
  process.exit(2);
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function stat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function ffprobeDuration(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const duration = Number.parseFloat(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 10;
  } catch {
    return 10;
  }
}

function tailLines(text, maxLines) {
  return String(text ?? "")
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-maxLines);
}

function compact(value, maxLength = 74) {
  const text = String(value ?? "").replaceAll("`", "'").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function displayValue(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const report = await readJson(args.report);
const clientVideoStat = await stat(args.clientVideo);
const failures = [];

if (!clientVideoStat?.isFile() || clientVideoStat.size === 0) {
  failures.push(`Missing client capture MP4: ${args.clientVideo}`);
}
if (!report) {
  failures.push(`Missing or invalid scenario report: ${args.report}`);
}

await fs.mkdir(args.outputDir, { recursive: true });

const scenario = report?.scenario ?? "unknown";
const runtime = report?.runtime ?? "unknown";
const passed = report?.passed === true;
const finalAssertions = Array.isArray(report?.final_assertions) ? report.final_assertions : [];
const toolResults = Array.isArray(report?.tool_results) ? report.tool_results : [];
const failedTools = toolResults.filter((item) => {
  const result = item?.result ?? {};
  return result.ok === false || result.status === "failed" || result.status === "blocked" || result.error;
});
const reportHash = report ? await sha256(args.report) : "missing";

const agentLog = await readText(path.join(args.logDir, "agent.log"));
const serverStdout = await readText(path.join(args.logDir, "server.stdout.log"));
const serverStderr = await readText(path.join(args.logDir, "server.stderr.log"));
const clientStdout = await readText(path.join(args.logDir, "client.stdout.log"));
const clientStderr = await readText(path.join(args.logDir, "client.stderr.log"));
const serverLogText = `${serverStdout}\n${serverStderr}`;
const clientLogText = `${clientStdout}\n${clientStderr}`;
const clientReadyLog = await readText(path.join(args.logDir, "client-capture-ready.log"));
const clientWorldReady =
  /(?:^|\n)clientWorldReady=true(?:\n|$)/.test(clientReadyLog) ||
  clientReadyLog.includes("MineLink recorder client in world confirmed");
const captureStartedAfterWorldReady =
  /(?:^|\n)captureStartedAfterWorldReady=true(?:\n|$)/.test(clientReadyLog) ||
  clientReadyLog.includes("ffmpeg started after recorder client world-ready");
const recorderAutoFollow =
  /(?:^|\n)recorderAutoFollow=true(?:\n|$)/.test(clientReadyLog) ||
  serverLogText.includes("MineLink recorder auto-follow active");
const recorderClientFollow =
  /(?:^|\n)recorderClientFollow=true(?:\n|$)/.test(clientReadyLog) ||
  clientLogText.includes("MineLink recorder client following server_agent");
const recorderClientTargetCentered =
  /(?:^|\n)recorderClientTargetCentered=true(?:\n|$)/.test(clientReadyLog) ||
  clientLogText.includes("MineLink recorder client target centered server_agent");

if (!clientWorldReady) {
  failures.push("Recorder client did not confirm an in-world Minecraft view before acceptance rendering");
}
if (!captureStartedAfterWorldReady) {
  failures.push("Client capture did not start after the recorder client reached the Minecraft world");
}
if (!recorderAutoFollow) {
  failures.push("Recorder client did not confirm auto-follow camera binding to the active server_agent");
}
if (!recorderClientFollow) {
  failures.push("Recorder client did not confirm a visible client-side follow target for the active server_agent");
}
if (!recorderClientTargetCentered) {
  failures.push("Recorder client did not confirm the active server_agent target is centered in the client view");
}

const terminalLines = [
  "MINELINK CLIENT ACCEPTANCE",
  `task: ${compact(args.taskId, 34)}`,
  `scenario: ${compact(scenario, 28)}`,
  `runtime: ${compact(runtime, 30)}`,
  `result: ${passed ? "PASS" : "FAIL"}`,
  `world ready: ${clientWorldReady ? "YES" : "NO"}`,
  `capture after ready: ${captureStartedAfterWorldReady ? "YES" : "NO"}`,
  `auto follow: ${recorderAutoFollow ? "YES" : "NO"}`,
  `client follow: ${recorderClientFollow ? "YES" : "NO"}`,
  `target centered: ${recorderClientTargetCentered ? "YES" : "NO"}`,
  `report sha256: ${reportHash.slice(0, 12)}`,
  "",
  "assertions:",
  ...(finalAssertions.length === 0
    ? ["- none"]
    : finalAssertions.slice(0, 8).map((assertion) => `- ${compact(displayValue(assertion), 34)}`)),
  "",
  "tools:",
  ...toolResults.slice(0, 8).map((item) => {
    const result = item?.result ?? {};
    return `- ${compact(item?.name ?? "tool", 14)} ${compact(result.status ?? (result.ok === false ? "failed" : "ok"), 14)}`;
  }),
  ...(failedTools.length > 0 ? ["", `failed tools: ${failedTools.length}`] : []),
  "",
  "agent log:",
  ...tailLines(agentLog, 8).map((line) => compact(line, 36)),
  "",
  "server/client:",
  ...tailLines(serverLogText, 4).map((line) => compact(line, 36)),
  ...tailLines(clientStdout, 4).map((line) => compact(line, 36)),
].slice(0, 42);

const terminalTextPath = path.join(args.outputDir, "acceptance-terminal-panel.txt");
const terminalImagePath = path.join(args.outputDir, "acceptance-terminal-panel.ppm");
await fs.writeFile(terminalTextPath, `${terminalLines.join("\n")}\n`, "utf8");

const glyphs = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11110", "00000", "00000", "00000"],
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "\\": ["10000", "01000", "01000", "00100", "00010", "00010", "00001"],
  "#": ["01010", "11111", "01010", "01010", "11111", "01010", "00000"],
  "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"],
  "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  ",": ["00000", "00000", "00000", "00000", "00110", "00100", "01000"],
  "'": ["00100", "00100", "00000", "00000", "00000", "00000", "00000"],
  "\"": ["01010", "01010", "00000", "00000", "00000", "00000", "00000"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

async function writeTerminalPanelPpm(filePath, lines) {
  const width = 320;
  const height = 720;
  const scale = 2;
  const charWidth = 6 * scale;
  const lineHeight = 9 * scale;
  const originX = 14;
  const originY = 18;
  const background = [0x0b, 0x13, 0x20];
  const foreground = [0xe8, 0xf1, 0xff];
  const accent = [0x72, 0xe0, 0xc1];
  const buffer = Buffer.alloc(width * height * 3);
  for (let index = 0; index < buffer.length; index += 3) {
    buffer[index] = background[0];
    buffer[index + 1] = background[1];
    buffer[index + 2] = background[2];
  }
  const putPixel = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 3;
    buffer[index] = color[0];
    buffer[index + 1] = color[1];
    buffer[index + 2] = color[2];
  };
  const drawGlyph = (char, x, y, color) => {
    const glyph = glyphs[char.toUpperCase()] ?? glyphs["?"];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            putPixel(x + column * scale + dx, y + row * scale + dy, color);
          }
        }
      }
    }
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const y = originY + lineIndex * lineHeight;
    if (y + 7 * scale >= height) break;
    const line = compact(lines[lineIndex], 25);
    const color = lineIndex === 0 ? accent : foreground;
    for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
      const x = originX + charIndex * charWidth;
      if (x + 5 * scale >= width) break;
      drawGlyph(line[charIndex], x, y, color);
    }
  }
  await fs.writeFile(filePath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii"), buffer]));
}

await writeTerminalPanelPpm(terminalImagePath, terminalLines);

const summaryPath = path.join(args.outputDir, "acceptance-summary.md");
const mp4Path = path.join(args.outputDir, "acceptance.mp4");
const originJsonPath = path.join(args.outputDir, "acceptance-video-origin.json");
const originMdPath = path.join(args.outputDir, "acceptance-video-origin.md");
const unavailablePath = path.join(args.outputDir, "acceptance.mp4.unavailable.txt");

const summaryLines = [
  "# MineLink Client Acceptance Video Summary",
  "",
  `- Task id: \`${args.taskId}\``,
  `- Branch: \`${args.branch || "unknown"}\``,
  `- Scenario reports: \`${report ? 1 : 0}\``,
  `- Scenario: \`${scenario}\``,
  `- Runtime: \`${runtime}\``,
  `- Passed: \`${passed ? "yes" : "no"}\``,
  "- Client GUI capture: `yes`",
  `- Client world ready: \`${clientWorldReady ? "yes" : "no"}\``,
  `- Capture started after world ready: \`${captureStartedAfterWorldReady ? "yes" : "no"}\``,
  `- Recorder auto-follow: \`${recorderAutoFollow ? "yes" : "no"}\``,
  `- Recorder client follow: \`${recorderClientFollow ? "yes" : "no"}\``,
  `- Recorder client target centered: \`${recorderClientTargetCentered ? "yes" : "no"}\``,
  "- Video kind: `minecraft-client-terminal-composite`",
  `- Client capture source: \`${args.clientVideo}\``,
  `- Report: \`${args.report}\``,
  "",
  "## Final Assertions",
  "",
  ...(finalAssertions.length === 0 ? ["- none"] : finalAssertions.map((assertion) => `- ${displayValue(assertion)}`)),
  "",
  "## Boundary",
  "",
  "- The left panel is a real Minecraft client recording from the same e2e run.",
  "- The right panel is a terminal evidence digest from the matching report and logs.",
  "- This proves the recorded scenario only; it does not upgrade unrelated MineLink gates.",
  "",
  "## Render Failures",
  "",
  ...(failures.length === 0 ? ["- none"] : failures.map((failure) => `- ${failure}`)),
  "",
];
await fs.writeFile(summaryPath, `${summaryLines.join("\n")}\n`, "utf8");

const generatedAt = new Date().toISOString();
const origin = {
  generatedAt,
  taskId: args.taskId,
  branch: args.branch || "unknown",
  producer: args.producer,
  videoKind: "minecraft-client-terminal-composite",
  clientGuiCapture: true,
  clientWorldReady,
  captureStartedAfterWorldReady,
  recorderAutoFollow,
  recorderClientFollow,
  recorderClientTargetCentered,
  scenarioReports: report ? 1 : 0,
  clientVideo: args.clientVideo,
  report: args.report,
  terminalPanel: terminalTextPath,
  terminalPanelImage: terminalImagePath,
  boundary:
    "Real Minecraft client capture plus terminal evidence from the same MineLink NeoForge e2e run; scenario-scoped acceptance only.",
};
await fs.writeFile(originJsonPath, `${JSON.stringify(origin, null, 2)}\n`, "utf8");
await fs.writeFile(
  originMdPath,
  [
    "# MineLink Acceptance Video Origin",
    "",
    `- Generated: \`${generatedAt}\``,
    `- Task id: \`${args.taskId}\``,
    `- Branch: \`${args.branch || "unknown"}\``,
    `- Producer: \`${args.producer}\``,
    "- Video kind: `minecraft-client-terminal-composite`",
    "- Client GUI capture: `yes`",
    `- Client world ready: \`${clientWorldReady ? "yes" : "no"}\``,
    `- Capture started after world ready: \`${captureStartedAfterWorldReady ? "yes" : "no"}\``,
    `- Recorder auto-follow: \`${recorderAutoFollow ? "yes" : "no"}\``,
    `- Recorder client follow: \`${recorderClientFollow ? "yes" : "no"}\``,
    `- Recorder client target centered: \`${recorderClientTargetCentered ? "yes" : "no"}\``,
    `- Scenario reports: \`${report ? 1 : 0}\``,
    `- Client video: \`${args.clientVideo}\``,
    `- Report: \`${args.report}\``,
    `- Boundary: \`${origin.boundary}\``,
    "",
  ].join("\n"),
  "utf8",
);

if (failures.length === 0) {
  try {
    const duration = Math.max(4, Math.min(120, await ffprobeDuration(args.clientVideo)));
    const filter = [
      "[0:v]fps=15,scale=960:720:force_original_aspect_ratio=decrease,pad=960:720:(ow-iw)/2:(oh-ih)/2:color=black[game]",
      "[1:v]scale=320:720[term]",
      "[game][term]hstack=inputs=2[v]",
    ].join(";");
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-i",
        args.clientVideo,
        "-loop",
        "1",
        "-i",
        terminalImagePath,
        "-filter_complex",
        filter,
        "-map",
        "[v]",
        "-an",
        "-t",
        duration.toFixed(3),
        "-pix_fmt",
        "yuv420p",
        mp4Path,
      ],
      { maxBuffer: 1024 * 1024 * 8 },
    );
    await fs.rm(unavailablePath, { force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`ffmpeg composite render failed: ${message}`);
    await fs.writeFile(unavailablePath, `${message}\n`, "utf8");
  }
}

if (failures.length > 0) {
  if (args.requireMp4) {
    console.error(`Client acceptance video render failed: ${failures.join("; ")}`);
    process.exit(1);
  }
}

console.log(`Wrote ${summaryPath}`);
console.log(`Wrote ${originJsonPath}`);
if ((await stat(mp4Path))?.isFile()) {
  console.log(`Wrote ${mp4Path}`);
}
