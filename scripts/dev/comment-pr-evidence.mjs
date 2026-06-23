#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const args = {
  repository: process.env.GITHUB_REPOSITORY ?? "",
  pr: process.env.MINELINK_PR_NUMBER ?? "",
  artifactName: process.env.MINELINK_ARTIFACT_NAME ?? "minelink-evidence",
  artifactUrl: process.env.MINELINK_ARTIFACT_URL ?? "",
  artifactId: process.env.MINELINK_ARTIFACT_ID ?? "",
  videoUrl: process.env.MINELINK_PLAYABLE_VIDEO_URL ?? "",
  rawVideoUrl: process.env.MINELINK_RAW_VIDEO_URL ?? "",
  runUrl: process.env.MINELINK_WORKFLOW_RUN_URL ?? "",
  headSha: process.env.GITHUB_SHA ?? "",
  workflowName: process.env.GITHUB_WORKFLOW ?? "",
  videoPath: process.env.MINELINK_ACCEPTANCE_VIDEO_PATH ?? ".minelink-dev/reports/artifacts/acceptance.mp4",
  manifestPath:
    process.env.MINELINK_VIDEO_STORAGE_MANIFEST ?? ".minelink-dev/reports/artifacts/video-storage-manifest.json",
  videoReviewPath: process.env.MINELINK_VIDEO_REVIEW_PATH ?? ".minelink-dev/reports/artifacts/video-review.md",
  releaseGatePath: process.env.MINELINK_VIDEO_RELEASE_GATE_PATH ?? ".minelink-dev/reports/artifacts/video-release-gate.md",
  producer: process.env.MINELINK_ACCEPTANCE_VIDEO_PRODUCER ?? "github-actions",
  boundary:
    process.env.MINELINK_ACCEPTANCE_VIDEO_BOUNDARY ??
    "This video is a GitHub CI review artifact unless the origin metadata says producer ona-task-finalizer.",
  output: ".minelink-dev/reports/pr-video-evidence-comment.md",
  jsonOutput: ".minelink-dev/reports/pr-video-evidence-comment.json",
};
let dryRun = false;
let requireComment = false;
let allowArtifactOnly = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repository") args.repository = readValue();
  else if (arg === "--pr") args.pr = readValue();
  else if (arg === "--artifact-name") args.artifactName = readValue();
  else if (arg === "--artifact-url") args.artifactUrl = readValue();
  else if (arg === "--artifact-id") args.artifactId = readValue();
  else if (arg === "--video-url") args.videoUrl = readValue();
  else if (arg === "--raw-video-url") args.rawVideoUrl = readValue();
  else if (arg === "--run-url") args.runUrl = readValue();
  else if (arg === "--head-sha") args.headSha = readValue();
  else if (arg === "--workflow-name") args.workflowName = readValue();
  else if (arg === "--video-path") args.videoPath = readValue();
  else if (arg === "--manifest") args.manifestPath = readValue();
  else if (arg === "--video-review") args.videoReviewPath = readValue();
  else if (arg === "--release-gate") args.releaseGatePath = readValue();
  else if (arg === "--producer") args.producer = readValue();
  else if (arg === "--boundary") args.boundary = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "--require-comment") requireComment = true;
  else if (arg === "--allow-artifact-only") allowArtifactOnly = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/comment-pr-evidence.mjs --repository owner/repo --pr N --video-url URL [--artifact-url URL]

Upserts a PR comment that links to the GitHub artifact containing
.minelink-dev/reports/artifacts/acceptance.mp4 and, by default, requires a
playable MP4 URL. This is a review-surface helper only; it does not
alter acceptance gate status.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function hasValue(value) {
  const text = String(value ?? "").trim();
  return text.length > 0 && !["none", "null", "undefined", "-"].includes(text.toLowerCase());
}

