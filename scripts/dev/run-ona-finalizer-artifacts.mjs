#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const defaults = {
  environmentId: process.env.MINELINK_ONA_ENVIRONMENT_ID ?? "",
  workingDir: process.env.MINELINK_ONA_WORKING_DIR ?? "/workspaces/MineLink",
  timeoutSeconds: Number(process.env.MINELINK_ONA_FINALIZER_TIMEOUT_SECONDS ?? 900),
  taskId: process.env.MINELINK_TASK_ID ?? "manual",
  githubIssue: process.env.MINELINK_GITHUB_ISSUE ?? "none",
  linearIssue: process.env.MINELINK_LINEAR_ISSUE ?? "none",
  branch: process.env.MINELINK_BRANCH ?? "",
  sourceRef:
    process.env.MINELINK_FINALIZER_SOURCE_REF ??
    process.env.GITHUB_REF_NAME ??
    process.env.GITHUB_SHA ??
    "codex/gh-3-agent-factory-pilot",
  prTitle: process.env.MINELINK_PR_TITLE ?? "",
  acceptanceGate: process.env.MINELINK_ACCEPTANCE_GATE ?? "unspecified",
  validationScope: process.env.MINELINK_VALIDATION_SCOPE ?? "docs",
  scenarios: process.env.MINELINK_SCENARIOS ?? "none",
  stageGroup: process.env.MINELINK_ONA_FINALIZER_STAGE_GROUP ?? "implementation-finalize",
  videoProducer: process.env.MINELINK_ACCEPTANCE_VIDEO_PRODUCER ?? "ona-task-finalizer",
  requiredVideoProducer:
    process.env.MINELINK_ACCEPTANCE_VIDEO_REQUIRED_PRODUCER ??
    process.env.MINELINK_ACCEPTANCE_VIDEO_PRODUCER ??
    "ona-task-finalizer",
  runId: process.env.GITHUB_RUN_ID ?? process.env.MINELINK_RUN_ID ?? "local",
  videoStorageProvider: process.env.MINELINK_VIDEO_STORAGE_PROVIDER ?? "",
  videoStorageEndpoint: process.env.MINELINK_VIDEO_STORAGE_ENDPOINT ?? "",
  videoStorageRegion: process.env.MINELINK_VIDEO_STORAGE_REGION ?? "auto",
  videoStorageBucket: process.env.MINELINK_VIDEO_STORAGE_BUCKET ?? "",
  videoStoragePublicBaseUrl: process.env.MINELINK_VIDEO_PUBLIC_BASE_URL ?? "",
  videoStoragePrefix: process.env.MINELINK_VIDEO_STORAGE_PREFIX ?? "minelink/acceptance-videos",
  implementationReadback: ".minelink-dev/reports/ona-codex-implementation-session.md",
  implementationReadbackJson: ".minelink-dev/reports/ona-codex-implementation-session.json",
  apiReadback: ".minelink-dev/reports/ona-platform-codex-api-session.md",
  apiReadbackJson: ".minelink-dev/reports/ona-platform-codex-api-session.json",
  verifierReadback: ".minelink-dev/reports/ona-codex-video-verifier-session.md",
  verifierReadbackJson: ".minelink-dev/reports/ona-codex-video-verifier-session.json",
  verifierApiReadback: ".minelink-dev/reports/ona-platform-codex-video-verifier-api-session.md",
  verifierApiReadbackJson: ".minelink-dev/reports/ona-platform-codex-video-verifier-api-session.json",
  videoReview: ".minelink-dev/reports/artifacts/video-review.md",
  output: ".minelink-dev/reports/ona-finalizer-artifacts.md",
  jsonOutput: ".minelink-dev/reports/ona-finalizer-artifacts.json",
  tarOutput: ".minelink-dev/reports/ona-finalizer-artifacts.tar.gz",
};

