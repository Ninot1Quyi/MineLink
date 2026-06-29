#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const args = {
  mp4: "",
  outputJson: ".minelink-dev/reports/artifacts/acceptance-video-visual-analysis.json",
  outputMd: ".minelink-dev/reports/artifacts/acceptance-video-visual-analysis.md",
  requirePass: false,
};

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--mp4") args.mp4 = readValue();
  else if (arg === "--output-json") args.outputJson = readValue();
  else if (arg === "--output-md") args.outputMd = readValue();
  else if (arg === "--require-pass") args.requirePass = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/analyze-acceptance-video.mjs --mp4 acceptance.mp4

Extracts scaled frames and computes a lightweight MineLink acceptance-video QA
report. This guards against obvious camera jitter and static/placeholder clips;
it does not replace the playable MP4 or same-session Codex verifier.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!args.mp4) {
  console.error("--mp4 is required");
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

async function ffprobe(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-count_frames",
    "-show_entries",
    "stream=width,height,avg_frame_rate,nb_read_frames:format=duration",
    "-of",
    "json",
    filePath,
  ]);
  const payload = JSON.parse(stdout);
  const stream = payload.streams?.[0] ?? {};
  const duration = Number.parseFloat(payload.format?.duration ?? "0");
  const [num, den] = String(stream.avg_frame_rate ?? "0/1").split("/").map((value) => Number.parseFloat(value));
  const fps = Number.isFinite(num) && Number.isFinite(den) && den > 0 ? num / den : 0;
  return {
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    fps,
    frameCount: Number.parseInt(stream.nb_read_frames ?? "0", 10) || 0,
    durationSeconds: Number.isFinite(duration) ? duration : 0,
  };
}

const analyzer = String.raw`
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

frames = sorted(Path(sys.argv[1]).glob("frame-*.jpg"))
fps = float(sys.argv[2])
abrupt_threshold = float(sys.argv[3])
max_abrupt_jumps = int(sys.argv[4])
motion_threshold = float(sys.argv[5])
min_motion_ratio = float(sys.argv[6])
max_static_tail_seconds = float(sys.argv[7])
analysis_start_seconds = float(sys.argv[8])
analysis_end_seconds = float(sys.argv[9])

prev = None
diffs = []
for index, frame in enumerate(frames, 1):
    image = Image.open(frame).convert("L")
    width, height = image.size
    if width >= height * 1.65:
        game_right = int(width * 0.75)
    else:
        game_right = width
    top = int(height * 0.08)
    bottom = int(height * 0.92)
    crop = image.crop((0, top, game_right, bottom))
    if prev is not None:
        diff = ImageChops.difference(crop, prev)
        mean = ImageStat.Stat(diff).mean[0]
        diffs.append(mean)
    prev = crop

analysis_start = max(1, int(analysis_start_seconds * fps), int(fps))
analysis_end = len(diffs)
if analysis_end_seconds > 0 and fps > 0:
    analysis_end = min(analysis_end, max(analysis_start + 1, int(analysis_end_seconds * fps)))
sample = diffs[analysis_start:analysis_end] if len(diffs) > analysis_start else diffs
abrupt = [
    (idx + 1, value)
    for idx, value in enumerate(diffs)
    if idx >= analysis_start and idx < analysis_end and value >= abrupt_threshold
]
motion_count = sum(1 for value in sample if value >= motion_threshold)
motion_ratio = motion_count / len(sample) if sample else 0.0

tail_sample = diffs[:analysis_end]
static_tail = 0
for value in reversed(tail_sample):
    if value >= motion_threshold:
        break
    static_tail += 1
static_tail_seconds = static_tail / fps if fps > 0 else 0.0
last_motion_index = max(analysis_start, analysis_end - static_tail)
last_motion_seconds = last_motion_index / fps if fps > 0 else 0.0

top = sorted(
    [
        {
            "fromFrame": idx,
            "toFrame": idx + 1,
            "fromSeconds": idx / fps if fps > 0 else 0,
            "toSeconds": (idx + 1) / fps if fps > 0 else 0,
            "meanAbsDiff": value,
        }
        for idx, value in enumerate(diffs, 1)
    ],
    key=lambda item: item["meanAbsDiff"],
    reverse=True,
)[:20]

jitter_passed = len(abrupt) <= max_abrupt_jumps
motion_passed = motion_ratio >= min_motion_ratio
static_tail_passed = static_tail_seconds <= max_static_tail_seconds

print(json.dumps({
    "frameCountAnalyzed": len(frames),
    "diffCount": len(diffs),
    "analysisStartSeconds": analysis_start / fps if fps > 0 else 0,
    "analysisEndSeconds": analysis_end / fps if fps > 0 else 0,
    "analysisDiffCount": len(sample),
    "abruptJumpThreshold": abrupt_threshold,
    "abruptJumpCount": len(abrupt),
    "maxAbruptJumps": max_abrupt_jumps,
    "jitterPassed": jitter_passed,
    "motionThreshold": motion_threshold,
    "motionFrameRatio": motion_ratio,
    "minMotionFrameRatio": min_motion_ratio,
    "actionMotionCoveragePassed": motion_passed,
    "staticTailSeconds": static_tail_seconds,
    "maxStaticTailSeconds": max_static_tail_seconds,
    "staticTailPassed": static_tail_passed,
    "lastMotionSeconds": last_motion_seconds,
    "topFrameDiffs": top,
    "passed": jitter_passed and motion_passed and static_tail_passed,
}, indent=2))
`;

