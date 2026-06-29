#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const args = {
  repository: process.env.GITHUB_REPOSITORY ?? "",
  pr: process.env.MINELINK_PR_NUMBER ?? "",
  runId: process.env.MINELINK_WORKFLOW_RUN_ID ?? "",
  artifactName: process.env.MINELINK_ARTIFACT_NAME ?? "minelink-ona-platform-codex-probe",
  artifactUrl: process.env.MINELINK_ARTIFACT_URL ?? "",
  artifactId: process.env.MINELINK_ARTIFACT_ID ?? "",
  artifactDir: process.env.MINELINK_LOCAL_VIDEO_ARTIFACT_DIR ?? "",
  filePath: process.env.MINELINK_ACCEPTANCE_VIDEO_PATH ?? "",
  storyboardPath: process.env.MINELINK_ACCEPTANCE_STORYBOARD_PATH ?? "",
  manifestPath: process.env.MINELINK_VIDEO_STORAGE_MANIFEST ?? "",
  videoReviewPath: process.env.MINELINK_VIDEO_REVIEW_PATH ?? "",
  releaseGatePath: process.env.MINELINK_VIDEO_RELEASE_GATE_PATH ?? "",
  cookieFile:
    process.env.MINELINK_GITHUB_USER_SESSION_FILE ??
    ".minelink-dev/secrets/github-user-session.cookie",
  refreshCookie:
    process.env.MINELINK_GITHUB_ATTACHMENT_REFRESH_COOKIE !== "0" &&
    process.env.MINELINK_GITHUB_ATTACHMENT_REFRESH_COOKIE !== "false",
  secretName: "MINELINK_GITHUB_USER_SESSION",
  refreshOutput: ".minelink-dev/reports/github-attachment-cookie-refresh.md",
  refreshJsonOutput: ".minelink-dev/reports/github-attachment-cookie-refresh.json",
  chromeCookieDbExport:
    process.env.MINELINK_GITHUB_CHROME_DB_EXPORT_ON_REFRESH_FAIL !== "0" &&
    process.env.MINELINK_GITHUB_CHROME_DB_EXPORT_ON_REFRESH_FAIL !== "false",
  chromeDbExportOutput: ".minelink-dev/reports/github-chrome-db-cookie-export.md",
  chromeDbExportJsonOutput: ".minelink-dev/reports/github-chrome-db-cookie-export.json",
  uploadOutput: ".minelink-dev/reports/github-user-attachment-upload.md",
  uploadJsonOutput: ".minelink-dev/reports/github-user-attachment-upload.json",
  commentOutput: ".minelink-dev/reports/pr-video-evidence-comment.md",
  commentJsonOutput: ".minelink-dev/reports/pr-video-evidence-comment.json",
  output: ".minelink-dev/reports/github-local-video-publisher.md",
  jsonOutput: ".minelink-dev/reports/github-local-video-publisher.json",
  headSha: process.env.GITHUB_SHA ?? "",
  workflowName: process.env.GITHUB_WORKFLOW ?? "Ona Platform Codex Probe",
  producer: process.env.MINELINK_ACCEPTANCE_VIDEO_PRODUCER ?? "ona-task-finalizer",
  boundary:
    process.env.MINELINK_ACCEPTANCE_VIDEO_BOUNDARY ??
    "script-only GitHub attachment publisher; final video still requires Ona finalizer, same-session Codex verifier, and release gate evidence",
};

