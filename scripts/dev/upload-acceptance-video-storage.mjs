#!/usr/bin/env node
import { createHash, createHmac } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const defaults = {
  videoPath: process.env.MINELINK_ACCEPTANCE_VIDEO_PATH ?? ".minelink-dev/reports/artifacts/acceptance.mp4",
  summaryPath: process.env.MINELINK_ACCEPTANCE_SUMMARY_PATH ?? ".minelink-dev/reports/artifacts/acceptance-summary.md",
  originPath: process.env.MINELINK_ACCEPTANCE_VIDEO_ORIGIN_PATH ?? ".minelink-dev/reports/artifacts/acceptance-video-origin.json",
  taskId: process.env.MINELINK_TASK_ID ?? "",
  branch: process.env.MINELINK_BRANCH ?? process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME ?? "",
  commit: process.env.MINELINK_COMMIT ?? process.env.GITHUB_SHA ?? "",
  runId: process.env.GITHUB_RUN_ID ?? "local",
  producer: process.env.MINELINK_ACCEPTANCE_VIDEO_PRODUCER ?? "ona-task-finalizer",
  provider: process.env.MINELINK_VIDEO_STORAGE_PROVIDER ?? "",
  endpoint: process.env.MINELINK_VIDEO_STORAGE_ENDPOINT ?? "",
  region: process.env.MINELINK_VIDEO_STORAGE_REGION ?? "auto",
  bucket: process.env.MINELINK_VIDEO_STORAGE_BUCKET ?? "",
  accessKeyId: process.env.MINELINK_VIDEO_STORAGE_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.MINELINK_VIDEO_STORAGE_SECRET_ACCESS_KEY ?? "",
  publicBaseUrl: process.env.MINELINK_VIDEO_PUBLIC_BASE_URL ?? "",
  keyPrefix: process.env.MINELINK_VIDEO_STORAGE_PREFIX ?? "minelink/acceptance-videos",
  key: process.env.MINELINK_VIDEO_STORAGE_KEY ?? "",
  output: ".minelink-dev/reports/video-storage-upload.md",
  jsonOutput: ".minelink-dev/reports/video-storage-upload.json",
  manifestOutput: ".minelink-dev/reports/artifacts/video-storage-manifest.json",
};

const args = { ...defaults };
let requireUpload = false;
let dryRun = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--video-path") args.videoPath = readValue();
  else if (arg === "--summary-path") args.summaryPath = readValue();
  else if (arg === "--origin-path") args.originPath = readValue();
  else if (arg === "--task-id") args.taskId = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--commit") args.commit = readValue();
  else if (arg === "--run-id") args.runId = readValue();
  else if (arg === "--producer") args.producer = readValue();
  else if (arg === "--provider") args.provider = readValue();
  else if (arg === "--endpoint") args.endpoint = readValue();
  else if (arg === "--region") args.region = readValue();
  else if (arg === "--bucket") args.bucket = readValue();
  else if (arg === "--access-key-id") args.accessKeyId = readValue();
  else if (arg === "--secret-access-key") args.secretAccessKey = readValue();
  else if (arg === "--public-base-url") args.publicBaseUrl = readValue();
  else if (arg === "--key-prefix") args.keyPrefix = readValue();
  else if (arg === "--key") args.key = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--manifest-output") args.manifestOutput = readValue();
  else if (arg === "--require-upload") requireUpload = true;
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/upload-acceptance-video-storage.mjs --provider s3 --endpoint URL --bucket BUCKET --public-base-url URL

Uploads .minelink-dev/reports/artifacts/acceptance.mp4 to an S3-compatible
object store such as Cloudflare R2. Secret values are never printed. The
script writes a report and GitHub outputs:

  video-url=<public mp4 url>
  storage-key=<object key>

