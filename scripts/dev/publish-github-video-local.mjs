#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

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
  profileDir: path.resolve(".minelink-dev/github-attachment-cookie-profile"),
  chromePath: process.env.CHROME_PATH ?? "",
  port: Number(process.env.MINELINK_GITHUB_LOCAL_PUBLISHER_PORT ?? 9237),
  timeoutSeconds: Number(process.env.MINELINK_GITHUB_LOCAL_PUBLISHER_TIMEOUT_SECONDS ?? 900),
  tempCookieFile: "",
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
    "local trusted GitHub attachment publisher; final video still requires Ona finalizer, same-session Codex verifier, and release gate evidence",
};

let keepBrowser = false;
let noPrompt = false;
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
  else if (arg === "--profile-dir") args.profileDir = path.resolve(readValue());
  else if (arg === "--chrome") args.chromePath = readValue();
  else if (arg === "--port") args.port = Number(readValue());
  else if (arg === "--timeout-seconds") args.timeoutSeconds = Number(readValue());
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
  else if (arg === "--keep-browser") keepBrowser = true;
  else if (arg === "--no-prompt") noPrompt = true;
  else if (arg === "--upload-only") uploadOnly = true;
  else if (arg === "--update-secret") updateSecret = true;
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/publish-github-video-local.mjs --repository owner/repo --pr N [--run-id RUN_ID]

Publishes a verifier-approved MineLink acceptance MP4 to GitHub PR inline
playback using a dedicated local Chrome profile. This is the trusted local
fallback for the final PR video edge when GitHub Actions cannot keep a stable
web attachment cookie.

The script does not read your normal browser profile, does not print cookies,
and cannot mint GitHub web sessions from PATs. It opens a dedicated profile,
reuses that profile's GitHub login if still valid, prompts only when GitHub
requires a login, uploads the MP4 through GitHub user-attachments, and comments
on the PR with the returned github.com/user-attachments/assets/... URL.

Options:
  --run-id RUN_ID          Download the workflow artifact with gh run download.
  --artifact-dir DIR       Existing extracted artifact directory.
  --artifact-name NAME     Artifact/comment name. Defaults to minelink-ona-platform-codex-probe.
  --file FILE              Acceptance MP4 path. Auto-discovered under artifact-dir.
  --profile-dir DIR        Dedicated Chrome profile. Defaults under .minelink-dev.
  --no-prompt              Fail if the dedicated profile is not already logged in.
  --upload-only            Upload the attachment but do not comment on the PR.
  --update-secret          Also update MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE via gh secret set.
  --dry-run                Validate artifact paths and GitHub login, then stop before upload.`);
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

function candidateChromePaths() {
  const candidates = [];
  if (hasValue(args.chromePath)) candidates.push(args.chromePath);
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  }
  candidates.push("google-chrome", "google-chrome-stable", "chromium", "chromium-browser");
  return candidates;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveChrome() {
  for (const candidate of candidateChromePaths()) {
    if (candidate.includes("/") && (await fileExists(candidate))) return candidate;
    if (!candidate.includes("/")) {
      const result = spawnSync("command", ["-v", candidate], {
        encoding: "utf8",
        stdio: "pipe",
        shell: true,
      });
      const resolved = result.stdout.trim();
      if (result.status === 0 && resolved) return resolved;
    }
  }
  throw new Error("Could not find Chrome or Chromium. Set CHROME_PATH or pass --chrome.");
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${compact(text)}`);
  return JSON.parse(text);
}

async function waitForDebuggerUrl() {
  const startedAt = Date.now();
  const timeoutMs = Math.max(60, args.timeoutSeconds) * 1000;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const body = await fetchJson(`http://127.0.0.1:${args.port}/json/version`);
      if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
    } catch {
      // Chrome may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for Chrome DevTools Protocol.");
}

async function cdpCall(ws, method, params = {}) {
  const id = cdpCall.nextId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error(`CDP ${method} timed out`));
    }, 10000);
    function onMessage(event) {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      ws.removeEventListener("message", onMessage);
      if (payload.error) reject(new Error(`CDP ${method} failed: ${payload.error.message}`));
      else resolve(payload.result ?? {});
    }
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
cdpCall.nextId = 1;