let uploadOnly = false;
let updateSecret = false;
let dryRun = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repository") args.repository = readValue();
  else if (arg === "--pr") args.pr = readValue();
  else if (arg === "--run-id") args.runId = readValue();
  else if (arg === "--artifact-name") args.artifactName = readValue();
  else if (arg === "--artifact-url") args.artifactUrl = readValue();
  else if (arg === "--artifact-id") args.artifactId = readValue();
  else if (arg === "--artifact-dir") args.artifactDir = readValue();
  else if (arg === "--file") args.filePath = readValue();
  else if (arg === "--storyboard") args.storyboardPath = readValue();
  else if (arg === "--manifest") args.manifestPath = readValue();
  else if (arg === "--video-review") args.videoReviewPath = readValue();
  else if (arg === "--release-gate") args.releaseGatePath = readValue();
  else if (arg === "--cookie-file") args.cookieFile = readValue();
  else if (arg === "--refresh-output") args.refreshOutput = readValue();
  else if (arg === "--refresh-json-output") args.refreshJsonOutput = readValue();
  else if (arg === "--chrome-db-export-output") args.chromeDbExportOutput = readValue();
  else if (arg === "--chrome-db-export-json-output") args.chromeDbExportJsonOutput = readValue();
  else if (arg === "--upload-output") args.uploadOutput = readValue();
  else if (arg === "--upload-json-output") args.uploadJsonOutput = readValue();
  else if (arg === "--comment-output") args.commentOutput = readValue();
  else if (arg === "--comment-json-output") args.commentJsonOutput = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--head-sha") args.headSha = readValue();
  else if (arg === "--workflow-name") args.workflowName = readValue();
  else if (arg === "--producer") args.producer = readValue();
  else if (arg === "--boundary") args.boundary = readValue();
  else if (arg === "--secret-name") args.secretName = readValue();
  else if (arg === "--no-refresh-cookie") args.refreshCookie = false;
  else if (arg === "--no-chrome-db-export") args.chromeCookieDbExport = false;
  else if (arg === "--upload-only") uploadOnly = true;
  else if (arg === "--update-secret") updateSecret = true;
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/publish-github-video-local.mjs --repository owner/repo --pr N [--run-id RUN_ID]

Publishes a verifier-approved MineLink acceptance MP4 to GitHub PR inline
playback by using an ignored local GitHub web cookie file. The script never
opens, controls, or reads a browser. It refreshes the existing cookie by HTTP
page requests, uploads the MP4 through GitHub user-attachments, and comments on
the PR with the returned github.com/user-attachments/assets/... URL.

Options:
  --run-id RUN_ID          Download the workflow artifact with gh run download.
  --artifact-dir DIR       Existing extracted artifact directory.
  --artifact-name NAME     Artifact/comment name. Defaults to minelink-ona-platform-codex-probe.
  --file FILE              Acceptance MP4 path. Auto-discovered under artifact-dir.
  --cookie-file FILE       Ignored local cookie file. Defaults under .minelink-dev/secrets.
  --no-refresh-cookie      Skip the HTTP cookie refresh/validation step.
  --no-chrome-db-export    Do not refresh the ignored cookie file from local macOS Chrome DB.
  --upload-only            Upload the attachment but do not comment on the PR.
  --update-secret          Also update MINELINK_GITHUB_USER_SESSION via gh secret set.
  --dry-run                Validate artifact paths and cookie refresh, then stop before upload.`);
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
    .replace(/(_gh_sess=)[^;\s]+/gi, "$1[redacted]")
    .replace(/(user_session=)[^;\s]+/gi, "$1[redacted]")
    .replace(/(__Host-user_session_same_site=)[^;\s]+/gi, "$1[redacted]")
    .replace(/(logged_in=)[^;\s]+/gi, "$1[redacted]")
    .replace(/(dotcom_user=)[^;\s]+/gi, "$1[redacted]")
    .replace(/(github_pat_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(ghp_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

function inferRepo() {
  if (hasValue(args.repository)) return args.repository;
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", stdio: "pipe" });
  const value = remote.stdout?.trim() ?? "";
  const match = value.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
  return match?.[1] ?? "";
}

function prUrl() {
  return `https://github.com/${report.repository}/pull/${args.pr}`;
}

function cookieSignals(cookieHeader) {
  const text = String(cookieHeader ?? "");
  return {
    present: hasValue(text),
    hasLoggedIn: /(?:^|;\s*)logged_in=yes(?:;|$)/.test(text),
    hasDotcomUser: /(?:^|;\s*)dotcom_user=/.test(text),
    hasGhSess: /(?:^|;\s*)_gh_sess=/.test(text),
    hasUserSession: /(?:^|;\s*)user_session=/.test(text),
    hasHostUserSessionSameSite: /(?:^|;\s*)__Host-user_session_same_site=/.test(text),
  };
}

async function walkFiles(root) {
  const files = [];
  async function visit(current) {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile()) files.push(next);
    }
  }
  await visit(root);
  return files;
}

function chooseFile(files, basename) {
  const matches = files.filter((file) => path.basename(file) === basename);
  if (matches.length === 0) return "";
  const preferred = matches.find((file) => file.includes(`${path.sep}artifacts${path.sep}`));
  return preferred ?? matches[0];
}

