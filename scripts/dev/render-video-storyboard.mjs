#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const storyboardComposer = String.raw`
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

frames_dir = Path(sys.argv[1])
output = Path(sys.argv[2])
columns = int(sys.argv[3])
labels = json.loads(sys.argv[4])
cell_w = 426
cell_h = 240
rows = math.ceil(len(labels) / columns)
canvas = Image.new("RGB", (cell_w * columns, cell_h * rows), "black")
draw = ImageDraw.Draw(canvas)
font = ImageFont.load_default()

for idx, label in enumerate(labels):
    frame = frames_dir / f"storyboard-frame-{idx + 1:02d}.png"
    image = Image.open(frame).convert("RGB")
    if image.size != (cell_w, cell_h):
        image = image.resize((cell_w, cell_h))
    x = (idx % columns) * cell_w
    y = (idx // columns) * cell_h
    canvas.paste(image, (x, y))
    draw.rectangle((x + 8, y + 8, x + 118, y + 32), fill=(0, 0, 0))
    draw.text((x + 14, y + 13), label, fill=(255, 255, 255), font=font)

output.parent.mkdir(parents=True, exist_ok=True)
canvas.save(output)
`;

const args = {
  mp4: ".minelink-dev/reports/artifacts/acceptance.mp4",
  output: ".minelink-dev/reports/artifacts/acceptance-storyboard.png",
  jsonOutput: ".minelink-dev/reports/artifacts/acceptance-storyboard.json",
  framesDir: ".minelink-dev/reports/artifacts/storyboard-frames",
  count: 9,
  columns: 3,
};

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--mp4") args.mp4 = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--frames-dir") args.framesDir = readValue();
  else if (arg === "--count") args.count = Number(readValue());
  else if (arg === "--columns") args.columns = Number(readValue());
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/render-video-storyboard.mjs --mp4 acceptance.mp4

Extracts numbered frames from the final acceptance MP4 and combines them into
a storyboard image for model-readable visual review. This is QA evidence only;
it does not replace the playable acceptance.mp4.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

function positiveInt(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function stat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function durationSeconds(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const value = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`ffprobe returned invalid duration for ${filePath}: ${stdout.trim() || "empty"}`);
  }
  return value;
}

function timestamp(index, count, duration) {
  if (count <= 1) return Math.min(Math.max(duration / 2, 0.1), duration - 0.05);
  const raw = (duration * (index + 0.5)) / count;
  return Math.max(0, Math.min(duration - 0.05, raw));
}

async function main() {
  args.count = positiveInt(args.count, 9);
  args.columns = positiveInt(args.columns, 3);
  const rows = Math.ceil(args.count / args.columns);
  const mp4Stat = await stat(args.mp4);
  if (!mp4Stat?.isFile() || mp4Stat.size === 0) {
    throw new Error(`Acceptance MP4 is missing or empty: ${args.mp4}`);
  }

  await fs.rm(args.framesDir, { recursive: true, force: true });
  await fs.mkdir(args.framesDir, { recursive: true });
  await fs.mkdir(path.dirname(args.output), { recursive: true });

  const duration = await durationSeconds(args.mp4);
  const frames = [];
  const labels = [];
  for (let index = 0; index < args.count; index += 1) {
    const seconds = timestamp(index, args.count, duration);
    const label = `${String(index + 1).padStart(2, "0")} ${seconds.toFixed(1)}s`;
    const frame = path.join(args.framesDir, `storyboard-frame-${String(index + 1).padStart(2, "0")}.png`);
    const filter = [
      "scale=426:240:force_original_aspect_ratio=decrease",
      "pad=426:240:(ow-iw)/2:(oh-ih)/2:color=black",
    ].join(",");
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        seconds.toFixed(3),
        "-i",
        args.mp4,
        "-frames:v",
        "1",
        "-vf",
        filter,
        frame,
      ],
      { maxBuffer: 1024 * 1024 * 8 },
    );
    frames.push({ index: index + 1, seconds, path: frame, sha256: await sha256(frame) });
    labels.push(label);
  }

  await execFileAsync(
    "python3",
    [
      "-c",
      storyboardComposer,
      args.framesDir,
      args.output,
      String(args.columns),
      JSON.stringify(labels),
    ],
    { maxBuffer: 1024 * 1024 * 8 },
  );

  const report = {
    generatedAt: new Date().toISOString(),
    mp4: args.mp4,
    output: args.output,
    count: args.count,
    columns: args.columns,
    rows,
    durationSeconds: duration,
    mp4Sha256: await sha256(args.mp4),
    storyboardSha256: await sha256(args.output),
    frames,
    boundary: "Storyboard is model-readable QA evidence only; final delivery remains the playable acceptance.mp4.",
  };
  await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
  await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${args.output}`);
  console.log(`Wrote ${args.jsonOutput}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
