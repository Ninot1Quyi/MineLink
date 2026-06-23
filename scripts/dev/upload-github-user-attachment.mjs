#!/usr/bin/env node
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const defaults = {
  repository: process.env.GITHUB_REPOSITORY ?? "",
  repositoryId: process.env.MINELINK_GITHUB_REPOSITORY_ID ?? "",
  filePath: process.env.MINELINK_ACCEPTANCE_VIDEO_PATH ?? ".minelink-dev/reports/artifacts/acceptance.mp4",
  name: process.env.MINELINK_GITHUB_ATTACHMENT_NAME ?? "acceptance.mp4",
  contentType: process.env.MINELINK_GITHUB_ATTACHMENT_CONTENT_TYPE ?? "",
  cookie: process.env.MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE ?? process.env.GITHUB_USER_ATTACHMENTS_COOKIE ?? "",
  token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "",
  attempts: Number(process.env.MINELINK_GITHUB_ATTACHMENT_UPLOAD_ATTEMPTS ?? 3),
  retryDelayMs: Number(process.env.MINELINK_GITHUB_ATTACHMENT_RETRY_DELAY_MS ?? 1500),
  timeoutMs: Number(process.env.MINELINK_GITHUB_ATTACHMENT_TIMEOUT_MS ?? 30000),
  output: ".minelink-dev/reports/github-user-attachment-upload.md",
  jsonOutput: ".minelink-dev/reports/github-user-attachment-upload.json",
};

const args = { ...defaults };
let requireUpload = false;
let dryRun = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repository") args.repository = readValue();
  else if (arg === "--repository-id") args.repositoryId = readValue();
  else if (arg === "--file") args.filePath = readValue();
  else if (arg === "--name") args.name = readValue();
  else if (arg === "--content-type") args.contentType = readValue();
  else if (arg === "--cookie") args.cookie = readValue();
  else if (arg === "--token") args.token = readValue();
  else if (arg === "--attempts") args.attempts = Number(readValue());
  else if (arg === "--retry-delay-ms") args.retryDelayMs = Number(readValue());
  else if (arg === "--timeout-ms") args.timeoutMs = Number(readValue());
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--require-upload") requireUpload = true;
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/upload-github-user-attachment.mjs --repository owner/repo --file acceptance.mp4

Uploads a validated acceptance MP4 to GitHub's issue/PR user-attachments
storage so PR Markdown can render the MP4 as an inline GitHub video player.

This uses GitHub's web attachment flow, which currently requires a GitHub web
session cookie in MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE. PAT/GITHUB_TOKEN can
read the repository id, but cannot create user-attachments by itself. If the
cookie is missing and --require-upload is not set, the script writes a skipped
report and exits successfully so the downstream release gate can fail closed.

Reliability options:
  --attempts N          Retry count for transient web/object-store failures.
  --retry-delay-ms N    Base retry delay in milliseconds.
  --timeout-ms N        Per-request timeout in milliseconds.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

const mimeByExt = {
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mov: "video/quicktime",
  mp4: "video/mp4",
  png: "image/png",
  webm: "video/webm",
};

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

function boundedNumber(value, fallback, min, max) {
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

args.attempts = boundedNumber(args.attempts, 3, 1, 8);
args.retryDelayMs = boundedNumber(args.retryDelayMs, 1500, 100, 30000);
args.timeoutMs = boundedNumber(args.timeoutMs, 30000, 1000, 120000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableHttpStatus(status) {
  return [408, 409, 423, 425, 429, 500, 502, 503, 504].includes(status);
}

function classifyFailure(message) {
  const text = String(message ?? "").toLowerCase();
  if (text.includes("not configured")) return "missing-github-web-cookie";
  if (text.includes("policy request failed with http 401") || text.includes("policy request failed with http 403")) {
    return "github-web-cookie-rejected";
  }
  if (text.includes("policy request failed")) return "github-attachment-policy-failed";
  if (text.includes("object upload failed")) return "github-attachment-object-upload-failed";
  if (text.includes("finalization failed")) return "github-attachment-finalization-failed";
  if (text.includes("did not return asset.href")) return "github-attachment-missing-href";
  if (text.includes("repository id lookup failed")) return "github-repository-id-lookup-failed";
  return "unknown";
}

function cookieSignals(cookie) {
  const text = String(cookie ?? "");
  return {
    present: hasValue(text),
    hasLoggedIn: /(?:^|;\s*)logged_in=yes(?:;|$)/.test(text),
    hasDotcomUser: /(?:^|;\s*)dotcom_user=/.test(text),
    hasGhSess: /(?:^|;\s*)_gh_sess=/.test(text),
    hasUserSession: /(?:^|;\s*)user_session=/.test(text),
    hasHostUserSessionSameSite: /(?:^|;\s*)__Host-user_session_same_site=/.test(text),
  };
}

function contentTypeFor(fileName) {
  if (hasValue(args.contentType)) return args.contentType;
  const extension = String(fileName).split(".").pop()?.toLowerCase() ?? "";
  return mimeByExt[extension] ?? "application/octet-stream";
}

function githubHeaders(extra = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
  if (hasValue(args.token)) headers.Authorization = `Bearer ${args.token}`;
  return headers;
}

function webHeaders(extra = {}) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Origin: "https://github.com",
    Referer: `https://github.com/${args.repository || ""}`,
    ...extra,
  };
  if (hasValue(args.cookie)) headers.Cookie = args.cookie;
  return headers;
}