async function downloadArtifactIfNeeded() {
  if (hasValue(args.artifactDir)) return;
  if (!hasValue(args.runId)) return;
  const root = path.join(".minelink-dev", "github-video-local", String(args.runId));
  const destination = path.join(root, args.artifactName.replace(/[^\w.-]+/g, "-"));
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  const commandArgs = [
    "run",
    "download",
    String(args.runId),
    "--repo",
    report.repository,
    "--name",
    args.artifactName,
    "--dir",
    destination,
  ];
  const result = spawnSync("gh", commandArgs, { encoding: "utf8", stdio: "pipe" });
  report.downloadCommand = `gh ${commandArgs.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ")}`;
  report.downloadStatus = result.status ?? 1;
  report.downloadStdout = compact(result.stdout);
  report.downloadStderr = compact(result.stderr);
  if (result.status !== 0) {
    throw new Error(`gh run download failed: ${compact(result.stderr || result.stdout)}`);
  }
  args.artifactDir = destination;
  report.artifactDir = destination;
}

async function discoverArtifactFiles() {
  if (!hasValue(args.artifactDir)) return;
  const files = await walkFiles(args.artifactDir);
  report.discoveredFiles = files.map((file) => path.relative(args.artifactDir, file)).sort();
  if (!hasValue(args.filePath)) args.filePath = chooseFile(files, "acceptance.mp4");
  if (!hasValue(args.storyboardPath)) args.storyboardPath = chooseFile(files, "acceptance-storyboard.png");
  if (!hasValue(args.manifestPath)) args.manifestPath = chooseFile(files, "video-storage-manifest.json");
  if (!hasValue(args.videoReviewPath)) args.videoReviewPath = chooseFile(files, "video-review.md");
  if (!hasValue(args.releaseGatePath)) args.releaseGatePath = chooseFile(files, "video-release-gate.md");
}

async function assertFile(filePath, label) {
  if (!hasValue(filePath)) throw new Error(`${label} path is missing.`);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.size <= 0) throw new Error(`${label} is missing or empty: ${filePath}`);
}

async function ghTokenEnv() {
  if (hasValue(process.env.GITHUB_TOKEN) || hasValue(process.env.GH_TOKEN)) return {};
  const result = spawnSync("gh", ["auth", "token"], { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0 || !hasValue(result.stdout)) return {};
  return { GH_TOKEN: result.stdout.trim() };
}

function runNodeScript(script, scriptArgs, env = {}) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, ...env },
  });
  return {
    status: result.status ?? 1,
    stdout: compact(result.stdout),
    stderr: compact(result.stderr),
  };
}

function readJson(filePath) {
  return fs.readFile(filePath, "utf8").then((text) => JSON.parse(text));
}

async function readCookieSignalsFromFile() {
  const cookie = await fs.readFile(args.cookieFile, "utf8").catch(() => "");
  report.cookieSignals = cookieSignals(cookie);
  report.cookieNames = String(cookie)
    .split(";")
    .map((part) => part.trim().split("=")[0])
    .filter(Boolean)
    .sort();
}

async function refreshCookie(env) {
  if (!args.refreshCookie) {
    await readCookieSignalsFromFile();
    return;
  }
  const refreshArgs = [
    "--repository",
    report.repository,
    "--cookie-file",
    args.cookieFile,
    "--output",
    args.refreshOutput,
    "--json-output",
    args.refreshJsonOutput,
  ];
  if (/^\d+$/.test(String(args.pr))) refreshArgs.push("--pr", String(args.pr));
  if (hasValue(args.secretName)) refreshArgs.push("--secret-name", args.secretName);
  if (updateSecret) refreshArgs.push("--update-secret");
  if (dryRun) refreshArgs.push("--dry-run");

  let result = runNodeScript("scripts/dev/refresh-github-attachment-cookie.mjs", refreshArgs, env);
  report.refreshStatus = result.status;
  report.refreshStdout = result.stdout;
  report.refreshStderr = result.stderr;
  if (result.status !== 0 && args.chromeCookieDbExport) {
    const exportArgs = [
      "--cookie-file",
      args.cookieFile,
      "--output",
      args.chromeDbExportOutput,
      "--json-output",
      args.chromeDbExportJsonOutput,
    ];
    if (dryRun) exportArgs.push("--dry-run");
    const exportResult = runNodeScript("scripts/dev/export-github-cookie-from-chrome-db.mjs", exportArgs, env);
    report.chromeDbExportStatus = exportResult.status;
    report.chromeDbExportStdout = exportResult.stdout;
    report.chromeDbExportStderr = exportResult.stderr;
    const exportReport = await readJson(args.chromeDbExportJsonOutput).catch(() => null);
    if (exportReport) {
      report.chromeDbExportResult = exportReport.result ?? "";
      report.chromeDbExportCookieCount = exportReport.cookieCount ?? 0;
    }
    if (exportResult.status === 0 && !dryRun) {
      result = runNodeScript("scripts/dev/refresh-github-attachment-cookie.mjs", refreshArgs, env);
      report.refreshStatus = result.status;
      report.refreshStdout = result.stdout;
      report.refreshStderr = result.stderr;
    }
  }
  const refreshReport = await readJson(args.refreshJsonOutput).catch(() => null);
  if (refreshReport) {
    report.cookieNames = refreshReport.cookieNames ?? [];
    report.cookieSignals = refreshReport.cookieSignals ?? report.cookieSignals;
    report.refreshResult = refreshReport.result ?? "";
    report.secretUpdated = refreshReport.secretUpdated === true;
  }
  if (result.status !== 0) {
    throw new Error(`GitHub attachment cookie refresh failed: ${result.stderr || result.stdout}`);
  }
}