function compact(text) {
  return String(text ?? "")
    .replace(/(github_pat_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(ghp_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function validate() {
  const failures = [];
  if (!/^[^/\s]+\/[^/\s]+$/.test(args.repository)) failures.push("--repository must be owner/repo");
  if (!/^\d+$/.test(String(args.pr))) failures.push("--pr must be a pull request number");
  if (!hasValue(args.artifactName)) failures.push("--artifact-name cannot be empty");
  if (!hasValue(args.videoUrl) && !allowArtifactOnly) {
    failures.push("--video-url is required unless --allow-artifact-only is set");
  }
  if (!hasValue(args.artifactUrl) && !hasValue(args.videoUrl)) {
    failures.push("at least one of --artifact-url or --video-url is required");
  }
  if (!hasValue(args.videoPath)) failures.push("--video-path cannot be empty");
  return failures;
}

function marker() {
  return `<!-- minelink-pr-video-evidence:${args.artifactName} -->`;
}

function githubInlineAttachment(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "github.com" && parsed.pathname.startsWith("/user-attachments/assets/")) return true;
    if (parsed.hostname === "user-images.githubusercontent.com") return true;
  } catch {
    return false;
  }
  return false;
}

function body(manifest) {
  const shortSha = hasValue(args.headSha) ? args.headSha.slice(0, 12) : "none";
  const inlineVideoUrl = args.rawVideoUrl || args.videoUrl;
  const inlineExpected = inlineVideoUrl ? githubInlineAttachment(inlineVideoUrl) : false;
  const playbackHeading = inlineExpected
    ? "GitHub inline video attachment:"
    : "External MP4 playback URL:";
  const playbackNote = inlineVideoUrl && !inlineExpected
    ? "Note: GitHub renders external MP4 URLs as links. Inline playback on the PR page requires a GitHub-uploaded attachment URL; use the R2 URL or artifact when no attachment URL is available."
    : "";
  const provider = manifest?.storageProvider || "unknown";
  const objectKey = manifest?.objectKey || "unknown";
  const manifestHash = manifest?.mp4Sha256 || "unknown";
  const manifestSummaryHash = manifest?.summarySha256 || "unknown";
  const clientGuiCapture = manifest?.clientGuiCapture === true ? "yes" : "no";
  return [
    marker(),
    "MineLink PR video evidence:",
    "",
    inlineVideoUrl ? playbackHeading : "",
    inlineVideoUrl ? "" : "",
    inlineVideoUrl ? inlineVideoUrl : "",
    inlineVideoUrl ? "" : "",
    playbackNote,
    playbackNote ? "" : "",
    `- Workflow: \`${args.workflowName || "unknown"}\``,
    `- Commit: \`${shortSha}\``,
    `- Run: ${args.runUrl || "none"}`,
    `- Playable video URL: ${args.videoUrl || "not published"}`,
    `- Raw video URL: ${args.rawVideoUrl || "not published"}`,
    `- R2/storage provider: \`${provider}\``,
    `- R2/object key: \`${objectKey}\``,
    `- Video storage manifest: \`${args.manifestPath}\``,
    `- Manifest MP4 SHA256: \`${manifestHash}\``,
    `- Manifest summary SHA256: \`${manifestSummaryHash}\``,
    `- Client GUI capture: \`${clientGuiCapture}\``,
    `- Verifier report: \`${args.videoReviewPath}\``,
    `- Release gate report: \`${args.releaseGatePath}\``,
    hasValue(args.artifactUrl)
      ? `- Artifact: [${args.artifactName}](${args.artifactUrl})`
      : `- Artifact: \`${args.artifactName}\` (not linked yet)`,
    `- Artifact id: \`${args.artifactId || "none"}\``,
    `- Acceptance video path inside artifact zip: \`${args.videoPath}\``,
    `- Video producer: \`${args.producer || "unknown"}\``,
    "",
    `Boundary: ${args.boundary}`,
  ].join("\n");
}

async function githubJson(url, options = {}) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN is required to comment on a PR");
  }
  const response = await fetch(`https://api.github.com${url}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${compact(text)}`);
  }
  return payload;
}

async function upsertComment() {
  const manifest = await readJsonIfPresent(args.manifestPath);
  if (!manifest) {
    throw new Error(`Video storage manifest is required before publishing PR evidence: ${args.manifestPath}`);
  }
  const comments = await githubJson(`/repos/${args.repository}/issues/${args.pr}/comments?per_page=100`);
  const existing = Array.isArray(comments)
    ? comments.find((comment) => String(comment.body ?? "").includes(marker()))
    : null;
  const payload = { body: body(manifest) };
  if (existing?.id) {
    const updated = await githubJson(`/repos/${args.repository}/issues/comments/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return { action: "updated", url: updated.html_url ?? "" };
  }
  const created = await githubJson(`/repos/${args.repository}/issues/${args.pr}/comments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { action: "created", url: created.html_url ?? "" };
}

const report = {
  result: "pending",
  repository: args.repository,
  pr: args.pr,
  artifactName: args.artifactName,
  artifactUrl: args.artifactUrl,
  artifactId: args.artifactId,
  videoUrl: args.videoUrl,
  rawVideoUrl: args.rawVideoUrl,
  githubInlinePlaybackExpected: githubInlineAttachment(args.rawVideoUrl || args.videoUrl),
  videoPath: args.videoPath,
  manifestPath: args.manifestPath,
  videoReviewPath: args.videoReviewPath,
  releaseGatePath: args.releaseGatePath,
  producer: args.producer,
  allowArtifactOnly,
  commentUrl: "",
  action: "",
  dryRun,
  failures: validate(),
};

if (report.failures.length === 0 && dryRun) {
  report.result = "passed";
  report.action = "dry-run";
} else if (report.failures.length === 0) {
  try {
    const result = await upsertComment();
    report.result = "passed";
    report.action = result.action;
    report.commentUrl = result.url;
  } catch (error) {
    report.result = "failed";
    report.failures.push(error instanceof Error ? error.message : String(error));
  }
} else {
  report.result = "failed";
}

const lines = [
  "# MineLink PR Video Evidence Comment",
  "",
  `- Result: \`${report.result}\``,
  `- PR: \`${args.repository}#${args.pr || "none"}\``,
  `- Artifact: \`${args.artifactName}\``,
  `- Artifact URL: ${args.artifactUrl || "none"}`,
  `- Playable video URL: ${args.videoUrl || "none"}`,
  `- Raw video URL: ${args.rawVideoUrl || "none"}`,
  `- GitHub inline playback expected: \`${report.githubInlinePlaybackExpected ? "yes" : "no"}\``,
  `- Acceptance video path: \`${args.videoPath}\``,
  `- Video storage manifest: \`${args.manifestPath}\``,
  `- Verifier report: \`${args.videoReviewPath}\``,
  `- Release gate report: \`${args.releaseGatePath}\``,
  `- Producer: \`${args.producer || "unknown"}\``,
  `- Action: \`${report.action || "none"}\``,
  `- Comment URL: ${report.commentUrl || "none"}`,
  "",
  "## Failures",
  "",
  ...(report.failures.length > 0 ? report.failures.map((failure) => `- ${failure}`) : ["- none"]),
  "",
  "## Boundary",
  "",
  "- This report only proves PR visibility for video evidence. It is not MineLink product acceptance.",
  "",
];

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, lines.join("\n"), "utf8");
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (report.result === "failed" && requireComment) {
  console.error(`PR video evidence comment failed; wrote ${args.output}`);
  process.exit(1);
}

console.log(`PR video evidence comment wrote ${args.output}`);