async function readGithubCookies(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  try {
    const result = await cdpCall(ws, "Network.getAllCookies");
    return (result.cookies ?? []).filter((cookie) => {
      const domain = String(cookie.domain ?? "").replace(/^\./, "");
      return domain === "github.com" || domain.endsWith(".github.com");
    });
  } finally {
    ws.close();
  }
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

function buildCookieHeader(cookies) {
  const priority = new Map([
    ["logged_in", 1],
    ["dotcom_user", 2],
    ["user_session", 3],
    ["__Host-user_session_same_site", 4],
    ["_gh_sess", 5],
  ]);
  return cookies
    .filter((cookie) => hasValue(cookie.name) && hasValue(cookie.value))
    .sort((left, right) => (priority.get(left.name) ?? 100) - (priority.get(right.name) ?? 100))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function readCookieHeader(webSocketDebuggerUrl) {
  const cookies = await readGithubCookies(webSocketDebuggerUrl);
  report.cookieNames = [...new Set(cookies.map((cookie) => cookie.name))].sort();
  const header = buildCookieHeader(cookies);
  report.cookieSignals = cookieSignals(header);
  return header;
}

async function ensureGithubLogin(webSocketDebuggerUrl) {
  let cookieHeader = await readCookieHeader(webSocketDebuggerUrl);
  if (
    report.cookieSignals.hasLoggedIn &&
    report.cookieSignals.hasDotcomUser &&
    (report.cookieSignals.hasUserSession || report.cookieSignals.hasHostUserSessionSameSite)
  ) {
    return cookieHeader;
  }
  if (noPrompt) {
    throw new Error("Dedicated GitHub attachment profile is not logged in and --no-prompt was set.");
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question(
      "A dedicated Chrome window is open. Log in to GitHub there, then press Enter to publish the MineLink PR video. ",
    );
  } finally {
    rl.close();
  }
  cookieHeader = await readCookieHeader(webSocketDebuggerUrl);
  if (!report.cookieSignals.hasUserSession && !report.cookieSignals.hasHostUserSessionSameSite) {
    throw new Error("Dedicated browser profile does not contain a GitHub user_session cookie. Login may not be complete.");
  }
  if (!report.cookieSignals.hasLoggedIn || !report.cookieSignals.hasDotcomUser) {
    throw new Error("Dedicated browser profile does not look logged in to github.com.");
  }
  return cookieHeader;
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

async function writeCookieFile(cookieHeader) {
  const secretDir = path.join(".minelink-dev", "secrets");
  await fs.mkdir(secretDir, { recursive: true });
  args.tempCookieFile = path.join(secretDir, `github-user-attachments-${process.pid}-${randomBytes(4).toString("hex")}.cookie`);
  await fs.writeFile(args.tempCookieFile, cookieHeader, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(args.tempCookieFile, 0o600).catch(() => {});
}

function readJson(filePath) {
  return fs.readFile(filePath, "utf8").then((text) => JSON.parse(text));
}

async function updateCookieSecret(cookieHeader) {
  const result = spawnSync("gh", ["secret", "set", "MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE", "--repo", report.repository], {
    input: cookieHeader,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  report.secretUpdateStatus = result.status ?? 1;
  report.secretUpdateStdout = compact(result.stdout);
  report.secretUpdateStderr = compact(result.stderr);
  if (result.status !== 0) {
    throw new Error(`gh secret set failed: ${compact(result.stderr || result.stdout)}`);
  }
  report.secretUpdated = true;
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
    args.tempCookieFile,
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
  secretUpdateStatus: null,
  secretUpdateStdout: "",
  secretUpdateStderr: "",
  failures: [],
  boundary:
    "local trusted GitHub user-attachment publisher; it reads only the dedicated Chrome profile and never stores or prints GitHub web cookies in repository files",
};

let browser = null;
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

  const chrome = await resolveChrome();
  await fs.mkdir(args.profileDir, { recursive: true });
  browser = spawn(
    chrome,
    [
      `--remote-debugging-port=${args.port}`,
      `--user-data-dir=${args.profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      /^\d+$/.test(String(args.pr)) ? prUrl() : `https://github.com/${report.repository}/pulls`,
    ],
    { stdio: "ignore", detached: true },
  );

  const webSocketDebuggerUrl = await waitForDebuggerUrl();
  const cookieHeader = await ensureGithubLogin(webSocketDebuggerUrl);
  await writeCookieFile(cookieHeader);

  if (updateSecret) await updateCookieSecret(cookieHeader);
  if (dryRun) {
    report.result = "dry-run";
  } else {
    const env = await ghTokenEnv();
    await uploadAttachment(env);
    await commentOnPr(env);
    report.result = "passed";
  }
} catch (error) {
  report.result = "blocked";
  report.failures.push(compact(error?.message ?? error));
} finally {
  if (browser && !keepBrowser) {
    try {
      process.kill(-browser.pid, "SIGTERM");
    } catch {
      try {
        browser.kill("SIGTERM");
      } catch {
        // Best effort only.
      }
    }
  }
  if (hasValue(args.tempCookieFile)) {
    await fs.rm(args.tempCookieFile, { force: true }).catch(() => {});
  }
  await writeReport();
}

if (report.result === "blocked") {
  console.error(`GitHub local video publisher blocked; wrote ${args.output}`);
  process.exit(1);
}

console.log(`GitHub local video publisher ${report.result}; wrote ${args.output}`);
