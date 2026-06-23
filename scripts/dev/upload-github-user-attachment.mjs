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
report and exits successfully so the downstream release gate can fail closed.`);
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
  const response = await fetch(`https://api.github.com/repos/${args.repository}`, {
    headers: githubHeaders(),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub repository id lookup failed with HTTP ${response.status}: ${compact(text)}`);
  }
  const body = JSON.parse(text);
  if (!hasValue(body?.id)) throw new Error("GitHub repository id lookup did not return id.");
  return String(body.id);
}

async function uploadPolicy(repositoryId, fileName, size, contentType) {
  const response = await fetch("https://github.com/upload/policies/assets", {
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
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub user-attachment policy request failed with HTTP ${response.status}: ${compact(text)}`);
  }
  return JSON.parse(text);
}

async function uploadToObjectStore(policy, fileBlob) {
  const response = await fetch(policy.upload_url, {
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
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub user-attachment object upload failed with HTTP ${response.status}: ${compact(text)}`);
  }
}

async function finalizeUpload(policy) {
  const response = await fetch(new URL(policy.asset_upload_url, "https://github.com/").toString(), {
    method: "PUT",
    headers: webHeaders({
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    }),
    body: toForm({
      authenticity_token: policy.asset_upload_authenticity_token,
    }),
  });
  const text = await response.text();
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
    `Boundary: ${report.boundary}`,
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
  failures: [],
  boundary:
    "GitHub user-attachments transport only; release still requires Ona finalizer video, same-session Codex verifier, and check-video-review gate",
};

try {
  if (!hasValue(args.cookie)) {
    report.result = "skipped";
    report.failures.push(
      "MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE is not configured; cannot create a GitHub inline video attachment.",
    );
    if (requireUpload) throw new Error(report.failures[0]);
    await writeReports(report);
    console.log(`GitHub user attachment upload skipped; wrote ${args.output}`);
    process.exit(0);
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
  report.failures.push(compact(error?.message ?? error));
  await writeReports(report);
  console.error(`GitHub user attachment upload blocked; wrote ${args.output}`);
  process.exit(1);
}