async function uploadAttachment(env) {
  const uploadArgs = [
    "--repository",
    report.repository,
    "--file",
    args.filePath,
    "--name",
    "acceptance.mp4",
    "--referer",
    prUrl(),
    "--cookie-file",
    args.cookieFile,
    "--require-upload",
    "--output",
    args.uploadOutput,
    "--json-output",
    args.uploadJsonOutput,
  ];
  const result = runNodeScript("scripts/dev/upload-github-user-attachment.mjs", uploadArgs, env);
  report.uploadStatus = result.status;
  report.uploadStdout = result.stdout;
  report.uploadStderr = result.stderr;
  if (result.status !== 0) {
    throw new Error(`GitHub user attachment upload failed: ${result.stderr || result.stdout}`);
  }
  const uploadReport = await readJson(args.uploadJsonOutput);
  report.attachmentUrl = uploadReport.href ?? "";
  report.attachmentSha256 = uploadReport.sha256 ?? "";
  report.attachmentFailureKind = uploadReport.failureKind ?? "";
  if (!hasValue(report.attachmentUrl)) {
    throw new Error(`GitHub user attachment upload did not return an attachment URL: ${args.uploadJsonOutput}`);
  }
}

async function commentOnPr(env) {
  if (uploadOnly) return;
  const commentArgs = [
    "--repository",
    report.repository,
    "--pr",
    String(args.pr),
    "--artifact-name",
    args.artifactName,
    "--video-url",
    report.attachmentUrl,
    "--raw-video-url",
    report.attachmentUrl,
    "--workflow-name",
    args.workflowName,
    "--video-path",
    args.filePath,
    "--storyboard-path",
    args.storyboardPath,
    "--manifest",
    args.manifestPath,
    "--video-review",
    args.videoReviewPath,
    "--release-gate",
    args.releaseGatePath,
    "--producer",
    args.producer,
    "--boundary",
    args.boundary,
    "--require-github-attachment-video",
    "--require-comment",
    "--output",
    args.commentOutput,
    "--json-output",
    args.commentJsonOutput,
  ];
  if (hasValue(args.artifactUrl)) commentArgs.push("--artifact-url", args.artifactUrl);
  if (hasValue(args.artifactId)) commentArgs.push("--artifact-id", args.artifactId);
  if (hasValue(args.runId)) {
    commentArgs.push("--run-url", `https://github.com/${report.repository}/actions/runs/${args.runId}`);
  }
  if (hasValue(args.headSha)) commentArgs.push("--head-sha", args.headSha);
  const result = runNodeScript("scripts/dev/comment-pr-evidence.mjs", commentArgs, env);
  report.commentStatus = result.status;
  report.commentStdout = result.stdout;
  report.commentStderr = result.stderr;
  if (result.status !== 0) {
    throw new Error(`PR video evidence comment failed: ${result.stderr || result.stdout}`);
  }
  const commentReport = await readJson(args.commentJsonOutput);
  report.commentUrl = commentReport.commentUrl ?? "";
  report.commentAction = commentReport.action ?? "";
}

