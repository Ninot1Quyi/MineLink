#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_ONA_AGENT_ID = "00000000-0000-0000-0000-000000007100";
const DEFAULT_PROJECT_ID = "019ee8ed-9e1b-7cd8-9b1b-af0c8ee27edb";

const defaults = {
  apiBase: process.env.MINELINK_ONA_API_BASE ?? "https://app.gitpod.io/api",
  organizationId: process.env.MINELINK_ONA_ORGANIZATION_ID ?? "",
  projectId: process.env.MINELINK_ONA_PROJECT_ID ?? DEFAULT_PROJECT_ID,
  environmentId: process.env.MINELINK_ONA_ENVIRONMENT_ID ?? "",
  environmentName: process.env.MINELINK_ONA_ENVIRONMENT_NAME ?? "",
  environmentWaitSeconds: Number(process.env.MINELINK_ONA_ENVIRONMENT_WAIT_SECONDS ?? 600),
  environmentPollSeconds: Number(process.env.MINELINK_ONA_ENVIRONMENT_POLL_SECONDS ?? 10),
  sessionId: process.env.MINELINK_ONA_SESSION_ID ?? "",
  codexAgentId: process.env.MINELINK_ONA_CODEX_AGENT_ID ?? "",
  taskId: process.env.MINELINK_TASK_ID ?? "manual",
  branch: process.env.MINELINK_BRANCH ?? "",
  commit: process.env.MINELINK_COMMIT ?? "",
  githubIssue: process.env.MINELINK_GITHUB_ISSUE ?? "",
  linearIssue: process.env.MINELINK_LINEAR_ISSUE ?? "",
  videoReviewRequest: process.env.MINELINK_VIDEO_REVIEW_REQUEST ?? ".minelink-dev/reports/artifacts/video-review-request.md",
  model: process.env.MINELINK_ONA_CODEX_MODEL ?? "CODEX_OPEN_AI_MODEL_GPT_5_5",
  reasoningEffort: process.env.MINELINK_ONA_CODEX_REASONING_EFFORT ?? "CODEX_REASONING_EFFORT_EXTRA_HIGH",
  serviceTier: process.env.MINELINK_ONA_CODEX_SERVICE_TIER ?? "CODEX_SERVICE_TIER_FAST",
  agentMode: process.env.MINELINK_ONA_CODEX_AGENT_MODE ?? "AGENT_MODE_GOAL",
  name: process.env.MINELINK_ONA_CODEX_RUN_NAME ?? "",
  prompt: "",
  promptFile: "",
  readbackExecution: process.env.MINELINK_ONA_AGENT_EXECUTION_ID ?? "",
  waitSeconds: Number(process.env.MINELINK_ONA_CODEX_WAIT_SECONDS ?? 30),
  pollSeconds: Number(process.env.MINELINK_ONA_CODEX_POLL_SECONDS ?? 5),
  output: ".minelink-dev/reports/ona-platform-codex-api-session.md",
  jsonOutput: ".minelink-dev/reports/ona-platform-codex-api-session.json",
};

const args = { ...defaults };
let discoverPolicies = false;
let startAgent = false;
let sendPrompt = true;
let dryRun = false;
let promptMode = "";
let createEnvironment = process.env.MINELINK_ONA_CREATE_ENVIRONMENT === "1";

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--discover-policies") discoverPolicies = true;
  else if (arg === "--start") startAgent = true;
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "--no-send") sendPrompt = false;
  else if (arg === "--identity-canary") promptMode = "identity-canary";
  else if (arg === "--implementation-canary") promptMode = "implementation-canary";
  else if (arg === "--video-verifier-canary") promptMode = "video-verifier-canary";
  else if (arg === "--api-base") args.apiBase = readValue();
  else if (arg === "--organization-id") args.organizationId = readValue();
  else if (arg === "--project-id") args.projectId = readValue();
  else if (arg === "--environment-id") args.environmentId = readValue();
  else if (arg === "--environment-name") args.environmentName = readValue();
  else if (arg === "--environment-wait-seconds") args.environmentWaitSeconds = Number(readValue());
  else if (arg === "--environment-poll-seconds") args.environmentPollSeconds = Number(readValue());
  else if (arg === "--create-environment") createEnvironment = true;
  else if (arg === "--session-id") args.sessionId = readValue();
  else if (arg === "--codex-agent-id") args.codexAgentId = readValue();
  else if (arg === "--task-id") args.taskId = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--commit") args.commit = readValue();
  else if (arg === "--github-issue") args.githubIssue = readValue();
  else if (arg === "--linear-issue") args.linearIssue = readValue();
  else if (arg === "--video-review-request") args.videoReviewRequest = readValue();
  else if (arg === "--model") args.model = readValue();
  else if (arg === "--reasoning-effort") args.reasoningEffort = readValue();
  else if (arg === "--service-tier") args.serviceTier = readValue();
  else if (arg === "--agent-mode") args.agentMode = readValue();
  else if (arg === "--name") args.name = readValue();
  else if (arg === "--prompt") args.prompt = readValue();
  else if (arg === "--prompt-file") args.promptFile = readValue();
  else if (arg === "--readback-execution") args.readbackExecution = readValue();
  else if (arg === "--wait-seconds") args.waitSeconds = Number(readValue());
  else if (arg === "--poll-seconds") args.pollSeconds = Number(readValue());
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/start-ona-platform-codex.mjs [options]

