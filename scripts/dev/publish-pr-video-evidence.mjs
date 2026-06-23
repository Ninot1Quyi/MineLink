#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const args = {
  repository: process.env.GITHUB_REPOSITORY ?? "",
  pr: process.env.MINELINK_PR_NUMBER ?? "",
  branch: process.env.MINELINK_EVIDENCE_BRANCH ?? "minelink-evidence",
  artifactName: process.env.MINELINK_ARTIFACT_NAME ?? "minelink-evidence",
  runId: process.env.GITHUB_RUN_ID ?? "local",
  runUrl: process.env.MINELINK_WORKFLOW_RUN_URL ?? "",
  headSha: process.env.GITHUB_SHA ?? "",
  workflowName: process.env.GITHUB_WORKFLOW ?? "",
  videoPath: process.env.MINELINK_ACCEPTANCE_VIDEO_PATH ?? ".minelink-dev/reports/artifacts/acceptance.mp4",
  originPath:
    process.env.MINELINK_ACCEPTANCE_VIDEO_ORIGIN ?? ".minelink-dev/reports/artifacts/acceptance-video-origin.json",
  producer: process.env.MINELINK_ACCEPTANCE_VIDEO_PRODUCER ?? "",
  output: ".minelink-dev/reports/pr-video-publish.md",
  jsonOutput: ".minelink-dev/reports/pr-video-publish.json",
};
let requireVideo = false;
let dryRun = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repository") args.repository = readValue();
  else if (arg === "--pr") args.pr = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--artifact-name") args.artifactName = readValue();
  else if (arg === "--run-id") args.runId = readValue();
  else if (arg === "--run-url") args.runUrl = readValue();
  else if (arg === "--head-sha") args.headSha = readValue();
  else if (arg === "--workflow-name") args.workflowName = readValue();
  else if (arg === "--video-path") args.videoPath = readValue();
  else if (arg === "--origin-path") args.originPath = readValue();
  else if (arg === "--producer") args.producer = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--require-video") requireVideo = true;
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/publish-pr-video-evidence.mjs --repository owner/repo --pr N

Publishes .minelink-dev/reports/artifacts/acceptance.mp4 to a dedicated
GitHub evidence branch so reviewers can open a playable GitHub file page from
the PR. This is a visibility surface only; acceptance status still depends on
origin metadata and video review gates.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
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

function pathSegment(value) {
  return String(value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function githubJson(url, options = {}) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN is required to publish PR video evidence");
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
    const error = new Error(`GitHub API ${response.status}: ${compact(text)}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function ensureBranch() {
  try {
    await githubJson(`/repos/${args.repository}/git/ref/heads/${encodeURIComponent(args.branch)}`);
    return "existing";
  } catch (error) {
    if (error?.status !== 404) throw error;
  }
  const repo = await githubJson(`/repos/${args.repository}`);
  const sourceRef = await githubJson(
    `/repos/${args.repository}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`,
  );
  await githubJson(`/repos/${args.repository}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${args.branch}`,
      sha: sourceRef.object.sha,
    }),
  });
  return "created";
}

async function contentSha(targetPath) {
  try {
    const payload = await githubJson(
      `/repos/${args.repository}/contents/${encodeURIComponent(targetPath).replace(/%2F/g, "/")}?ref=${encodeURIComponent(args.branch)}`,
    );
    return payload.sha ?? "";
  } catch (error) {
    if (error?.status === 404) return "";
    throw error;
  }
}

async function putFile(targetPath, content, message) {
  const sha = await contentSha(targetPath);
  await githubJson(`/repos/${args.repository}/contents/${encodeURIComponent(targetPath).replace(/%2F/g, "/")}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content,
      branch: args.branch,
      ...(sha ? { sha } : {}),
    }),
  });
}

function pageUrl(targetPath) {
  return `https://github.com/${args.repository}/blob/${encodeURIComponent(args.branch).replace(/%2F/g, "/")}/${targetPath}`;
}

function rawUrl(targetPath) {
  return `https://raw.githubusercontent.com/${args.repository}/${encodeURIComponent(args.branch).replace(/%2F/g, "/")}/${targetPath}`;
}

const report = {
  result: "pending",
  repository: args.repository,
  pr: args.pr,
  branch: args.branch,
  artifactName: args.artifactName,
  runId: args.runId,
  videoPath: args.videoPath,
  originPath: args.originPath,
  producer: args.producer,
  targetVideoPath: "",
  targetIndexPath: "",
  videoPageUrl: "",
  rawVideoUrl: "",
  indexPageUrl: "",
  dryRun,
  branchAction: "",
  failures: [],
};

