#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let summaryPath = ".minelink-dev/reports/artifacts/acceptance-summary.md";
let mp4Path = ".minelink-dev/reports/artifacts/acceptance.mp4";
let originPath = ".minelink-dev/reports/artifacts/acceptance-video-origin.json";
let manifestPath = ".minelink-dev/reports/artifacts/video-storage-manifest.json";
let outputPath = ".minelink-dev/reports/artifacts/video-review-request.md";
let taskId = process.env.MINELINK_TASK_ID ?? "local";
let branch = process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME ?? "";
let taskRequirements = process.env.MINELINK_TASK_REQUIREMENTS ?? "";
let requireMp4 = false;
let requireClientGuiCapture = false;
let requireStorageManifest = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--summary") {
    summaryPath = process.argv[++index] ?? "";
  } else if (arg === "--mp4") {
    mp4Path = process.argv[++index] ?? "";
  } else if (arg === "--origin") {
    originPath = process.argv[++index] ?? "";
  } else if (arg === "--manifest") {
    manifestPath = process.argv[++index] ?? "";
  } else if (arg === "--output") {
    outputPath = process.argv[++index] ?? "";
  } else if (arg === "--task-id") {
    taskId = process.argv[++index] ?? "";
  } else if (arg === "--branch") {
    branch = process.argv[++index] ?? "";
  } else if (arg === "--task-requirements") {
    taskRequirements = process.argv[++index] ?? "";
  } else if (arg === "--require-mp4") {
    requireMp4 = true;
  } else if (arg === "--require-client-gui-capture") {
    requireClientGuiCapture = true;
  } else if (arg === "--require-storage-manifest") {
    requireStorageManifest = true;
  } else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/prepare-video-review-request.mjs [--require-mp4] [--require-client-gui-capture]

Creates the handoff package for the dedicated Ona Platform Codex video
verifier. The request includes current artifact hashes and the exact verifier
markers that check-video-review.mjs will enforce.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!summaryPath || !mp4Path || !outputPath || !taskId) {
  console.error("--summary, --mp4, --output, and --task-id cannot be empty");
  process.exit(2);
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

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
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

async function ffprobe(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,r_frame_rate,duration",
      "-show_entries",
      "format=size",
      "-of",
      "default=noprint_wrappers=1",
      filePath,
    ]);
    return stdout.trim() || "ffprobe returned no metadata";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `ffprobe unavailable or failed: ${message}`;
  }
}

function md(value) {
  return String(value ?? "").replaceAll("\r", "").trim();
}

const summaryStat = await stat(summaryPath);
const mp4Stat = await stat(mp4Path);
const failures = [];

if (!summaryStat?.isFile() || summaryStat.size === 0) {
  failures.push(`Missing acceptance summary: ${summaryPath}`);
}

if (requireMp4 && (!mp4Stat?.isFile() || mp4Stat.size === 0)) {
  failures.push(`Missing required acceptance MP4: ${mp4Path}`);
}

const summaryHash = summaryStat?.isFile() ? await sha256(summaryPath) : "missing";
const mp4Hash = mp4Stat?.isFile() ? await sha256(mp4Path) : "missing";
const mp4Metadata = mp4Stat?.isFile() ? await ffprobe(mp4Path) : "missing";
const origin = await readJson(originPath);
const storageManifest = await readJson(manifestPath);
const producer = origin?.producer ?? "unknown";
const videoKind = origin?.videoKind ?? "unknown";
const clientGuiCapture = origin?.clientGuiCapture === true;
const clientWorldReady = origin?.clientWorldReady === true;
const captureStartedAfterWorldReady = origin?.captureStartedAfterWorldReady === true;
const resolvedBranch = await gitBranch();

if (requireClientGuiCapture) {
  if (!origin) {
    failures.push(`Missing acceptance video origin metadata: ${originPath}`);
  } else if (!clientGuiCapture) {
    failures.push(
      `Acceptance video is ${videoKind} with clientGuiCapture=false; normal Minecraft client footage is required`,
    );
  } else {
    if (!clientWorldReady) {
      failures.push("Acceptance video origin does not confirm the recorder client reached an in-world Minecraft view");
    }
    if (!captureStartedAfterWorldReady) {
      failures.push("Acceptance video origin does not confirm capture started after the recorder client reached the world");
    }
  }
}