Starts or inspects an Ona Platform Codex agent execution through the documented
Ona AgentService API. The script never omits agentId and refuses the known
default Ona automation agent id.

Options:
  --discover-policies          Call GetOrganizationPolicies for allowed Codex settings.
  --start                      Call StartAgent with --codex-agent-id and codexSettings.
  --identity-canary            Send a read-only identity canary prompt after StartAgent.
  --implementation-canary      Send a bounded docs-only task canary prompt.
  --video-verifier-canary      Send a bounded video-verifier canary prompt.
  --prompt <text>              Prompt to send via SendToAgentExecution.
  --prompt-file <path>         Prompt file to send via SendToAgentExecution.
  --readback-execution <id>    Call GetAgentExecution for an existing execution id.
                                With a prompt mode or --prompt, send that
                                prompt to the existing execution first.
  --codex-agent-id <uuid>      Required for --start; also read from MINELINK_ONA_CODEX_AGENT_ID.
  --project-id <uuid>          Ona project id. Defaults to the MineLink project id.
  --organization-id <uuid>     Ona organization id for --discover-policies.
  --environment-id <uuid>      Explicit running Ona environment id for in-environment agents.
  --agent-mode <enum>          AgentService mode. Defaults to AGENT_MODE_GOAL.
  --create-environment         Create and poll a fresh task environment before StartAgent.
  --dry-run                    Validate inputs and write the request body without API calls.

Environment:
  GITPOD_API_KEY or ONA_TOKEN must contain an Ona personal access token for
  non-dry-run API calls. Secret values are never printed.
