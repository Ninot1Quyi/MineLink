#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const defaults = {
  environmentId: process.env.MINELINK_ONA_ENVIRONMENT_ID ?? "",
  workingDir: process.env.MINELINK_ONA_WORKING_DIR ?? "/workspaces/MineLink",
  timeoutSeconds: Number(process.env.MINELINK_ONA_FINALIZER_TIMEOUT_SECONDS ?? 900),
  execTimeoutSeconds: Number(process.env.MINELINK_ONA_FINALIZER_EXEC_TIMEOUT_SECONDS ?? 45),
  pollSeconds: Number(process.env.MINELINK_ONA_FINALIZER_POLL_SECONDS ?? 15),
  taskId: process.env.MINELINK_TASK_ID ?? "manual",
  githubIssue: process.env.MINELINK_GITHUB_ISSUE ?? "none",
  linearIssue: process.env.MINELINK_LINEAR_ISSUE ?? "none",
  branch: process.env.MINELINK_BRANCH ?? "",
  commit: process.env.MINELINK_COMMIT ?? "",
  base: process.env.MINELINK_BASE_BRANCH ?? "codex/minelink-mvp-engineering",
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
  requireClientGuiCapture:
    process.env.MINELINK_REQUIRE_CLIENT_GUI_CAPTURE === "1" ||
    process.env.MINELINK_REQUIRE_CLIENT_GUI_CAPTURE === "true",
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
  else if (arg === "--exec-timeout-seconds") args.execTimeoutSeconds = Number(readValue());
  else if (arg === "--poll-seconds") args.pollSeconds = Number(readValue());
  else if (arg === "--task-id") args.taskId = readValue();
  else if (arg === "--github-issue") args.githubIssue = readValue();
  else if (arg === "--linear-issue") args.linearIssue = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--commit") args.commit = readValue();
  else if (arg === "--base") args.base = readValue();
  else if (arg === "--source-ref") args.sourceRef = readValue();
  else if (arg === "--pr-title") args.prTitle = readValue();
  else if (arg === "--acceptance-gate") args.acceptanceGate = readValue();
  else if (arg === "--validation-scope") args.validationScope = readValue();
  else if (arg === "--scenarios") args.scenarios = readValue();
  else if (arg === "--stage-group") args.stageGroup = readValue();
  else if (arg === "--video-producer") args.videoProducer = readValue();
  else if (arg === "--required-video-producer") args.requiredVideoProducer = readValue();
  else if (arg === "--require-client-gui-capture") args.requireClientGuiCapture = true;
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
  if (stage === "upload-video") {
    const command = [
      "node",
      "scripts/dev/upload-acceptance-video-storage.mjs",
      "--task-id",
      args.taskId,
      "--branch",
      args.branch,
      "--run-id",
      args.runId,
      "--require-upload",
    ];
    return command.map(shellQuote).join(" ");
  }

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
    "--commit",
    args.commit || "",
    "--base",
    args.base || "codex/minelink-mvp-engineering",
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
    ...(args.requireClientGuiCapture ? ["--require-client-gui-capture"] : []),
  ];
  return command.map(shellQuote).join(" ");
}