if (requireStorageManifest) {
  if (!storageManifest) {
    failures.push(`Missing required video storage manifest: ${manifestPath}`);
  } else {
    if (storageManifest.mp4Sha256 !== mp4Hash) {
      failures.push(`Video storage manifest MP4 hash mismatch: ${storageManifest.mp4Sha256 || "missing"}`);
    }
    if (storageManifest.summarySha256 !== summaryHash) {
      failures.push(`Video storage manifest summary hash mismatch: ${storageManifest.summarySha256 || "missing"}`);
    }
    if (storageManifest.producer && storageManifest.producer !== producer) {
      failures.push(`Video storage manifest producer mismatch: ${storageManifest.producer}`);
    }
    if (requireClientGuiCapture && storageManifest.clientGuiCapture !== true) {
      failures.push("Video storage manifest does not confirm clientGuiCapture=true");
    }
    if (requireClientGuiCapture && storageManifest.clientWorldReady !== true) {
      failures.push("Video storage manifest does not confirm clientWorldReady=true");
    }
    if (requireClientGuiCapture && storageManifest.captureStartedAfterWorldReady !== true) {
      failures.push("Video storage manifest does not confirm captureStartedAfterWorldReady=true");
    }
  }
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });

const lines = [
  "# MineLink Acceptance Video Review Request",
  "",
  `- Generated: \`${new Date().toISOString()}\``,
  `- Task id: \`${md(taskId)}\``,
  `- Branch: \`${md(resolvedBranch)}\``,
  `- Task requirements: \`${md(taskRequirements || "unspecified")}\``,
  `- Acceptance summary: \`${summaryPath}\``,
  `- Acceptance MP4: \`${mp4Path}\``,
  `- Acceptance video origin: \`${originPath}\``,
  `- Video storage manifest: \`${manifestPath}\``,
  `- Video producer: \`${md(producer)}\``,
  `- Video kind: \`${md(videoKind)}\``,
  `- Client GUI capture: \`${clientGuiCapture ? "yes" : "no"}\``,
  `- Client world ready: \`${clientWorldReady ? "yes" : "no"}\``,
  `- Capture started after world ready: \`${captureStartedAfterWorldReady ? "yes" : "no"}\``,
  `- Client GUI capture required: \`${requireClientGuiCapture ? "yes" : "no"}\``,
  `- Storage manifest required: \`${requireStorageManifest ? "yes" : "no"}\``,
  `- Storage provider: \`${md(storageManifest?.storageProvider || "none")}\``,
  `- Storage object: \`${md(storageManifest?.objectKey || "none")}\``,
  `- Storage video URL: ${storageManifest?.videoUrl || "none"}`,
  `- Summary sha256: \`${summaryHash}\``,
  `- MP4 sha256: \`${mp4Hash}\``,
  `- MP4 metadata: \`${md(mp4Metadata).replaceAll("\n", "; ")}\``,
  `- Request status: \`${failures.length === 0 ? "ready" : "blocked"}\``,
  "",
  "## Verifier Assignment",
  "",
  "Use the current Ona Platform Codex implementation session, not the default Ona Agent, to launch a bounded native Codex verifier subagent that reviews the acceptance summary and MP4 against the task requirements. The verifier must not edit product code and must not re-render the video. It must inspect the artifacts above and write `.minelink-dev/reports/artifacts/video-review.md`.",
  "",
  "For R2-backed candidate videos, the manifest URL is candidate evidence transport only. The verifier must compare the task requirements, acceptance summary, manifest hashes, and MP4 hash; it must not treat storage upload as release approval.",
  "",
  "The review file must include these exact markers with the current hashes:",
  "",
  "```text",
  "Verifier: Ona Platform Codex",
  "Release decision: pass|fail",
  "Task matched: yes|no",
  "Video matched: yes|no",
  `Video producer: ${producer}`,
  `Client GUI capture: ${requireClientGuiCapture ? "yes" : "yes|no"}`,
  `Summary sha256: ${summaryHash}`,
  `MP4 sha256: ${mp4Hash}`,
  "```",
  "",
  "After `video-review.md` is written, run:",
  "",
  "```bash",
  `node scripts/dev/check-video-review.mjs --require-mp4${requireClientGuiCapture ? " --require-client-gui-capture" : ""}`,
  "```",
  "",
  "## Release Boundary",
  "",
  "- A ready request does not release the task.",
  "- A decodable MP4 does not prove full MineLink product completion.",
  "- The release gate passes only after the same-session Ona Platform Codex verifier subagent writes a matching review and `check-video-review.mjs` succeeds.",
  "",
  "## Request Failures",
  "",
  ...(failures.length === 0 ? ["- none"] : failures.map((failure) => `- ${failure}`)),
  "",
];

await fs.writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");

if (failures.length > 0) {
  console.error(`Video review request is blocked; wrote ${outputPath}`);
  process.exit(1);
}

console.log(`Wrote ${outputPath}`);