`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!discoverPolicies && !startAgent && !args.readbackExecution) {
  discoverPolicies = true;
}

function shouldSendPromptToExistingExecution() {
  return (
    !startAgent &&
    sendPrompt &&
    hasValue(args.readbackExecution) &&
    (hasValue(args.prompt) || hasValue(args.promptFile) || hasValue(promptMode))
  );
}

function identityCanaryPrompt() {
  return [
    "This is a MineLink platform identity canary.",
    "Use Ona Platform Codex, not the default Ona Agent.",
    "First reply in the session with exactly this line:",
    "Identity: I am Codex running in Ona Platform Codex",
    "Then stop. Do not edit files, do not run validation, and do not create a PR.",
  ].join(" ");
}

function pathSegment(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "manual";
}

function implementationCanaryPath() {
  return `docs/agent-factory-canaries/${pathSegment(args.taskId)}.md`;
}

function videoVerifierCanaryPath() {
  return `docs/agent-factory-canaries/${pathSegment(args.taskId)}-video-verifier.md`;
}

async function readTextIfPresent(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function requestValue(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text ?? "").match(new RegExp(`^-?\\s*${escaped}:\\s*` + "`?(.+?)`?\\s*$", "im"));
  return match?.[1]?.trim() ?? "";
}

function implementationCanaryPrompt(context = {}) {
  const sessionId = context.agentExecutionId || "<agentExecutionId>";
  const canaryPath = implementationCanaryPath();
  return [
    "This is a MineLink Platform Codex implementation canary.",
    "You must use Ona Platform Codex, not the default Ona Agent.",
    "First reply in the session with exactly this line:",
    "Identity: I am Codex running in Ona Platform Codex",
    "",
    "Task:",
    `- Task id: ${args.taskId}`,
    `- Target branch: ${args.branch}`,
    `- Source commit: ${args.commit}`,
    `- GitHub issue: ${args.githubIssue || "none"}`,
    `- Linear issue: ${args.linearIssue || "none"}`,
    `- Ona AgentService execution id: ${sessionId}`,
    `- Requested agent execution mode: ${args.agentMode}`,
    `- Canary file: ${canaryPath}`,
    "",
    "Scope:",
    `- Create or switch to branch ${args.branch}.`,
    `- Add or update only ${canaryPath}.`,
    "- Do not edit runtime code, schemas, tests, CI, acceptance gates, secrets, EULA files, or product docs outside that canary file.",
    "- Do not claim MineLink product acceptance.",
    "",
    "Required canary file content:",
    "- Include a heading: MineLink Platform Codex Implementation Canary.",
    "- Include these exact marker lines with the current values:",
    "  Agent mode: Ona Platform Codex",
    `  Agent execution mode: ${args.agentMode}`,
    "  Identity: I am Codex running in Ona Platform Codex",
    `  Session id: ${sessionId}`,
    "  Platform evidence: Ona AgentService StartAgent launched the configured Codex agent id with codexSettings; GitHub runner will verify the API readback separately.",
    `  Task id: ${args.taskId}`,
    `  Branch: ${args.branch}`,
    "  Result: passed",
    "  Validation: bash scripts/dev/verify-agent-task.sh --scope docs",
    "  Validation result: passed",
    "  Boundary: implementation-canary only; does not prove MineLink product acceptance.",
    "- Include a short Remaining gaps line saying video verifier, PR release, and full product acceptance are still separate gates.",
    "",
    "Validation:",
    "- Run: bash scripts/dev/verify-agent-task.sh --scope docs",
    "- If validation fails, fix only the canary file if the failure is caused by the canary file. Otherwise stop and write Result: blocked in the canary file with the blocker.",
    "",
    "Git:",
    "- Commit the canary file with an English Lore commit message explaining that this proves a bounded Platform Codex task handoff.",
    "- Push the target branch to origin.",
    "- Do not create a PR for this canary unless the user explicitly asks.",
  ].join("\n");
}

async function videoVerifierCanaryPrompt(context = {}) {
  const sessionId = context.agentExecutionId || "<agentExecutionId>";
  const canaryPath = videoVerifierCanaryPath();
  const request = await readTextIfPresent(args.videoReviewRequest);
  const summaryHash = requestValue(request, "Summary sha256") || "missing";
  const mp4Hash = requestValue(request, "MP4 sha256") || "missing";
  const videoProducer = requestValue(request, "Video producer") || "unknown";
  const clientGuiCapture = requestValue(request, "Client GUI capture") || "unknown";
  const clientWorldReady = requestValue(request, "Client world ready") || "unknown";
  const captureStartedAfterWorldReady = requestValue(request, "Capture started after world ready") || "unknown";
  const recorderAutoFollow = requestValue(request, "Recorder auto-follow") || "unknown";
  const recorderClientFollow = requestValue(request, "Recorder client follow") || "unknown";
  const clientGuiCaptureRequired = requestValue(request, "Client GUI capture required") || "no";
  const requestTaskId = requestValue(request, "Task id") || args.taskId;
  const requestBranch = requestValue(request, "Branch") || args.branch;
  const canaryContent = [
    "# MineLink Platform Codex Video Verifier Canary",
    "",
    "Agent mode: Ona Platform Codex",
    "Identity: I am Codex running in Ona Platform Codex",
    `Session id: ${sessionId}`,
    `Agent execution mode: ${args.agentMode}`,
    "Platform evidence: Ona AgentService readback shows the configured Codex agent id with codexSettings, and the implementation execution received a same-session verifier subagent request.",
    "Verifier: Ona Platform Codex",
    "Release decision: pass",
    "Task matched: yes",
    "Video matched: yes",
    `Video producer: ${videoProducer}`,
    `Client GUI capture: ${clientGuiCapture}`,
    `Client world ready: ${clientWorldReady}`,
    `Capture started after world ready: ${captureStartedAfterWorldReady}`,
    `Recorder auto-follow: ${recorderAutoFollow}`,
    `Recorder client follow: ${recorderClientFollow}`,
    `Summary sha256: ${summaryHash}`,
    `MP4 sha256: ${mp4Hash}`,
    `Task id: ${args.taskId}`,
    `Branch: ${args.branch}`,
    `Commit: ${args.commit}`,
    "Result: passed",
    "Boundary: video-verifier-canary only; does not prove MineLink product acceptance.",
    "Remaining gaps: PR release, status writeback, and full product acceptance are still separate gates.",
    "",
  ].join("\n");

  return [
    "This is a MineLink Platform Codex video-verifier canary.",
    "You must use Ona Platform Codex, not the default Ona Agent.",
    "First reply in the session with exactly this line:",
    "Identity: I am Codex running in Ona Platform Codex",
    "",
    "Task:",
    `- Task id: ${args.taskId}`,
    `- Review request task id: ${requestTaskId}`,
    `- Target branch: ${args.branch}`,
    `- Review request branch: ${requestBranch}`,
    `- Reviewed commit: ${args.commit}`,
    `- GitHub issue: ${args.githubIssue || "none"}`,
    `- Linear issue: ${args.linearIssue || "none"}`,
    `- Ona AgentService execution id: ${sessionId}`,
    `- Requested agent execution mode: ${args.agentMode}`,
    `- Video-verifier canary file: ${canaryPath}`,
    `- Acceptance summary sha256: ${summaryHash}`,
    `- Acceptance MP4 sha256: ${mp4Hash}`,
    `- Acceptance video producer: ${videoProducer}`,
    `- Client GUI capture: ${clientGuiCapture}`,
    `- Client world ready: ${clientWorldReady}`,
    `- Capture started after world ready: ${captureStartedAfterWorldReady}`,
    `- Recorder auto-follow: ${recorderAutoFollow}`,
    `- Recorder client follow: ${recorderClientFollow}`,
    `- Client GUI capture required: ${clientGuiCaptureRequired}`,
    "",
    "Critical path:",
    "1. Launch a bounded native Codex subagent/verifier inside this same implementation session.",
    `2. Immediately create or switch to branch ${args.branch}.`,
    `3. Immediately write exactly the canary content below to ${canaryPath}.`,
    "4. Commit that file with an English Lore commit message.",
    "5. Push the target branch to origin.",
    "6. Stop after reporting the pushed commit. Do not keep working after the push.",
    "",
    "Scope:",
    `- Add or update only ${canaryPath}.`,
    "- Do not edit runtime code, schemas, tests, CI, acceptance gates, secrets, EULA files, product docs outside that canary file, or .minelink-dev artifacts.",
    "- Do not run build, tests, NeoForge, npm, Gradle, or verification scripts.",
    "- Canary boundary: use the embedded review-request hashes below; do not re-render the video, and do not claim MineLink product acceptance.",
    "",
    "Exact canary file content:",
    "```md",
    canaryContent.trim(),
    "```",
    "",
    "Git:",
    "- Commit the canary file with an English Lore commit message explaining why this proves a bounded same-session Platform Codex video verifier handoff.",
    "- Push the target branch to origin.",
    "- Do not create a PR for this canary unless the user explicitly asks.",
  ].join("\n");
}