async function main() {
  const mp4Stat = await stat(args.mp4);
  if (!mp4Stat?.isFile() || mp4Stat.size === 0) {
    throw new Error(`MP4 is missing or empty: ${args.mp4}`);
  }
  const metadata = await ffprobe(args.mp4);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "minelink-video-analysis-"));
  try {
    const fps = Math.max(1, Math.min(15, Math.round(metadata.fps || 15)));
    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        args.mp4,
        "-vf",
        `fps=${fps},scale=320:-1`,
        "-q:v",
        "4",
        path.join(tmpDir, "frame-%05d.jpg"),
      ],
      { maxBuffer: 1024 * 1024 * 8 },
    );
    const abruptThreshold = Number.parseFloat(process.env.MINELINK_VIDEO_ABRUPT_JUMP_DIFF ?? "18");
    const maxAbruptJumps = Number.parseInt(process.env.MINELINK_VIDEO_MAX_ABRUPT_JUMPS ?? "12", 10);
    const motionThreshold = Number.parseFloat(process.env.MINELINK_VIDEO_MOTION_DIFF ?? "2");
    const minMotionRatio = Number.parseFloat(process.env.MINELINK_VIDEO_MIN_MOTION_RATIO ?? "0.08");
    const maxStaticTailSeconds = Number.parseFloat(process.env.MINELINK_VIDEO_MAX_STATIC_TAIL_SECONDS ?? "14");
    const analysisStartSeconds = Number.parseFloat(process.env.MINELINK_VIDEO_ANALYSIS_START_SECONDS ?? "0");
    const analysisEndSeconds = Number.parseFloat(process.env.MINELINK_VIDEO_ANALYSIS_END_SECONDS ?? "0");
    const { stdout } = await execFileAsync(
      "python3",
      [
        "-c",
        analyzer,
        tmpDir,
        String(fps),
        String(abruptThreshold),
        String(maxAbruptJumps),
        String(motionThreshold),
        String(minMotionRatio),
        String(maxStaticTailSeconds),
        String(Number.isFinite(analysisStartSeconds) ? analysisStartSeconds : 0),
        String(Number.isFinite(analysisEndSeconds) ? analysisEndSeconds : 0),
      ],
      { maxBuffer: 1024 * 1024 * 8 },
    );
    const report = {
      generatedAt: new Date().toISOString(),
      mp4: args.mp4,
      mp4Sha256: await sha256(args.mp4),
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      sampledFps: fps,
      frameCount: metadata.frameCount,
      durationSeconds: metadata.durationSeconds,
      ...JSON.parse(stdout),
      boundary:
        "Lightweight visual QA for acceptance-video release gates; it detects obvious jitter/static evidence gaps but does not replace human review.",
    };
    await fs.mkdir(path.dirname(args.outputJson), { recursive: true });
    await fs.writeFile(args.outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await fs.mkdir(path.dirname(args.outputMd), { recursive: true });
    await fs.writeFile(
      args.outputMd,
      [
        "# MineLink Acceptance Video Visual Analysis",
        "",
        `- MP4: \`${args.mp4}\``,
        `- Duration seconds: \`${report.durationSeconds.toFixed(3)}\``,
        `- Frame count: \`${report.frameCount}\``,
        `- Sampled FPS: \`${report.sampledFps}\``,
        `- Analysis window: \`${report.analysisStartSeconds.toFixed(3)}s-${report.analysisEndSeconds.toFixed(3)}s\``,
        `- Abrupt jump count: \`${report.abruptJumpCount}\``,
        `- Max abrupt jumps: \`${report.maxAbruptJumps}\``,
        `- Jitter passed: \`${report.jitterPassed ? "yes" : "no"}\``,
        `- Motion frame ratio: \`${report.motionFrameRatio.toFixed(4)}\``,
        `- Min motion frame ratio: \`${report.minMotionFrameRatio}\``,
        `- Action motion coverage passed: \`${report.actionMotionCoveragePassed ? "yes" : "no"}\``,
        `- Static tail seconds: \`${report.staticTailSeconds.toFixed(3)}\``,
        `- Max static tail seconds: \`${report.maxStaticTailSeconds}\``,
        `- Static tail passed: \`${report.staticTailPassed ? "yes" : "no"}\``,
        `- Last motion seconds: \`${report.lastMotionSeconds.toFixed(3)}\``,
        `- Result: \`${report.passed ? "passed" : "failed"}\``,
        "",
        "## Top Frame Diffs",
        "",
        ...report.topFrameDiffs
          .slice(0, 10)
          .map(
            (item) =>
              `- \`${item.fromFrame}->${item.toFrame}\` \`${item.fromSeconds.toFixed(2)}s->${item.toSeconds.toFixed(2)}s\` diff \`${item.meanAbsDiff.toFixed(2)}\``,
          ),
        "",
      ].join("\n"),
      "utf8",
    );
    if (!report.passed && args.requirePass) {
      throw new Error(`Acceptance video visual analysis failed; wrote ${args.outputMd}`);
    }
    console.log(`Wrote ${args.outputJson}`);
    console.log(`Wrote ${args.outputMd}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