const args = { ...defaults };

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--environment-id") args.environmentId = readValue();
  else if (arg === "--working-dir") args.workingDir = readValue();
  else if (arg === "--timeout-seconds") args.timeoutSeconds = Number(readValue());
  else if (arg === "--task-id") args.taskId = readValue();
  else if (arg === "--github-issue") args.githubIssue = readValue();
  else if (arg === "--linear-issue") args.linearIssue = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--source-ref") args.sourceRef = readValue();
  else if (arg === "--pr-title") args.prTitle = readValue();
  else if (arg === "--acceptance-gate") args.acceptanceGate = readValue();
  else if (arg === "--validation-scope") args.validationScope = readValue();
  else if (arg === "--scenarios") args.scenarios = readValue();
  else if (arg === "--stage-group") args.stageGroup = readValue();
  else if (arg === "--video-producer") args.videoProducer = readValue();
  else if (arg === "--required-video-producer") args.requiredVideoProducer = readValue();
  else if (arg === "--run-id") args.runId = readValue();
  else if (arg === "--video-storage-provider") args.videoStorageProvider = readValue();
  else if (arg === "--video-storage-endpoint") args.videoStorageEndpoint = readValue();
  else if (arg === "--video-storage-region") args.videoStorageRegion = readValue();
  else if (arg === "--video-storage-bucket") args.videoStorageBucket = readValue();
  else if (arg === "--video-storage-public-base-url") args.videoStoragePublicBaseUrl = readValue();
  else if (arg === "--video-storage-prefix") args.videoStoragePrefix = readValue();
  else if (arg === "--implementation-readback") args.implementationReadback = readValue();
  else if (arg === "--implementation-readback-json") args.implementationReadbackJson = readValue();
  else if (arg === "--api-readback") args.apiReadback = readValue();
  else if (arg === "--api-readback-json") args.apiReadbackJson = readValue();
  else if (arg === "--verifier-readback") args.verifierReadback = readValue();
  else if (arg === "--verifier-readback-json") args.verifierReadbackJson = readValue();
  else if (arg === "--verifier-api-readback") args.verifierApiReadback = readValue();
  else if (arg === "--verifier-api-readback-json") args.verifierApiReadbackJson = readValue();
  else if (arg === "--video-review") args.videoReview = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--tar-output") args.tarOutput = readValue();
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/run-ona-finalizer-artifacts.mjs --environment-id ID --task-id gh-123 --branch codex/branch

Runs MineLink finalizer artifact stages inside an existing Ona task
environment, then copies .minelink-dev/reports back to the local runner. Use
--stage-group implementation-finalize to render acceptance.mp4 and
video-review-request.md, then --stage-group release-upload after the same
Platform Codex execution writes video-review.md. This is an artifact/finalizer
bridge only; Platform Codex implementation/verifier evidence remains the
accepted agent execution proof. Internally this uses ona environment exec, not
the default Ona Agent.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

function hasValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 && !["none", "null", "undefined", "-"].includes(normalized.toLowerCase());
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/(lin_api_)[A-Za-z0-9]+/g, "$1[redacted]")
    .replace(/(github_pat_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(ghp_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .slice(0, 6000)
    .trim();
}

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

function shellDoubleQuote(value) {
  return `"${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")}"`;
}

async function readBase64IfPresent(filePath) {
  try {
    return (await fs.readFile(filePath)).toString("base64");
  } catch {
    return "";
  }
}

function decodeRemoteFile(filePath, base64) {
  if (!base64) return "";
  return [
    `mkdir -p ${shellQuote(path.posix.dirname(filePath))}`,
    `printf %s ${shellQuote(base64)} | base64 -d > ${shellQuote(filePath)}`,
  ].join("\n");
}

function overwriteSourceScript(filePath, base64) {
  return [
    `mkdir -p ${shellQuote(path.posix.dirname(filePath))}`,
    `printf %s ${shellQuote(base64)} | base64 -d > ${shellQuote(filePath)}`,
    `chmod +x ${shellQuote(filePath)}`,
  ].join("\n");
}

function exportIfValue(name, value) {
  return hasValue(value) ? `export ${name}=${shellQuote(value)}` : "";
}

function stageCommand(stage) {
  const command = [
    "node",
    "scripts/dev/run-agent-factory-stage.mjs",
    "--stage",
    stage,
    "--task-id",
    args.taskId,
    "--github-issue",
    args.githubIssue || "none",
    "--linear-issue",
    args.linearIssue || "none",
    "--branch",
    args.branch,
    "--pr-title",
    args.prTitle || `Advance ${args.taskId}`,
    "--acceptance-gate",
    args.acceptanceGate || "unspecified",
    "--validation-scope",
    args.validationScope || "docs",
    "--scenarios",
    args.scenarios || "none",
    "--video-producer",
    args.videoProducer || "ona-task-finalizer",
    "--required-video-producer",
    args.requiredVideoProducer || args.videoProducer || "ona-task-finalizer",
  ];
  return command.map(shellQuote).join(" ");
}

function extractJsonOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed[0] ?? {} : parsed;
  } catch {
    return { raw: text };
  }
}