Set --require-upload in CI when PR video visibility must use external storage.`);
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

function pathSegment(value) {
  return String(value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "unknown";
}

function compact(text) {
  return String(text ?? "")
    .replace(/(AWS4-HMAC-SHA256 Credential=)[^,\s]+/g, "$1[redacted]")
    .replace(/(X-Amz-Credential=)[^&\s]+/g, "$1[redacted]")
    .replace(/(MINELINK_VIDEO_STORAGE_SECRET_ACCESS_KEY=)[^\s]+/g, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

function sha256(value, encoding = "hex") {
  return createHash("sha256").update(value).digest(encoding);
}

async function sha256File(filePath) {
  return sha256(await fs.readFile(filePath));
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value).digest(encoding);
}

function signingKey(secret, date, region, service) {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function amzDates(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    long: iso,
    short: iso.slice(0, 8),
  };
}

function encodePathPart(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function objectKey() {
  if (hasValue(args.key)) return args.key.replace(/^\/+/, "");
  return [
    args.keyPrefix.replace(/^\/+|\/+$/g, ""),
    pathSegment(args.taskId || "manual"),
    pathSegment(args.branch || "unknown-branch"),
    pathSegment(args.commit || "unknown-commit"),
    pathSegment(args.runId || "local"),
    "acceptance.mp4",
  ]
    .filter(Boolean)
    .join("/");
}

function publicUrl(key) {
  if (!hasValue(args.publicBaseUrl)) return "";
  return `${args.publicBaseUrl.replace(/\/+$/g, "")}/${key.split("/").map(encodePathPart).join("/")}`;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function putS3Object(key, body) {
  const endpoint = new URL(args.endpoint.replace(/\/+$/g, ""));
  const canonicalUri = `/${[args.bucket, ...key.split("/")].map(encodePathPart).join("/")}`;
  const url = new URL(canonicalUri, endpoint);
  const payloadHash = sha256(body);
  const dates = amzDates();
  const service = "s3";
  const region = args.region || "auto";
  const headers = {
    "content-type": "video/mp4",
    host: endpoint.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": dates.long,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]}\n`)
    .join("");
  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dates.short}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", dates.long, credentialScope, sha256(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(args.secretAccessKey, dates.short, region, service), stringToSign, "hex");
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${args.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": headers["content-type"],
      "x-amz-content-sha256": headers["x-amz-content-sha256"],
      "x-amz-date": headers["x-amz-date"],
      Authorization: authorization,
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`S3-compatible upload failed with HTTP ${response.status}: ${compact(text)}`);
  }
  return {
    endpointUrl: url.toString(),
    etag: response.headers.get("etag") ?? "",
  };
}

const report = {
  createdAt: new Date().toISOString(),
  result: "pending",
  taskId: args.taskId || "none",
  branch: args.branch || "none",
  commit: args.commit || "none",
  runId: args.runId || "none",
  producer: args.producer || "unknown",
  provider: args.provider || "none",
  storageProvider: args.provider || "none",
  endpointConfigured: hasValue(args.endpoint),
  bucketConfigured: hasValue(args.bucket),
  publicBaseUrlConfigured: hasValue(args.publicBaseUrl),
  accessKeyConfigured: hasValue(args.accessKeyId),
  secretKeyConfigured: hasValue(args.secretAccessKey),
  videoPath: args.videoPath,
  summaryPath: args.summaryPath,
  originPath: args.originPath,
  videoSize: 0,
  mp4Sha256: "",
  summarySha256: "",
  clientGuiCapture: false,
  clientWorldReady: false,
  captureStartedAfterWorldReady: false,
  recorderAutoFollow: false,
  videoKind: "unknown",
  key: "",
  objectKey: "",
  videoUrl: "",
  endpointUrl: "",
  etag: "",
  manifestOutput: args.manifestOutput,
  boundary: "candidate video upload only; release requires same-session Codex verifier approval",
  dryRun,
  failures: [],
};

if (!(await exists(args.videoPath))) report.failures.push(`Acceptance video is missing: ${args.videoPath}`);
if (!(await exists(args.summaryPath))) report.failures.push(`Acceptance summary is missing: ${args.summaryPath}`);
if (!hasValue(args.provider)) report.failures.push("MINELINK_VIDEO_STORAGE_PROVIDER or --provider is required.");
if (hasValue(args.provider) && !/^s3|r2$/i.test(args.provider)) {
  report.failures.push(`Unsupported video storage provider: ${args.provider}. Use s3 or r2.`);
}
if (!hasValue(args.endpoint)) report.failures.push("MINELINK_VIDEO_STORAGE_ENDPOINT or --endpoint is required.");
if (!hasValue(args.bucket)) report.failures.push("MINELINK_VIDEO_STORAGE_BUCKET or --bucket is required.");
if (!hasValue(args.accessKeyId)) {
  report.failures.push("MINELINK_VIDEO_STORAGE_ACCESS_KEY_ID or --access-key-id is required.");
}
if (!hasValue(args.secretAccessKey)) {
  report.failures.push("MINELINK_VIDEO_STORAGE_SECRET_ACCESS_KEY or --secret-access-key is required.");
}
if (!hasValue(args.publicBaseUrl)) {
  report.failures.push("MINELINK_VIDEO_PUBLIC_BASE_URL or --public-base-url is required for reviewer-visible playback.");
}