function toForm(values) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (value instanceof Blob) form.append(key, value, value.name || undefined);
    else form.append(key, String(value));
  }
  return form;
}

async function readRepositoryId() {
  if (hasValue(args.repositoryId)) return args.repositoryId;
  if (!/^[^/\s]+\/[^/\s]+$/.test(args.repository)) {
    throw new Error("--repository must be owner/repo when --repository-id is omitted.");
  }
  const { response, text } = await requestText("github-repository-id", `https://api.github.com/repos/${args.repository}`, {
    headers: githubHeaders(),
  });
  if (!response.ok) {
    throw new Error(`GitHub repository id lookup failed with HTTP ${response.status}: ${compact(text)}`);
  }
  const body = JSON.parse(text);
  if (!hasValue(body?.id)) throw new Error("GitHub repository id lookup did not return id.");
  return String(body.id);
}

async function uploadPolicy(repositoryId, fileName, size, contentType) {
  const { response, text } = await requestText("github-attachment-policy", "https://github.com/upload/policies/assets", {
    method: "POST",
    headers: webHeaders({
      "GitHub-Verified-Fetch": "true",
      "X-Requested-With": "XMLHttpRequest",
    }),
    body: toForm({
      repository_id: repositoryId,
      name: fileName,
      size,
      content_type: contentType,
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub user-attachment policy request failed with HTTP ${response.status}: ${compact(text)}`);
  }
  return JSON.parse(text);
}

async function uploadToObjectStore(policy, fileBlob) {
  const { response, text } = await requestText("github-attachment-object-upload", policy.upload_url, {
    method: "POST",
    headers: webHeaders({
      ...(policy.same_origin ? { authenticity_token: policy.upload_authenticity_token } : {}),
      ...(policy.header ?? {}),
    }),
    body: toForm({
      ...(policy.form ?? {}),
      file: fileBlob,
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub user-attachment object upload failed with HTTP ${response.status}: ${compact(text)}`);
  }
}

async function finalizeUpload(policy) {
  const { response, text } = await requestText(
    "github-attachment-finalization",
    new URL(policy.asset_upload_url, "https://github.com/").toString(),
    {
    method: "PUT",
    headers: webHeaders({
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    }),
    body: toForm({
      authenticity_token: policy.asset_upload_authenticity_token,
    }),
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub user-attachment finalization failed with HTTP ${response.status}: ${compact(text)}`);
  }
}

async function writeReports(report) {
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
  const lines = [
    "# GitHub User Attachment Upload",
    "",
    `Result: ${report.result}`,
    `File: ${report.filePath}`,
    `Name: ${report.name}`,
    `Content type: ${report.contentType || "missing"}`,
    `Size: ${report.size ?? "missing"}`,
    `SHA256: ${report.sha256 || "missing"}`,
    `Repository: ${report.repository || "missing"}`,
    `Repository id: ${report.repositoryId || "missing"}`,
    `Attachment URL: ${report.href || "missing"}`,
    `Failure kind: ${report.failureKind || "none"}`,
    `Attempts: ${report.attempts.length}`,
    `Boundary: ${report.boundary}`,
    "",
    "## Cookie Signals",
    "",
    ...Object.entries(report.cookieSignals).map(([key, value]) => `- ${key}: \`${value ? "yes" : "no"}\``),
    "",
    "## Attempt Log",
    "",
    ...(report.attempts.length === 0
      ? ["- none"]
      : report.attempts.map(
          (attempt) =>
            `- ${attempt.phase} attempt ${attempt.attempt}: ${attempt.status} in ${attempt.durationMs}ms${attempt.retryable ? " (retryable)" : ""}${attempt.message ? ` - ${attempt.message}` : ""}`,
        )),
    "",
    "## Failures",
    "",
    ...(report.failures.length === 0 ? ["- none"] : report.failures.map((failure) => `- ${failure}`)),
    "",
  ];
  await fs.writeFile(args.output, `${lines.join("\n")}\n`, "utf8");
  await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (process.env.GITHUB_OUTPUT) {
    const outputs = [`result=${report.result}`];
    if (hasValue(report.href)) outputs.push(`video-url=${report.href}`);
    if (hasValue(report.id)) outputs.push(`asset-id=${report.id}`);
    await fs.appendFile(process.env.GITHUB_OUTPUT, `${outputs.join("\n")}\n`, "utf8");
  }
}

async function requestText(phase, url, options) {
  let lastError = null;
  for (let attempt = 1; attempt <= args.attempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(args.timeoutMs),
      });
      const text = await response.text();
      const retryable = !response.ok && retryableHttpStatus(response.status) && attempt < args.attempts;
      report.attempts.push({
        phase,
        attempt,
        status: response.status,
        durationMs: Date.now() - startedAt,
        retryable,
        message: response.ok ? "" : compact(text),
      });
      if (!retryable) return { response, text };
      await sleep(args.retryDelayMs * attempt);
    } catch (error) {
      const message = compact(error?.message ?? error);
      const retryable = attempt < args.attempts;
      lastError = new Error(`${phase} request failed: ${message}`);
      report.attempts.push({
        phase,
        attempt,
        status: "network-error",
        durationMs: Date.now() - startedAt,
        retryable,
        message,
      });
      if (!retryable) break;
      await sleep(args.retryDelayMs * attempt);
    }
  }
  throw lastError ?? new Error(`${phase} request failed`);
}