function token() {
  return process.env.GITPOD_API_KEY || process.env.ONA_TOKEN || process.env.GITPOD_TOKEN || "";
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/(gitpod_pat_)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .replace(/(ona_pat_)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .replace(/(lin_api_)[A-Za-z0-9]+/g, "$1[redacted]")
    .replace(/(github_pat_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(ghp_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(sk-[A-Za-z0-9_-]+)/g, "[redacted]")
    .slice(0, 5000)
    .trim();
}

function hasValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 && !["none", "null", "undefined", "-"].includes(normalized.toLowerCase());
}

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, { encoding: "utf8", stdio: "pipe" });
}

function readOnaConfig() {
  const result = run("ona", ["config", "get", "-o", "json"]);
  if (result.status !== 0) return {};
  try {
    const parsed = JSON.parse(result.stdout);
    if (Array.isArray(parsed)) return parsed[0] ?? {};
    return parsed;
  } catch {
    return {};
  }
}

function environmentProjectId(environment) {
  return (
    environment?.projectId ??
    environment?.metadata?.projectId ??
    environment?.spec?.projectId ??
    environment?.project?.id ??
    environment?.context?.projectId ??
    ""
  );
}

function environmentPhase(environment) {
  return environment?.status?.phase ?? environment?.phase ?? "";
}

function environmentCreatedAt(environment) {
  return environment?.metadata?.createdAt ?? environment?.createdAt ?? "";
}

function environmentRank(environment) {
  const phase = environmentPhase(environment);
  if (/RUNNING/i.test(phase)) return 0;
  if (/STARTING|CREATING|UPDATING/i.test(phase)) return 1;
  if (/STOPPED/i.test(phase)) return 2;
  return 3;
}

function isRunningEnvironment(environment) {
  return (
    /^ENVIRONMENT_PHASE_RUNNING$/i.test(environmentPhase(environment)) &&
    /^PHASE_RUNNING$/i.test(environment?.status?.machine?.phase ?? "")
  );
}

function discoverRunningEnvironmentId(projectId) {
  if (!hasValue(projectId)) return "";
  const result = run("ona", ["environment", "list", "-o", "json", "--limit", "1000"]);
  if (result.status !== 0) return "";
  try {
    const parsed = JSON.parse(result.stdout);
    const environments = Array.isArray(parsed) ? parsed : [parsed];
    const candidates = environments
      .filter((environment) => environmentProjectId(environment) === projectId)
      .filter((environment) => hasValue(environment?.id))
      .filter((environment) => !/DELETING|DELETED/i.test(environmentPhase(environment)))
      .filter((environment) => isRunningEnvironment(environment))
      .sort((left, right) => {
        const rankDelta = environmentRank(left) - environmentRank(right);
        if (rankDelta !== 0) return rankDelta;
        return String(environmentCreatedAt(right)).localeCompare(String(environmentCreatedAt(left)));
      });
    return candidates[0]?.id ?? "";
  } catch {
    return "";
  }
}

function environmentName() {
  const base = args.environmentName || `minelink-${pathSegment(args.taskId)}-${pathSegment(args.commit)}`;
  return base.slice(0, 80);
}

function extractEnvironmentId(output) {
  const text = String(output ?? "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    const record = Array.isArray(parsed) ? parsed[0] : parsed;
    if (hasValue(record?.id)) return record.id;
  } catch {
    // Fall back to CLI text output.
  }
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? "";
}

function firstRecord(value) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function getEnvironment(environmentId) {
  const result = run("ona", ["environment", "get", environmentId, "-o", "json"]);
  if (result.status !== 0) {
    const err = new Error(`ona environment get ${environmentId} failed: ${sanitize(result.stderr || result.stdout)}`);
    err.status = result.status;
    throw err;
  }
  return firstRecord(JSON.parse(result.stdout));
}

async function waitForRunningEnvironment(environmentId) {
  const attempts = [];
  const deadline = Date.now() + args.environmentWaitSeconds * 1000;
  let latest = null;
  do {
    latest = getEnvironment(environmentId);
    attempts.push({
      at: new Date().toISOString(),
      phase: environmentPhase(latest),
      machinePhase: latest?.status?.machine?.phase ?? "",
      devcontainerPhase: latest?.status?.devcontainer?.phase ?? "",
      contentPhase: latest?.status?.content?.phase ?? "",
      branch: latest?.status?.content?.git?.branch ?? "",
      prebuildId: latest?.metadata?.prebuildId ?? "",
    });
    if (isRunningEnvironment(latest) || Date.now() >= deadline || args.environmentWaitSeconds === 0) break;
    await sleep(args.environmentPollSeconds * 1000);
  } while (Date.now() < deadline);
  return { latest, attempts };
}