async function writeReport() {
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
  const lines = [
    "# GitHub Local Video Publisher",
    "",
    `- Result: \`${report.result}\``,
    `- Repository: \`${report.repository}\``,
    `- PR: \`${args.pr || "none"}\``,
    `- Run id: \`${args.runId || "none"}\``,
    `- Artifact: \`${args.artifactName}\``,
    `- Artifact dir: \`${args.artifactDir || "none"}\``,
    `- Acceptance MP4: \`${args.filePath || "none"}\``,
    `- Video manifest: \`${args.manifestPath || "none"}\``,
    `- Video review: \`${args.videoReviewPath || "none"}\``,
    `- Release gate: \`${args.releaseGatePath || "none"}\``,
    `- Cookie file: \`${args.cookieFile || "none"}\``,
    `- Cookie refresh: \`${args.refreshCookie ? "yes" : "no"}\``,
    `- Chrome DB export fallback: \`${args.chromeCookieDbExport ? "yes" : "no"}\``,
    `- Chrome DB export result: \`${report.chromeDbExportResult || "none"}\``,
    `- Chrome DB export cookie count: \`${report.chromeDbExportCookieCount ?? 0}\``,
    `- Attachment URL: ${report.attachmentUrl || "none"}`,
    `- Comment URL: ${report.commentUrl || "none"}`,
    `- Upload only: \`${uploadOnly ? "yes" : "no"}\``,
    `- Secret updated: \`${report.secretUpdated ? "yes" : "no"}\``,
    `- Boundary: \`${report.boundary}\``,
    "",
    "## Cookie Signals",
    "",
    ...Object.entries(report.cookieSignals).map(([key, value]) => `- ${key}: \`${value ? "yes" : "no"}\``),
    "",
    "## Failures",
    "",
    ...(report.failures.length > 0 ? report.failures.map((failure) => `- ${failure}`) : ["- none"]),
    "",
  ];
  await fs.writeFile(args.output, `${lines.join("\n")}\n`, "utf8");
  await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

const report = {
  createdAt: new Date().toISOString(),
  result: "pending",
  repository: inferRepo() || "unknown",
  artifactDir: args.artifactDir,
  cookieNames: [],
  cookieSignals: cookieSignals(""),
  discoveredFiles: [],
  downloadCommand: "",
  downloadStatus: null,
  downloadStdout: "",
  downloadStderr: "",
  refreshStatus: null,
  refreshStdout: "",
  refreshStderr: "",
  refreshResult: "",
  chromeDbExportStatus: null,
  chromeDbExportStdout: "",
  chromeDbExportStderr: "",
  chromeDbExportResult: "",
  chromeDbExportCookieCount: 0,
  uploadStatus: null,
  uploadStdout: "",
  uploadStderr: "",
  attachmentUrl: "",
  attachmentSha256: "",
  attachmentFailureKind: "",
  commentStatus: null,
  commentStdout: "",
  commentStderr: "",
  commentUrl: "",
  commentAction: "",
  secretUpdated: false,
  failures: [],
  boundary:
    "script-only trusted GitHub user-attachment publisher; it reads an ignored cookie file, refreshes by HTTP, and never opens or controls a browser",
};

try {
  if (!/^[^/\s]+\/[^/\s]+$/.test(report.repository)) {
    throw new Error("--repository must be owner/repo or origin must be a GitHub remote.");
  }
  if (!/^\d+$/.test(String(args.pr)) && !uploadOnly) {
    throw new Error("--pr must be provided unless --upload-only is set.");
  }

  await downloadArtifactIfNeeded();
  await discoverArtifactFiles();
  await assertFile(args.filePath, "Acceptance MP4");
  if (!uploadOnly) {
    await assertFile(args.manifestPath, "Video storage manifest");
    await assertFile(args.videoReviewPath, "Video review");
    await assertFile(args.releaseGatePath, "Video release gate");
  }

  const env = await ghTokenEnv();
  await refreshCookie(env);

  if (dryRun) {
    report.result = "dry-run";
  } else {
    await uploadAttachment(env);
    await commentOnPr(env);
    report.result = "passed";
  }
} catch (error) {
  report.result = "blocked";
  report.failures.push(compact(error?.message ?? error));
} finally {
  await writeReport();
}

if (report.result === "blocked") {
  console.error(`GitHub local video publisher blocked; wrote ${args.output}`);
  process.exit(1);
}

console.log(`GitHub local video publisher ${report.result}; wrote ${args.output}`);