function outputText(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  return (
    payload.stdout ??
    payload.stderr ??
    payload.output ??
    payload.result?.stdout ??
    payload.result?.stderr ??
    payload.result?.output ??
    payload.logs ??
    fallback
  );
}

function exitCode(payload, fallbackStatus) {
  const value =
    payload?.exitCode ??
    payload?.exit_code ??
    payload?.status?.exitCode ??
    payload?.status?.exit_code ??
    payload?.result?.exitCode ??
    payload?.result?.exit_code;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return fallbackStatus ?? 0;
}

function stageList() {
  if (args.stageGroup === "implementation-finalize") {
    return ["validate", "summarize", "render-video", "prepare-video"];
  }
  if (args.stageGroup === "release-upload") {
    return ["check-video-release", "upload-video", "final-report"];
  }
  return args.stageGroup
    .split(",")
    .map((stage) => stage.trim())
    .filter(Boolean);
}

const failures = [];
if (!hasValue(args.environmentId)) failures.push("--environment-id is required");
if (!hasValue(args.branch)) failures.push("--branch is required");
if (!hasValue(args.taskId) || args.taskId === "manual") failures.push("--task-id must be task-bound");
if (!["implementation-finalize", "release-upload"].includes(args.stageGroup) && stageList().length === 0) {
  failures.push("--stage-group must be implementation-finalize, release-upload, or a comma-separated stage list");
}
if (!Number.isFinite(args.timeoutSeconds) || args.timeoutSeconds < 1) {
  failures.push("--timeout-seconds must be at least 1");
}

const report = {
  generatedAt: new Date().toISOString(),
  result: "pending",
  environmentId: args.environmentId,
  workingDir: args.workingDir,
  taskId: args.taskId,
  branch: args.branch,
  sourceRef: args.sourceRef,
  stageGroup: args.stageGroup,
  stages: stageList(),
  videoProducer: args.videoProducer,
  requiredVideoProducer: args.requiredVideoProducer,
  tarOutput: args.tarOutput,
  injectedSourceScripts: [],
  extractedFiles: [],
  failures,
  commandExitCode: null,
  execOutput: "",
  boundary:
    "Ona finalizer artifact bridge only. Platform Codex API readback remains the implementation/verifier evidence.",
};

const markerStart = "__MINELINK_FINALIZER_ARTIFACTS_TAR_BASE64_START__";
const markerEnd = "__MINELINK_FINALIZER_ARTIFACTS_TAR_BASE64_END__";