const report = {
  createdAt: new Date().toISOString(),
  result: "pending",
  repository: args.repository || "none",
  repositoryId: args.repositoryId || "",
  filePath: args.filePath,
  name: args.name,
  contentType: "",
  size: 0,
  sha256: "",
  id: "",
  href: "",
  asset: null,
  failureKind: "",
  cookieSignals: cookieSignals(args.cookie),
  attempts: [],
  failures: [],
  boundary:
    "GitHub user-attachments transport only; release still requires Ona finalizer video, same-session Codex verifier, and check-video-review gate",
};

try {
  if (!hasValue(args.cookie)) {
    report.result = "skipped";
    report.failureKind = "missing-github-web-cookie";
    report.failures.push(
      "MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE is not configured; cannot create a GitHub inline video attachment.",
    );
    if (requireUpload) throw new Error(report.failures[0]);
    await writeReports(report);
    console.log(`GitHub user attachment upload skipped; wrote ${args.output}`);
    process.exit(0);
  }

  const signals = report.cookieSignals;
  if (!signals.hasUserSession && !signals.hasHostUserSessionSameSite) {
    report.failures.push(
      "MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE is present but does not include common GitHub web session markers; upload may fail if the cookie is incomplete.",
    );
  }

  const buffer = await fs.readFile(args.filePath);
  report.size = buffer.byteLength;
  report.sha256 = createHash("sha256").update(buffer).digest("hex");
  report.contentType = contentTypeFor(args.name || path.basename(args.filePath));

  if (dryRun) {
    report.result = "dry-run";
    report.repositoryId = args.repositoryId || "dry-run";
    await writeReports(report);
    console.log(`GitHub user attachment upload dry-run passed; wrote ${args.output}`);
    process.exit(0);
  }

  const repositoryId = await readRepositoryId();
  report.repositoryId = repositoryId;
  const blob = new Blob([buffer], { type: report.contentType });
  blob.name = args.name || path.basename(args.filePath);

  const policy = await uploadPolicy(repositoryId, blob.name, blob.size, report.contentType);
  await uploadToObjectStore(policy, blob);
  await finalizeUpload(policy);

  report.asset = policy.asset ?? null;
  report.id = String(policy.asset?.id ?? "");
  report.href = policy.asset?.href ?? "";
  if (!hasValue(report.href)) throw new Error("GitHub user-attachment upload did not return asset.href.");
  report.result = "passed";
  await writeReports(report);
  console.log(`GitHub user attachment upload passed; wrote ${args.output}`);
} catch (error) {
  report.result = "blocked";
  const message = compact(error?.message ?? error);
  report.failureKind = classifyFailure(message);
  report.failures.push(message);
  await writeReports(report);
  console.error(`GitHub user attachment upload blocked; wrote ${args.output}`);
  process.exit(1);
}