async function createTaskEnvironment(report) {
  const name = environmentName();
  const result = run("ona", [
    "environment",
    "create",
    args.projectId,
    "--dont-wait",
    "--name",
    name,
    "--timeout",
    "60s",
  ]);
  if (result.status !== 0) {
    throw new Error(`ona environment create failed: ${sanitize(result.stderr || result.stdout)}`);
  }
  const environmentId = extractEnvironmentId(result.stdout);
  if (!hasValue(environmentId)) {
    throw new Error(`ona environment create did not return an environment id: ${sanitize(result.stdout)}`);
  }
  args.environmentId = environmentId;
  report.environmentId = environmentId;
  report.environmentBootstrap.created = true;
  report.environmentBootstrap.name = name;
  report.environmentBootstrap.createOutput = sanitize(result.stdout);
  report.steps.push("CreateEnvironment");

  const { latest, attempts } = await waitForRunningEnvironment(environmentId);
  report.steps.push("GetEnvironment");
  report.environmentBootstrap.readback = latest;
  report.environmentBootstrap.attempts = attempts;
  const phase = environmentPhase(latest);
  const machinePhase = latest?.status?.machine?.phase ?? "";
  const prebuildId = latest?.metadata?.prebuildId ?? "";
  report.evidence.push(`environment=${environmentId}`);
  report.evidence.push(`environmentPhase=${phase || "missing"}`);
  if (hasValue(machinePhase)) report.evidence.push(`environmentMachinePhase=${machinePhase}`);
  if (hasValue(prebuildId)) report.evidence.push(`environmentPrebuild=${prebuildId}`);
  if (!isRunningEnvironment(latest)) {
    throw new Error(
      `Created environment ${environmentId} did not reach running state before --environment-wait-seconds=${args.environmentWaitSeconds}: ${phase || "missing"}/${machinePhase || "missing"}.`,
    );
  }
}

function git(argsList) {
  const result = run("git", argsList);
  return result.status === 0 ? result.stdout.trim() : "";
}

const onaConfig = readOnaConfig();
const explicitEnvironmentId = hasValue(args.environmentId);
if (!args.organizationId) args.organizationId = onaConfig.organizationId ?? "";
if (!args.branch) args.branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
if (!args.commit) args.commit = git(["rev-parse", "--short", "HEAD"]) || "unknown";
if (!explicitEnvironmentId && !createEnvironment) args.environmentId = discoverRunningEnvironmentId(args.projectId);

async function readPrompt(context = {}) {
  if (hasValue(args.promptFile)) return fs.readFile(args.promptFile, "utf8");
  if (hasValue(args.prompt)) return args.prompt;
  if (promptMode === "implementation-canary") return implementationCanaryPrompt(context);
  if (promptMode === "video-verifier-canary") return videoVerifierCanaryPrompt(context);
  return identityCanaryPrompt();
}

function codexSettings() {
  return {
    model: args.model,
    reasoningEffort: args.reasoningEffort,
    serviceTier: args.serviceTier,
  };
}

function annotations() {
  return Object.fromEntries(
    [
      ["minelink/task-id", args.taskId],
      ["minelink/branch", args.branch],
      ["minelink/commit", args.commit],
      ["minelink/github-issue", args.githubIssue],
      ["minelink/linear-issue", args.linearIssue],
      ["minelink/agent-mode", "ona-platform-codex"],
      ["minelink/agent-execution-mode", args.agentMode],
    ].filter(([, value]) => hasValue(value)),
  );
}

function startBody() {
  const codeContext = {};
  if (hasValue(args.environmentId)) codeContext.environmentId = args.environmentId;
  else if (hasValue(args.projectId)) codeContext.projectId = args.projectId;
  const body = {
    agentId: args.codexAgentId,
    annotations: annotations(),
    codeContext,
    codexSettings: codexSettings(),
    mode: args.agentMode,
    name: args.name || `MineLink ${args.taskId} Platform Codex`,
  };
  if (hasValue(args.sessionId)) body.sessionId = args.sessionId;
  return body;
}

function sendBody(agentExecutionId, prompt) {
  return {
    agentExecutionId,
    userInput: {
      text: {
        content: prompt,
      },
    },
    codexSettings: codexSettings(),
  };
}

function methodUrl(method) {
  return `${args.apiBase.replace(/\/+$/u, "")}/${method}`;
}

async function post(method, body) {
  const bearer = token();
  if (!hasValue(bearer)) {
    const err = new Error("Missing GITPOD_API_KEY or ONA_TOKEN personal access token.");
    err.status = "missing_token";
    throw err;
  }
  const response = await fetch(methodUrl(method), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: sanitize(text) };
  }
  if (!response.ok) {
    const err = new Error(`${method} failed with HTTP ${response.status}: ${sanitize(text)}`);
    err.status = response.status;
    err.body = json;
    throw err;
  }
  return json;
}