function remoteBranchName(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return normalized.startsWith("origin/") ? normalized.slice("origin/".length) : normalized;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runOnaExec(remoteScript, timeoutSeconds = args.execTimeoutSeconds) {
  const result = spawnSync(
    "ona",
    [
      "environment",
      "exec",
      args.environmentId,
      "--timeout",
      String(timeoutSeconds),
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
  const stderr = [payload?.stderr, payload?.result?.stderr, result.stderr].filter(Boolean).join("\n");
  return {
    result,
    payload,
    stdout,
    stderr,
    cliExitCode: result.status ?? 0,
    remoteExitCode: exitCode(payload, result.status),
    text: sanitize([stdout, stderr].filter(Boolean).join("\n")),
  };
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
if (!Number.isFinite(args.execTimeoutSeconds) || args.execTimeoutSeconds < 1) {
  failures.push("--exec-timeout-seconds must be at least 1");
}
if (!Number.isFinite(args.pollSeconds) || args.pollSeconds < 1) {
  failures.push("--poll-seconds must be at least 1");
}

const report = {
  generatedAt: new Date().toISOString(),
  result: "pending",
  environmentId: args.environmentId,
  workingDir: args.workingDir,
  taskId: args.taskId,
  branch: args.branch,
  commit: args.commit,
  sourceRef: args.sourceRef,
  stageGroup: args.stageGroup,
  base: args.base,
  stages: stageList(),
  execTimeoutSeconds: args.execTimeoutSeconds,
  pollSeconds: args.pollSeconds,
  pollAttempts: 0,
  videoProducer: args.videoProducer,
  requiredVideoProducer: args.requiredVideoProducer,
  requireClientGuiCapture: args.requireClientGuiCapture,
  tarOutput: args.tarOutput,
  injectedSourceFiles: [],
  injectedSourceScripts: [],
  extractedFiles: [],
  failures,
  commandExitCode: null,
  remotePid: "",
  execOutput: "",
  boundary:
    "Ona finalizer artifact bridge only. Platform Codex API readback remains the implementation/verifier evidence.",
};

const markerStart = "__MINELINK_FINALIZER_ARTIFACTS_TAR_BASE64_START__";
const markerEnd = "__MINELINK_FINALIZER_ARTIFACTS_TAR_BASE64_END__";
let extractedCurrentTarball = false;

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

  const sourceFiles = [
    { filePath: "ARCHITECTURE.md", executable: false },
    { filePath: "scripts/dev/run-agent-factory-stage.mjs", executable: true },
    { filePath: "scripts/dev/summarize-evidence.mjs", executable: true },
    { filePath: "scripts/dev/render-acceptance-video.mjs", executable: true },
    { filePath: "scripts/dev/render-client-capture-video.mjs", executable: true },
    { filePath: "scripts/dev/prepare-video-review-request.mjs", executable: true },
    { filePath: "scripts/dev/check-video-review.mjs", executable: true },
    { filePath: "scripts/dev/upload-acceptance-video-storage.mjs", executable: true },
    { filePath: "scripts/dev/e2e.sh", executable: true },
    { filePath: "scripts/dev/ensure-client-recorder-deps.sh", executable: true },
  ];
  const sourceScripts = sourceFiles.filter((file) => file.executable).map((file) => file.filePath);
  report.injectedSourceFiles = sourceFiles.map((file) => file.filePath);
  report.injectedSourceScripts = sourceScripts;

  if (failures.length === 0) {
    const remoteTarball = ".minelink-dev/ona-finalizer-artifacts.tar.gz";
    const remoteRunner = ".minelink-dev/ona-finalizer-runner.sh";
    const remoteLog = ".minelink-dev/reports/ona-finalizer-remote.log";
    const remoteDone = ".minelink-dev/reports/ona-finalizer-remote.done";
    const remoteExitCode = ".minelink-dev/reports/ona-finalizer-remote-exit-code";
    const remotePid = ".minelink-dev/reports/ona-finalizer-remote.pid";
    const finalizerBody = [
      "set -euo pipefail",
      `export ONA_ENVIRONMENT_ID=${shellQuote(args.environmentId)}`,
      `export MINELINK_RUN_ID=${shellQuote(args.runId)}`,
      exportIfValue("MINELINK_VIDEO_STORAGE_PROVIDER", args.videoStorageProvider),
      exportIfValue("MINELINK_VIDEO_STORAGE_ENDPOINT", args.videoStorageEndpoint),
      exportIfValue("MINELINK_VIDEO_STORAGE_REGION", args.videoStorageRegion),
      exportIfValue("MINELINK_VIDEO_STORAGE_BUCKET", args.videoStorageBucket),
      exportIfValue("MINELINK_VIDEO_PUBLIC_BASE_URL", args.videoStoragePublicBaseUrl),
      exportIfValue("MINELINK_VIDEO_STORAGE_PREFIX", args.videoStoragePrefix),
      exportIfValue("MINELINK_COMMIT", args.commit),
      "mkdir -p .minelink-dev/reports",
      ...transferredFiles.map(([filePath, base64]) => decodeRemoteFile(filePath, base64)).filter(Boolean),
      hasValue(args.sourceRef) ? `git fetch origin ${shellQuote(args.sourceRef)}` : "",
      hasValue(args.sourceRef) ? "finalizer_source_ref=$(git rev-parse FETCH_HEAD)" : "finalizer_source_ref=HEAD",
      hasValue(remoteBranchName(args.base))
        ? `git fetch origin ${shellQuote(remoteBranchName(args.base))}:${shellQuote(`refs/remotes/origin/${remoteBranchName(args.base)}`)} || git fetch origin ${shellQuote(remoteBranchName(args.base))}`
        : "",
      hasValue(args.commit) ? `finalizer_reviewed_commit=${shellQuote(args.commit)}` : "finalizer_reviewed_commit=",
      `git fetch origin ${shellQuote(args.branch)}`,
      `if [ -n "$finalizer_reviewed_commit" ]; then git fetch origin "$finalizer_reviewed_commit" || true; fi`,
      `if [ -n "$finalizer_reviewed_commit" ]; then git checkout -B ${shellQuote(args.branch)} "$finalizer_reviewed_commit"; else git checkout -B ${shellQuote(args.branch)} ${shellQuote(`origin/${args.branch}`)}; fi`,
      `if [ -n "$finalizer_reviewed_commit" ]; then case "$(git rev-parse HEAD)" in "$finalizer_reviewed_commit"*) ;; *) echo "Finalizer checkout mismatch: expected $finalizer_reviewed_commit got $(git rev-parse HEAD)" >&2; exit 65 ;; esac; fi`,
      args.stageGroup === "implementation-finalize"
        ? "rm -f .minelink-dev/reports/artifacts/video-review.md .minelink-dev/reports/artifacts/video-release-gate.md .minelink-dev/reports/video-storage-upload.md .minelink-dev/reports/video-storage-upload.json"
        : "",
      ...sourceFiles.map(({ filePath, executable }) =>
        [
          `mkdir -p ${shellQuote(path.posix.dirname(filePath))}`,
          `git show "$finalizer_source_ref:${filePath}" > ${shellQuote(filePath)}`,
          executable ? `chmod +x ${shellQuote(filePath)}` : "",
        ].join("\n"),
      ),
      ...stageList().map((stage) => stageCommand(stage)),
      "test -s .minelink-dev/reports/artifacts/acceptance.mp4",
      args.stageGroup === "implementation-finalize"
        ? "test -s .minelink-dev/reports/artifacts/video-review-request.md"
        : "",
      args.stageGroup === "release-upload" ? "test -s .minelink-dev/reports/video-storage-upload.json" : "",
    ]
      .filter(Boolean)
      .join("\n");

    const runnerScript = [
      "#!/usr/bin/env bash",
      "set -u -o pipefail",
      "mkdir -p .minelink-dev/reports .minelink-dev/reports/artifacts",
      `rm -f ${shellQuote(remoteDone)} ${shellQuote(remoteExitCode)} ${shellQuote(remoteTarball)}`,
      `(`,
      finalizerBody,
      `) > ${shellQuote(remoteLog)} 2>&1`,
      "status=$?",
      `printf '%s\\n' "$status" > ${shellQuote(remoteExitCode)}`,
      "tar_paths=(reports)",
      "while IFS= read -r -d '' candidate; do",
      "  tar_paths+=(\"${candidate#.minelink-dev/}\")",
      "done < <(find .minelink-dev -maxdepth 1 -type d -name 'client-capture-*' -print0 2>/dev/null || true)",
      `tar -C .minelink-dev -czf ${shellQuote(remoteTarball)} "\${tar_paths[@]}" >> ${shellQuote(remoteLog)} 2>&1 || true`,
      `touch ${shellQuote(remoteDone)}`,
      "exit 0",
    ].join("\n");
    const runnerBase64 = Buffer.from(runnerScript, "utf8").toString("base64");
    const startScript = [
      "set -euo pipefail",
      "mkdir -p .minelink-dev/reports",
      `printf %s ${shellQuote(runnerBase64)} | base64 -d > ${shellQuote(remoteRunner)}`,
      `chmod +x ${shellQuote(remoteRunner)}`,
      `nohup bash ${shellQuote(remoteRunner)} >/dev/null 2>&1 < /dev/null &`,
      `printf '%s\\n' "$!" > ${shellQuote(remotePid)}`,
      `cat ${shellQuote(remotePid)}`,
    ].join("\n");

    const start = runOnaExec(startScript);
    report.execOutput = start.text;
    report.commandExitCode = start.remoteExitCode;
    report.remotePid = start.stdout.trim().split(/\s+/).pop() ?? "";
    if (start.cliExitCode !== 0 || start.remoteExitCode !== 0) {
      failures.push(`ona environment exec failed to start finalizer runner: ${start.cliExitCode || start.remoteExitCode}`);
    }

    let done = false;
    let lastPollOutput = start.text;
    const deadline = Date.now() + args.timeoutSeconds * 1000;
    while (failures.length === 0 && !done) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await sleep(Math.min(args.pollSeconds * 1000, remainingMs));
      const pollScript = [
        "set -euo pipefail",
        `if test -f ${shellQuote(remoteDone)}; then`,
        "  echo __MINELINK_FINALIZER_REMOTE_DONE__",
        `  printf 'exit_code='; cat ${shellQuote(remoteExitCode)} 2>/dev/null || printf missing`,
        "  echo",
        "else",
        "  echo __MINELINK_FINALIZER_REMOTE_RUNNING__",
        `  printf 'pid='; cat ${shellQuote(remotePid)} 2>/dev/null || printf missing`,
        "  echo",
        "fi",
        "echo __MINELINK_FINALIZER_REMOTE_LOG_TAIL__",
        `tail -n 200 ${shellQuote(remoteLog)} 2>/dev/null || true`,
      ].join("\n");
      const poll = runOnaExec(pollScript);
      report.pollAttempts += 1;
      lastPollOutput = poll.text;
      if (poll.cliExitCode !== 0 || poll.remoteExitCode !== 0) {
        failures.push(`ona environment exec failed while polling finalizer runner: ${poll.cliExitCode || poll.remoteExitCode}`);
        break;
      }
      if (poll.stdout.includes("__MINELINK_FINALIZER_REMOTE_DONE__")) {
        done = true;
        const match = poll.stdout.match(/exit_code=(\d+)/);
        report.commandExitCode = match ? Number(match[1]) : 1;
      }
    }

    if (!done && failures.length === 0) {
      failures.push(`Ona finalizer remote runner timed out after ${args.timeoutSeconds}s.`);
      report.commandExitCode = 124;
    }

    if (done || failures.some((failure) => failure.includes("timed out"))) {
      const fetchScript = [
        "set -euo pipefail",
        `if test -s ${shellQuote(remoteTarball)}; then`,
        `  printf '\\n${markerStart}\\n'`,
        `  base64 ${shellQuote(remoteTarball)} | tr -d '\\n'`,
        `  printf '\\n${markerEnd}\\n'`,
        "else",
        "  echo __MINELINK_FINALIZER_REMOTE_NO_TARBALL__",
        "  echo __MINELINK_FINALIZER_REMOTE_LOG_TAIL__",
        `  tail -n 240 ${shellQuote(remoteLog)} 2>/dev/null || true`,
        "  exit 2",
        "fi",
      ].join("\n");
      const fetch = runOnaExec(fetchScript, Math.max(args.execTimeoutSeconds, 55));
      const start = fetch.stdout.indexOf(markerStart);
      const end = fetch.stdout.indexOf(markerEnd);
      if (fetch.cliExitCode !== 0 || fetch.remoteExitCode !== 0) {
        failures.push(`ona environment exec failed while fetching finalizer artifacts: ${fetch.cliExitCode || fetch.remoteExitCode}`);
      }
      if (start < 0 || end < 0 || end <= start) {
        failures.push("Ona finalizer output did not contain artifact tar markers.");
        lastPollOutput = [lastPollOutput, fetch.text].filter(Boolean).join("\n");
      } else {
        const base64 = fetch.stdout.slice(start + markerStart.length, end).replace(/\s+/g, "");
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
          } else {
            extractedCurrentTarball = true;
          }
        } catch (error) {
          failures.push(`Failed to decode/extract artifact tarball: ${error instanceof Error ? error.message : error}`);
        }
      }
    }

    if (report.commandExitCode !== 0) {
      failures.push(`Ona finalizer remote runner exited ${report.commandExitCode}`);
    }
    report.execOutput = sanitize(lastPollOutput);
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

report.extractedFiles = extractedCurrentTarball ? await walk(".minelink-dev/reports/artifacts") : [];
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
  `- Reviewed commit: \`${args.commit || "none"}\``,
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
  "## Injected Source Files",
  "",
  ...(report.injectedSourceFiles?.length > 0
    ? report.injectedSourceFiles.map((file) => `- \`${file}\``)
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