if (report.failures.length === 0) {
  const key = objectKey();
  const body = await fs.readFile(args.videoPath);
  const origin = await readJsonIfPresent(args.originPath);
  report.videoSize = body.length;
  report.key = key;
  report.objectKey = key;
  report.videoUrl = publicUrl(key);
  report.mp4Sha256 = sha256(body);
  report.summarySha256 = await sha256File(args.summaryPath);
  report.videoKind = origin?.videoKind ?? "unknown";
  report.clientGuiCapture = origin?.clientGuiCapture === true;
  report.clientWorldReady = origin?.clientWorldReady === true;
  report.captureStartedAfterWorldReady = origin?.captureStartedAfterWorldReady === true;
  report.recorderAutoFollow = origin?.recorderAutoFollow === true;
  if (dryRun) {
    report.result = "passed";
    report.endpointUrl = "dry-run";
  } else {
    try {
      const result = await putS3Object(key, body);
      report.endpointUrl = result.endpointUrl;
      report.etag = result.etag;
      report.result = "passed";
    } catch (error) {
      report.result = "failed";
      report.failures.push(error instanceof Error ? error.message : String(error));
    }
  }
} else {
  report.result = requireUpload ? "failed" : "skipped";
}

const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput && report.result === "passed") {
  await fs.appendFile(
    githubOutput,
    [
      `video-url=${report.videoUrl}`,
      `raw-video-url=${report.videoUrl}`,
      `storage-key=${report.key}`,
      `video-sha256=${report.mp4Sha256}`,
      `video-manifest=${args.manifestOutput}`,
    ].join("\n") + "\n",
    "utf8",
  );
}

const manifest = {
  taskId: report.taskId,
  branch: report.branch,
  commit: report.commit,
  runId: report.runId,
  producer: report.producer,
  videoUrl: report.videoUrl,
  storageProvider: report.storageProvider.toLowerCase(),
  bucket: args.bucket || "",
  objectKey: report.objectKey,
  mp4Sha256: report.mp4Sha256,
  summarySha256: report.summarySha256,
  clientGuiCapture: report.clientGuiCapture,
  clientWorldReady: report.clientWorldReady,
  captureStartedAfterWorldReady: report.captureStartedAfterWorldReady,
  recorderAutoFollow: report.recorderAutoFollow,
  videoKind: report.videoKind,
  createdAt: report.createdAt,
  boundary: report.boundary,
};

if (report.result === "passed") {
  await fs.mkdir(path.dirname(args.manifestOutput), { recursive: true });
  await fs.writeFile(args.manifestOutput, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

const lines = [
  "# MineLink Acceptance Video Storage Upload",
  "",
  `- Result: \`${report.result}\``,
  `- Task id: \`${report.taskId}\``,
  `- Branch: \`${report.branch}\``,
  `- Commit: \`${report.commit}\``,
  `- Run id: \`${report.runId}\``,
  `- Producer: \`${report.producer}\``,
  `- Provider: \`${report.provider}\``,
  `- Video path: \`${report.videoPath}\``,
  `- Video size: \`${report.videoSize}\``,
  `- MP4 SHA256: \`${report.mp4Sha256 || "none"}\``,
  `- Summary SHA256: \`${report.summarySha256 || "none"}\``,
  `- Client GUI capture: \`${report.clientGuiCapture ? "yes" : "no"}\``,
  `- Client world ready: \`${report.clientWorldReady ? "yes" : "no"}\``,
  `- Capture started after world ready: \`${report.captureStartedAfterWorldReady ? "yes" : "no"}\``,
  `- Recorder auto-follow: \`${report.recorderAutoFollow ? "yes" : "no"}\``,
  `- Storage key: \`${report.key || "none"}\``,
  `- Public video URL: ${report.videoUrl || "none"}`,
  `- Manifest: \`${args.manifestOutput}\``,
  `- Endpoint configured: \`${report.endpointConfigured ? "yes" : "no"}\``,
  `- Bucket configured: \`${report.bucketConfigured ? "yes" : "no"}\``,
  `- Public base URL configured: \`${report.publicBaseUrlConfigured ? "yes" : "no"}\``,
  `- Access key configured: \`${report.accessKeyConfigured ? "yes" : "no"}\``,
  `- Secret key configured: \`${report.secretKeyConfigured ? "yes" : "no"}\``,
  `- ETag: \`${report.etag || "none"}\``,
  "",
  "## Failures",
  "",
  ...(report.failures.length > 0 ? report.failures.map((failure) => `- ${failure}`) : ["- none"]),
  "",
  "## Boundary",
  "",
  `- ${report.boundary}. It does not change MineLink product acceptance status.`,
  "",
];

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, lines.join("\n"), "utf8");
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(
  args.jsonOutput,
  `${JSON.stringify({ ...report, endpointUrl: report.endpointUrl ? "[redacted-signed-endpoint]" : "" }, null, 2)}\n`,
  "utf8",
);

if (report.result === "failed" && requireUpload) {
  console.error(`Acceptance video storage upload failed; wrote ${args.output}`);
  process.exit(1);
}

console.log(`Acceptance video storage upload ${report.result}; wrote ${args.output}`);