function validateStartInputs(failures) {
  if (!hasValue(args.codexAgentId)) {
    failures.push("MINELINK_ONA_CODEX_AGENT_ID or --codex-agent-id is required; agentId must never be omitted.");
  }
  if (args.codexAgentId === DEFAULT_ONA_AGENT_ID) {
    failures.push(`Refusing default Ona automation agent id ${DEFAULT_ONA_AGENT_ID}.`);
  }
  if (startAgent && !hasValue(args.projectId) && !hasValue(args.environmentId)) {
    failures.push("StartAgent requires --project-id or --environment-id in codeContext.");
  }
  if (startAgent && !hasValue(args.environmentId) && !createEnvironment) {
    failures.push(
      "Ona Platform Codex is an in-environment agent; no running environment was discovered. Pass --create-environment or --environment-id before StartAgent.",
    );
  }
  if (!Number.isFinite(args.waitSeconds) || args.waitSeconds < 0) {
    failures.push("--wait-seconds must be a non-negative number.");
  }
  if (!Number.isFinite(args.pollSeconds) || args.pollSeconds < 1) {
    failures.push("--poll-seconds must be at least 1.");
  }
  if (!Number.isFinite(args.environmentWaitSeconds) || args.environmentWaitSeconds < 0) {
    failures.push("--environment-wait-seconds must be a non-negative number.");
  }
  if (!Number.isFinite(args.environmentPollSeconds) || args.environmentPollSeconds < 1) {
    failures.push("--environment-poll-seconds must be at least 1.");
  }
  if (promptMode === "implementation-canary" || promptMode === "video-verifier-canary") {
    if (!hasValue(args.taskId) || ["manual", "unknown"].includes(String(args.taskId).trim().toLowerCase())) {
      failures.push(`--${promptMode} requires a non-manual --task-id for task-bound evidence.`);
    }
    if (!hasValue(args.branch) || ["manual", "unknown"].includes(String(args.branch).trim().toLowerCase())) {
      failures.push(`--${promptMode} requires an explicit --branch for task-bound evidence.`);
    }
  }
  if (promptMode === "video-verifier-canary" && !hasValue(args.commit)) {
    failures.push("--video-verifier-canary requires --commit for task-bound video review evidence.");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminalAgentPhase(phase) {
  return /^PHASE_(STOPPED|FAILED|CANCELLED|DELETED)$/i.test(String(phase ?? ""));
}

function failedAgentPhase(phase) {
  return /^PHASE_(FAILED|CANCELLED|DELETED)$/i.test(String(phase ?? ""));
}

function isGoalMode() {
  return String(args.agentMode ?? "").toUpperCase() === "AGENT_MODE_GOAL";
}

function goalModeReadbackReady(execution) {
  const spec = execution?.spec ?? {};
  const status = execution?.status ?? {};
  return (
    isGoalMode() &&
    hasValue(execution?.id) &&
    hasValue(spec.agentId) &&
    (hasValue(spec.codexSettings) || hasValue(status.codexSettings))
  );
}

async function pollReadback(agentExecutionId) {
  const attempts = [];
  const deadline = Date.now() + args.waitSeconds * 1000;
  let latest = null;
  do {
    latest = await post("gitpod.v1.AgentService/GetAgentExecution", { agentExecutionId });
    const execution = latest.agentExecution ?? {};
    const phase = execution.status?.phase ?? "unknown";
    attempts.push({
      at: new Date().toISOString(),
      phase,
      agentId: execution.spec?.agentId ?? "",
      supportedModel: execution.status?.supportedModel ?? "",
    });
    if (terminalAgentPhase(phase) || goalModeReadbackReady(execution) || Date.now() >= deadline || args.waitSeconds === 0) {
      break;
    }
    await sleep(args.pollSeconds * 1000);
  } while (Date.now() < deadline);
  return { latest, attempts };
}

function evaluateReadback(readback, expectedAgentId) {
  const execution = readback?.agentExecution ?? {};
  const spec = execution.spec ?? {};
  const status = execution.status ?? {};
  const failures = [];
  const evidence = [];
  const actualAgentId = spec.agentId ?? "";
  const readbackMode = spec.mode ?? status.mode ?? "";
  if (!hasValue(execution.id)) failures.push("GetAgentExecution did not return an agentExecution id.");
  else evidence.push(`execution=${execution.id}`);
  if (actualAgentId !== expectedAgentId) {
    failures.push(`spec.agentId mismatch: expected ${expectedAgentId || "none"}, got ${actualAgentId || "missing"}.`);
  } else {
    evidence.push("spec.agentId matches requested Codex agent id");
  }
  if (actualAgentId === DEFAULT_ONA_AGENT_ID) {
    failures.push(`spec.agentId is the default Ona automation agent id ${DEFAULT_ONA_AGENT_ID}.`);
  }
  if (!spec.codexSettings && !status.codexSettings) {
    failures.push("GetAgentExecution did not expose spec.codexSettings or status.codexSettings.");
  } else {
    evidence.push("Codex settings are present in execution readback");
  }
  if (hasValue(args.agentMode)) {
    evidence.push(`requestedMode=${args.agentMode}`);
    if (hasValue(readbackMode)) {
      if (readbackMode !== args.agentMode) {
        failures.push(`Agent execution mode mismatch: expected ${args.agentMode}, got ${readbackMode}.`);
      } else {
        evidence.push(`readbackMode=${readbackMode}`);
      }
    } else {
      evidence.push("readbackMode not exposed by GetAgentExecution");
    }
  }
  if (hasValue(status.phase)) {
    evidence.push(`phase=${status.phase}`);
    if (failedAgentPhase(status.phase)) {
      failures.push(`Agent execution ended in ${status.phase}.`);
    } else if (!terminalAgentPhase(status.phase) && isGoalMode()) {
      evidence.push(
        `Goal-mode launch/readback accepted without terminal phase: ${status.phase}; task release still requires acceptance.mp4 and verifier approval`,
      );
    } else if (!terminalAgentPhase(status.phase) && args.waitSeconds > 0) {
      failures.push(
        `Agent execution did not reach a terminal phase before --wait-seconds=${args.waitSeconds}: ${status.phase}.`,
      );
    }
  } else {
    failures.push("GetAgentExecution did not expose status.phase.");
  }
  if (hasValue(status.supportedModel)) evidence.push(`supportedModel=${status.supportedModel}`);
  if (hasValue(status.conversationUrl)) evidence.push("conversationUrl present");
  if (hasValue(status.transcriptUrl)) evidence.push("transcriptUrl present");
  if (hasValue(status.conversationUrls?.history)) evidence.push("conversation history URL present");
  if (hasValue(status.conversationUrls?.live)) evidence.push("conversation live URL present");
  if (hasValue(status.conversationUrls?.blobs)) evidence.push("conversation blobs URL present");
  if (hasValue(status.inputTokensUsed)) evidence.push(`inputTokensUsed=${status.inputTokensUsed}`);
  if (hasValue(status.outputTokensUsed)) evidence.push(`outputTokensUsed=${status.outputTokensUsed}`);
  if (hasValue(status.iterations)) evidence.push(`iterations=${status.iterations}`);
  if (hasValue(status.failureMessage)) failures.push(`failureMessage: ${status.failureMessage}`);
  return { failures, evidence };
}

const report = {
  generatedAt: new Date().toISOString(),
  dryRun,
  apiBase: args.apiBase,
  organizationId: args.organizationId,
  projectId: args.projectId,
  environmentId: args.environmentId,
  codexAgentId: args.codexAgentId,
  taskId: args.taskId,
  branch: args.branch,
  commit: args.commit,
  codexSettings: codexSettings(),
  agentMode: args.agentMode,
  result: "pending",
  steps: [],
  blockers: [],
  evidence: [],
  requests: {},
  policies: null,
  environmentBootstrap: {
    createRequested: createEnvironment,
    explicitEnvironmentId,
    created: false,
    name: "",
    attempts: [],
    readback: null,
  },
  agentExecutionId: args.readbackExecution || "",
  readback: null,
  readbackAttempts: [],
  boundary:
    "Ona AgentService API launch/readback evidence only. This does not prove MineLink task release, acceptance video production, verifier approval, product acceptance, or task implementation by itself.",
};

const failures = [];
if (!dryRun && (discoverPolicies || startAgent || args.readbackExecution) && !hasValue(token())) {
  failures.push("Missing GITPOD_API_KEY or ONA_TOKEN personal access token for Ona API calls.");
}
if (discoverPolicies && !hasValue(args.organizationId)) {
  failures.push("GetOrganizationPolicies requires --organization-id or an active Ona CLI config with organizationId.");
}
if (startAgent || shouldSendPromptToExistingExecution()) validateStartInputs(failures);

if (failures.length === 0 && dryRun) {
  const previousEnvironmentId = args.environmentId;
  if (startAgent && createEnvironment && !hasValue(args.environmentId)) {
    report.requests.createEnvironment = {
      projectId: args.projectId,
      name: environmentName(),
      dontWait: true,
    };
    args.environmentId = "<createdEnvironmentId>";
  }
  if (startAgent) report.requests.startAgent = startBody();
  if (startAgent && sendPrompt) {
    report.requests.sendPrompt = sendBody(
      "<agentExecutionId>",
      await readPrompt({ agentExecutionId: "<agentExecutionId>" }),
    );
  }
  if (shouldSendPromptToExistingExecution()) {
    report.requests.sendPromptToExistingExecution = sendBody(
      report.agentExecutionId,
      await readPrompt({ agentExecutionId: report.agentExecutionId }),
    );
  }
  if (discoverPolicies) {
    report.requests.getOrganizationPolicies = { organizationId: args.organizationId };
  }
  if (args.readbackExecution) {
    report.requests.getAgentExecution = { agentExecutionId: args.readbackExecution };
  }
  args.environmentId = previousEnvironmentId;
  report.environmentId = args.environmentId;
  report.result = "dry-run";
  report.evidence.push("Request bodies generated without API calls.");
} else if (failures.length === 0) {
  try {
    if (discoverPolicies) {
      const policies = await post("gitpod.v1.OrganizationService/GetOrganizationPolicies", {
        organizationId: args.organizationId,
      });
      report.steps.push("GetOrganizationPolicies");
      report.policies = {
        allowedAgentIds: policies.policies?.agentPolicy?.allowedAgentIds ?? [],
        allowedCodexModels: policies.policies?.agentPolicy?.allowedCodexModels ?? [],
        allowedCodexReasoningEfforts: policies.policies?.agentPolicy?.allowedCodexReasoningEfforts ?? [],
        allowedCodexServiceTiers: policies.policies?.agentPolicy?.allowedCodexServiceTiers ?? [],
      };
      report.evidence.push("Organization policy readback completed.");
    }

    if (startAgent) {
      if (createEnvironment && !hasValue(args.environmentId)) {
        await createTaskEnvironment(report);
      }
      const started = await post("gitpod.v1.AgentService/StartAgent", startBody());
      report.steps.push("StartAgent");
      report.agentExecutionId = started.agentExecutionId ?? "";
      if (!hasValue(report.agentExecutionId)) failures.push("StartAgent did not return agentExecutionId.");
      if (hasValue(report.agentExecutionId) && sendPrompt) {
        await post(
          "gitpod.v1.AgentService/SendToAgentExecution",
          sendBody(report.agentExecutionId, await readPrompt({ agentExecutionId: report.agentExecutionId })),
        );
        report.steps.push("SendToAgentExecution");
      }
    }

    if (shouldSendPromptToExistingExecution()) {
      await post(
        "gitpod.v1.AgentService/SendToAgentExecution",
        sendBody(report.agentExecutionId, await readPrompt({ agentExecutionId: report.agentExecutionId })),
      );
      report.steps.push("SendToAgentExecution");
    }

    if (hasValue(report.agentExecutionId)) {
      const { latest, attempts } = await pollReadback(report.agentExecutionId);
      report.steps.push("GetAgentExecution");
      report.readback = latest;
      report.readbackAttempts = attempts;
      const evaluation = evaluateReadback(latest, args.codexAgentId || latest?.agentExecution?.spec?.agentId || "");
      failures.push(...evaluation.failures);
      report.evidence.push(...evaluation.evidence);
    }
  } catch (error) {
    failures.push(sanitize(error.message));
    if (error.body) report.errorBody = error.body;
  }
}

report.blockers = failures;
report.result = report.result === "dry-run" ? report.result : failures.length === 0 ? "passed" : "blocked";

function escapeMd(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

function code(value) {
  return `\`${escapeMd(value || "none")}\``;
}

const lines = [
  "# MineLink Ona Platform Codex API Session",
  "",
  `- Generated: ${code(report.generatedAt)}`,
  `- Result: ${code(report.result)}`,
  `- Boundary: ${code(report.boundary)}`,
  `- API base: ${code(report.apiBase)}`,
  `- Organization: ${code(report.organizationId)}`,
  `- Project: ${code(report.projectId)}`,
  `- Environment: ${code(report.environmentId)}`,
  `- Requested Codex agent id: ${code(report.codexAgentId)}`,
  `- Agent execution id: ${code(report.agentExecutionId)}`,
  `- Task id: ${code(report.taskId)}`,
  `- Branch: ${code(report.branch)}`,
  `- Commit: ${code(report.commit)}`,
  `- Codex model: ${code(report.codexSettings.model)}`,
  `- Reasoning effort: ${code(report.codexSettings.reasoningEffort)}`,
  `- Service tier: ${code(report.codexSettings.serviceTier)}`,
  `- Agent execution mode: ${code(report.agentMode)}`,
  "",
  "## Steps",
  "",
  ...(report.steps.length > 0 ? report.steps.map((step) => `- ${escapeMd(step)}`) : ["- none"]),
  "",
  "## Evidence",
  "",
  ...(report.evidence.length > 0 ? report.evidence.map((item) => `- ${escapeMd(item)}`) : ["- none"]),
  "",
  "## Environment Bootstrap",
  "",
  `- Create requested: ${code(report.environmentBootstrap.createRequested ? "yes" : "no")}`,
  `- Explicit environment id: ${code(report.environmentBootstrap.explicitEnvironmentId ? "yes" : "no")}`,
  `- Created environment: ${code(report.environmentBootstrap.created ? "yes" : "no")}`,
  `- Environment name: ${code(report.environmentBootstrap.name)}`,
  ...(report.environmentBootstrap.attempts.length > 0
    ? [
        "",
        "| at | phase | machine | devcontainer | branch | prebuild |",
        "| --- | --- | --- | --- | --- | --- |",
        ...report.environmentBootstrap.attempts.map(
          (attempt) =>
            `| ${escapeMd(attempt.at)} | ${escapeMd(attempt.phase)} | ${escapeMd(attempt.machinePhase)} | ${escapeMd(attempt.devcontainerPhase)} | ${escapeMd(attempt.branch)} | ${escapeMd(attempt.prebuildId)} |`,
        ),
      ]
    : []),
  "",
  "## Blockers",
  "",
  ...(failures.length === 0 ? ["- none"] : failures.map((failure) => `- ${escapeMd(failure)}`)),
  "",
  "## Policy Readback",
  "",
  report.policies
    ? `- allowedAgentIds: ${code((report.policies.allowedAgentIds ?? []).join(", ") || "empty/all")}`
    : "- none",
  report.policies
    ? `- allowedCodexModels: ${code((report.policies.allowedCodexModels ?? []).join(", ") || "empty/all")}`
    : "",
  report.policies
    ? `- allowedCodexReasoningEfforts: ${code((report.policies.allowedCodexReasoningEfforts ?? []).join(", ") || "empty/all")}`
    : "",
  report.policies
    ? `- allowedCodexServiceTiers: ${code((report.policies.allowedCodexServiceTiers ?? []).join(", ") || "empty/all")}`
    : "",
  "",
].filter((line) => line !== "");

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, `${lines.join("\n")}\n`, "utf8");
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (report.result === "blocked") {
  console.error(`Ona Platform Codex API session blocked; wrote ${args.output}`);
  process.exit(1);
}

console.log(`Ona Platform Codex API session ${report.result}; wrote ${args.output}`);