if (!/^[^/\s]+\/[^/\s]+$/.test(args.repository)) report.failures.push("--repository must be owner/repo");
if (!/^\d+$/.test(String(args.pr))) report.failures.push("--pr must be a pull request number");
if (!hasValue(args.branch)) report.failures.push("--branch cannot be empty");
if (!hasValue(args.artifactName)) report.failures.push("--artifact-name cannot be empty");

const videoExists = await exists(args.videoPath);
if (!videoExists && requireVideo) {
  report.failures.push(`Acceptance video is missing: ${args.videoPath}`);
}

if (report.failures.length === 0 && videoExists) {
  const origin = await readJsonIfPresent(args.originPath);
  const producer = args.producer || origin?.producer || "unknown";
  const baseDir = [
    "pr-videos",
    `pr-${args.pr}`,
    pathSegment(args.artifactName),
    pathSegment(args.runId),
  ].join("/");
  report.targetVideoPath = `${baseDir}/acceptance.mp4`;
  report.targetIndexPath = `${baseDir}/README.md`;
  report.videoPageUrl = pageUrl(report.targetVideoPath);
  report.rawVideoUrl = rawUrl(report.targetVideoPath);
  report.indexPageUrl = pageUrl(report.targetIndexPath);
  report.producer = producer;

  if (dryRun) {
    report.result = "passed";
    report.branchAction = "dry-run";
  } else {
    try {
      report.branchAction = await ensureBranch();
      const video = await fs.readFile(args.videoPath);
      await putFile(
        report.targetVideoPath,
        video.toString("base64"),
        `Publish MineLink PR ${args.pr} acceptance video`,
      );
      const index = [
        `# MineLink PR ${args.pr} Acceptance Video`,
        "",
        `- Workflow: \`${args.workflowName || "unknown"}\``,
        `- Run: ${args.runUrl || "none"}`,
        `- Commit: \`${args.headSha || "none"}\``,
        `- Artifact: \`${args.artifactName}\``,
        `- Producer: \`${producer}\``,
        `- Playable video file: [acceptance.mp4](./acceptance.mp4)`,
        `- Raw video URL: ${report.rawVideoUrl}`,
        "",
        "Boundary: this page makes the video visible from GitHub. It does not",
        "change MineLink acceptance status; final task acceptance still depends",
        "on `acceptance-video-origin.json`, `video-review.md`, and the release",
        "gate requiring the expected producer.",
        "",
      ].join("\n");
      await putFile(
        report.targetIndexPath,
        Buffer.from(index, "utf8").toString("base64"),
        `Publish MineLink PR ${args.pr} video index`,
      );
      report.result = "passed";
    } catch (error) {
      report.result = "failed";
      report.failures.push(error instanceof Error ? error.message : String(error));
    }
  }
} else if (report.failures.length === 0) {
  report.result = "skipped";
}

const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput) {
  await fs.appendFile(
    githubOutput,
    [
      `video-url=${report.videoPageUrl}`,
      `raw-video-url=${report.rawVideoUrl}`,
      `index-url=${report.indexPageUrl}`,
      `target-video-path=${report.targetVideoPath}`,
    ].join("\n") + "\n",
    "utf8",
  );
}

const lines = [
  "# MineLink PR Video Publish",
  "",
  `- Result: \`${report.result}\``,
  `- PR: \`${args.repository}#${args.pr || "none"}\``,
  `- Evidence branch: \`${args.branch}\``,
  `- Target video path: \`${report.targetVideoPath || "none"}\``,
  `- Video page URL: ${report.videoPageUrl || "none"}`,
  `- Raw video URL: ${report.rawVideoUrl || "none"}`,
  `- Index URL: ${report.indexPageUrl || "none"}`,
  `- Producer: \`${report.producer || "unknown"}\``,
  "",
  "## Failures",
  "",
  ...(report.failures.length > 0 ? report.failures.map((failure) => `- ${failure}`) : ["- none"]),
  "",
  "## Boundary",
  "",
  "- This report proves PR video visibility only. It is not MineLink product acceptance.",
  "",
];

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, lines.join("\n"), "utf8");
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (report.result === "failed") {
  console.error(`PR video publish failed; wrote ${args.output}`);
  process.exit(1);
}

console.log(`PR video publish wrote ${args.output}`);