if (failures.length === 0) {
  const transferredFiles = [
    [".minelink-dev/reports/ona-codex-implementation-session.md", await readBase64IfPresent(args.implementationReadback)],
    [".minelink-dev/reports/ona-codex-implementation-session.json", await readBase64IfPresent(args.implementationReadbackJson)],
    [".minelink-dev/reports/ona-platform-codex-api-session.md", await readBase64IfPresent(args.apiReadback)],
    [".minelink-dev/reports/ona-platform-codex-api-session.json", await readBase64IfPresent(args.apiReadbackJson)],
    [".minelink-dev/reports/ona-codex-video-verifier-session.md", await readBase64IfPresent(args.verifierReadback)],
    [".minelink-dev/reports/ona-codex-video-verifier-session.json", await readBase64IfPresent(args.verifierReadbackJson)],
    [
      ".minelink-dev/reports/ona-platform-codex-video-verifier-api-session.md",
      await readBase64IfPresent(args.verifierApiReadback),
    ],
    [
      ".minelink-dev/reports/ona-platform-codex-video-verifier-api-session.json",
      await readBase64IfPresent(args.verifierApiReadbackJson),
    ],
    [".minelink-dev/reports/artifacts/video-review.md", await readBase64IfPresent(args.videoReview)],
  ];
  if (!transferredFiles[0][1]) {
    failures.push(`Missing implementation readback to transfer: ${args.implementationReadback}`);
  }
  if (args.stageGroup === "release-upload" && !transferredFiles[8][1]) {
    failures.push(`Missing verifier video review to transfer: ${args.videoReview}`);
  }

  const sourceScripts = [
    "scripts/dev/run-agent-factory-stage.mjs",
    "scripts/dev/summarize-evidence.mjs",
    "scripts/dev/render-acceptance-video.mjs",
    "scripts/dev/prepare-video-review-request.mjs",
    "scripts/dev/check-video-review.mjs",
    "scripts/dev/upload-acceptance-video-storage.mjs",
  ];
  report.injectedSourceScripts = sourceScripts;

  if (failures.length === 0) {
    const remoteScript = [
      "set -euo pipefail",
      `export ONA_ENVIRONMENT_ID=${shellQuote(args.environmentId)}`,
      `export MINELINK_RUN_ID=${shellQuote(args.runId)}`,
      exportIfValue("MINELINK_VIDEO_STORAGE_PROVIDER", args.videoStorageProvider),
      exportIfValue("MINELINK_VIDEO_STORAGE_ENDPOINT", args.videoStorageEndpoint),
      exportIfValue("MINELINK_VIDEO_STORAGE_REGION", args.videoStorageRegion),
      exportIfValue("MINELINK_VIDEO_STORAGE_BUCKET", args.videoStorageBucket),
      exportIfValue("MINELINK_VIDEO_PUBLIC_BASE_URL", args.videoStoragePublicBaseUrl),
      exportIfValue("MINELINK_VIDEO_STORAGE_PREFIX", args.videoStoragePrefix),
      "mkdir -p .minelink-dev/reports",
      ...transferredFiles.map(([filePath, base64]) => decodeRemoteFile(filePath, base64)).filter(Boolean),
      hasValue(args.sourceRef) ? `git fetch origin ${shellQuote(args.sourceRef)}` : "",
      hasValue(args.sourceRef) ? "finalizer_source_ref=FETCH_HEAD" : "finalizer_source_ref=HEAD",
      `git fetch origin ${shellQuote(args.branch)}`,
      `git checkout -B ${shellQuote(args.branch)} ${shellQuote(`origin/${args.branch}`)}`,
      ...sourceScripts.map((filePath) =>
        [
          `mkdir -p ${shellQuote(path.posix.dirname(filePath))}`,
          `git show "$finalizer_source_ref:${filePath}" > ${shellQuote(filePath)}`,
          `chmod +x ${shellQuote(filePath)}`,
        ].join("\n"),
      ),
      ...stageList().map((stage) => stageCommand(stage)),
      "test -s .minelink-dev/reports/artifacts/acceptance.mp4",
      args.stageGroup === "implementation-finalize"
        ? "test -s .minelink-dev/reports/artifacts/video-review-request.md"
        : "",
      args.stageGroup === "release-upload" ? "test -s .minelink-dev/reports/video-storage-upload.json" : "",
      `printf '\\n${markerStart}\\n'`,
      "tar -C .minelink-dev -czf - reports | base64 | tr -d '\\n'",
      `printf '\\n${markerEnd}\\n'`,
    ]
      .filter(Boolean)
      .join("\n");

    const result = spawnSync(
      "ona",
      [
        "environment",
        "exec",
        args.environmentId,
        "--timeout",
        String(args.timeoutSeconds),
        "--working-dir",
        args.workingDir,
        "--format",
        "json",
        "--",
        "bash",
        "-lc",
        shellDoubleQuote(remoteScript),
      ],
      { encoding: "utf8", stdio: "pipe" },
    );
    const payload = extractJsonOutput(result.stdout);
    const stdout = String(outputText(payload, result.stdout) ?? "");
    report.commandExitCode = exitCode(payload, result.status);
    report.execOutput = sanitize(
      [
        stdout,
        payload?.stderr,
        payload?.result?.stderr,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );

    const start = stdout.indexOf(markerStart);
    const end = stdout.indexOf(markerEnd);
    if (result.status !== 0 || report.commandExitCode !== 0) {
      failures.push(`ona environment exec exited ${result.status ?? report.commandExitCode ?? 1}`);
    }
    if (start < 0 || end < 0 || end <= start) {
      failures.push("Ona finalizer output did not contain artifact tar markers.");
    } else {
      const base64 = stdout.slice(start + markerStart.length, end).replace(/\s+/g, "");
      try {
        const tarball = Buffer.from(base64, "base64");
        await fs.mkdir(path.dirname(args.tarOutput), { recursive: true });
        await fs.writeFile(args.tarOutput, tarball);
        const tar = spawnSync("tar", ["-xzf", args.tarOutput, "-C", ".minelink-dev"], {
          encoding: "utf8",
          stdio: "pipe",
        });
        if (tar.status !== 0) {
          failures.push(`tar extraction failed: ${sanitize(tar.stderr || tar.stdout)}`);
        }
      } catch (error) {
        failures.push(`Failed to decode/extract artifact tarball: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}

async function walk(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await walk(fullPath)));
      else if (entry.isFile()) files.push(fullPath);
    }
    return files.sort();
  } catch {
    return [];
  }
}

report.extractedFiles = await walk(".minelink-dev/reports/artifacts");
report.failures = failures;
report.result = failures.length === 0 ? "passed" : "failed";

const lines = [
  "# MineLink Ona Finalizer Artifacts",
  "",
  `- Generated: \`${report.generatedAt}\``,
  `- Result: \`${report.result}\``,
  `- Environment: \`${args.environmentId || "none"}\``,
  `- Working directory: \`${args.workingDir}\``,
  `- Task id: \`${args.taskId}\``,
  `- Branch: \`${args.branch || "none"}\``,
  `- Video producer: \`${args.videoProducer || "none"}\``,
  `- Required video producer: \`${args.requiredVideoProducer || "none"}\``,
  `- Tarball: \`${args.tarOutput}\``,
  `- Boundary: \`${report.boundary}\``,
  "",
  "## Injected Source Scripts",
  "",
  ...(report.injectedSourceScripts.length > 0
    ? report.injectedSourceScripts.map((file) => `- \`${file}\``)
    : ["- none"]),
  "",
  "## Extracted Artifact Files",
  "",
  ...(report.extractedFiles.length > 0 ? report.extractedFiles.map((file) => `- \`${file}\``) : ["- none"]),
  "",
  "## Failures",
  "",
  ...(failures.length > 0 ? failures.map((failure) => `- ${failure}`) : ["- none"]),
  "",
  "## Ona Exec Output",
  "",
  report.execOutput ? ["```text", report.execOutput, "```"].join("\n") : "- none",
  "",
];

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, `${lines.join("\n")}\n`, "utf8");
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (report.result !== "passed") {
  console.error(`Ona finalizer artifact bridge failed; wrote ${args.output}`);
  process.exit(1);
}

console.log(`Ona finalizer artifact bridge passed; wrote ${args.output}`);
