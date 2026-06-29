#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaults = {
  clientVideo: "",
  report: "",
  logDir: "",
  outputDir: ".minelink-dev/reports/artifacts",
  taskId: process.env.MINELINK_TASK_ID ?? process.env.GITHUB_RUN_ID ?? "local",
  branch: process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME ?? "",
  producer: process.env.MINELINK_ACCEPTANCE_VIDEO_PRODUCER ?? "ona-task-finalizer",
  outputFps: process.env.MINELINK_ACCEPTANCE_VIDEO_FPS ?? "15",
  requireMp4: false,
};

const args = { ...defaults };

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--client-video") args.clientVideo = readValue();
  else if (arg === "--report") args.report = readValue();
  else if (arg === "--log-dir") args.logDir = readValue();
  else if (arg === "--output-dir") args.outputDir = readValue();
  else if (arg === "--task-id") args.taskId = readValue();
  else if (arg === "--branch") args.branch = readValue();
  else if (arg === "--producer") args.producer = readValue();
  else if (arg === "--require-mp4") args.requireMp4 = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/render-client-capture-video.mjs --client-video path --report path --log-dir path [--require-mp4]

Creates MineLink acceptance artifacts from a real Minecraft client capture and
the matching e2e report/logs. The output MP4 is a 1280x720 composite: the left
960px are the Minecraft client view, and the right 320px are terminal evidence.
The final composite is rendered after the e2e run so terminal evidence does not
compete with Minecraft rendering during capture. This is the only renderer that
may set clientGuiCapture=true.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!args.clientVideo || !args.report || !args.logDir || !args.outputDir) {
  console.error("--client-video, --report, --log-dir, and --output-dir are required");
  process.exit(2);
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function stat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function ffprobeDuration(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const duration = Number.parseFloat(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 10;
  } catch {
    return 10;
  }
}

function tailLines(text, maxLines) {
  return String(text ?? "")
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-maxLines);
}

function compact(value, maxLength = 74) {
  const text = String(value ?? "").replaceAll("`", "'").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function displayValue(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function metadataValue(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...String(text ?? "").matchAll(new RegExp(`^${escaped}=(.*)$`, "gm"))];
  return matches.at(-1)?.[1]?.trim() ?? "";
}

function metadataBool(text, key) {
  return /^(1|true|yes|on)$/i.test(metadataValue(text, key));
}

function metadataNumber(text, key, fallback = 0) {
  const value = Number.parseFloat(metadataValue(text, key));
  return Number.isFinite(value) ? value : fallback;
}

function toolResultNumber(item, key) {
  const result = item?.result ?? {};
  const direct = Number.parseFloat(result?.[key]);
  if (Number.isFinite(direct)) return direct;
  const nested = Number.parseFloat(result?.result?.[key]);
  return Number.isFinite(nested) ? nested : 0;
}

function toolActionResultNumber(item, key) {
  const result = item?.result ?? {};
  const directActionResult = Number.parseFloat(result?.action_result?.[key]);
  if (Number.isFinite(directActionResult)) return directActionResult;
  const actionResult = Number.parseFloat(result?.result?.action_result?.[key]);
  return Number.isFinite(actionResult) ? actionResult : 0;
}

const report = await readJson(args.report);
const clientVideoStat = await stat(args.clientVideo);
const failures = [];

if (!clientVideoStat?.isFile() || clientVideoStat.size === 0) {
  failures.push(`Missing client capture MP4: ${args.clientVideo}`);
}
if (!report) {
  failures.push(`Missing or invalid scenario report: ${args.report}`);
}

await fs.mkdir(args.outputDir, { recursive: true });

const scenario = report?.scenario ?? "unknown";
const runtime = report?.runtime ?? "unknown";
const passed = report?.passed === true;
const finalAssertions = Array.isArray(report?.final_assertions) ? report.final_assertions : [];
const toolResults = Array.isArray(report?.tool_results) ? report.tool_results : [];
const submittedActions = report?.submitted_actions && typeof report.submitted_actions === "object" ? report.submitted_actions : {};
const submittedActionsTerminalConfirmed = submittedActions.terminal_confirmed !== false;
const submittedActionPendingCount = Number.isFinite(submittedActions.pending_count) ? submittedActions.pending_count : 0;
const failedTools = toolResults.filter((item) => {
  const result = item?.result ?? {};
  return result.ok === false || result.status === "failed" || result.status === "blocked" || result.error;
});
const workToolNamePattern = /^(action|container|craft|furnace|create)\./;
const successfulWorkTools = toolResults.filter((item) => {
  const name = String(item?.name ?? "");
  if (!workToolNamePattern.test(name)) return false;
  const result = item?.result ?? {};
  return result.ok !== false && result.status !== "failed" && result.status !== "blocked" && !result.error;
});
const successfulAssertions = finalAssertions.filter((assertion) => assertion?.passed === true);
const reportHash = report ? await sha256(args.report) : "missing";
const successfulWorkToolNames = successfulWorkTools.map((item) => item?.name ?? "tool");

const agentLog = await readText(path.join(args.logDir, "agent.log"));
const serverStdout = await readText(path.join(args.logDir, "server.stdout.log"));
const serverStderr = await readText(path.join(args.logDir, "server.stderr.log"));
const clientStdout = await readText(path.join(args.logDir, "client.stdout.log"));
const clientStderr = await readText(path.join(args.logDir, "client.stderr.log"));
const serverLogText = `${serverStdout}\n${serverStderr}`;
const clientLogText = `${clientStdout}\n${clientStderr}`;
const captureDurationSeconds = clientVideoStat?.isFile() ? await ffprobeDuration(args.clientVideo) : 0;
const minecraftClientPanel = true;
const mcpTerminalLogPanel = Boolean(agentLog.trim() || serverLogText.trim() || clientLogText.trim());
const clientReadyLog = await readText(path.join(args.logDir, "client-capture-ready.log"));
const clientWorldReady =
  /(?:^|\n)clientWorldReady=true(?:\n|$)/.test(clientReadyLog) ||
  clientReadyLog.includes("MineLink recorder client in world confirmed");
const captureStartedAfterWorldReady =
  /(?:^|\n)captureStartedAfterWorldReady=true(?:\n|$)/.test(clientReadyLog) ||
  clientReadyLog.includes("ffmpeg started after recorder client world-ready");
const recorderAutoFollow =
  /(?:^|\n)recorderAutoFollow=true(?:\n|$)/.test(clientReadyLog) ||
  serverLogText.includes("MineLink recorder auto-follow active");
const recorderTargetMoved =
  /(?:^|\n)recorderTargetMoved=true(?:\n|$)/.test(clientReadyLog) ||
  serverLogText.includes("MineLink recorder target moved server_agent");
const recorderClientFollow =
  /(?:^|\n)recorderClientFollow=true(?:\n|$)/.test(clientReadyLog) ||
  clientLogText.includes("MineLink recorder client following server_agent");
const recorderClientTargetCentered =
  /(?:^|\n)recorderClientTargetCentered=true(?:\n|$)/.test(clientReadyLog) ||
  clientLogText.includes("MineLink recorder client target centered server_agent");
const recorderClientTargetVisible =
  /(?:^|\n)recorderClientTargetVisible=true(?:\n|$)/.test(clientReadyLog) ||
  clientLogText.includes("MineLink recorder client target visible server_agent");
const recorderCandidateMatches = [
  ...[...clientLogText.matchAll(/MineLink recorder client server_agent candidates\s+(\d+)\s+expected\s+(\d+)\s+target\s+([^\s]+)/g)].map(
    (match) => ({
      observed: Number.parseInt(match[1], 10),
      expected: Number.parseInt(match[2], 10),
      target: match[3],
    }),
  ),
  ...[
    ...clientLogText.matchAll(
      /MineLink recorder client (?:following|target visible|target centered) server_agent\s+([^\s]+)\s+candidates\s+(\d+)\/(\d+)/g,
    ),
  ].map((match) => ({
    observed: Number.parseInt(match[2], 10),
    expected: Number.parseInt(match[3], 10),
    target: match[1],
  })),
];
const recorderLastCandidateMatch = recorderCandidateMatches.at(-1);
const recorderObservedServerAgentCount = recorderLastCandidateMatch?.observed ?? 0;
const recorderExpectedVisibleServerAgents =
  recorderLastCandidateMatch?.expected ??
  Number.parseInt(process.env.MINELINK_RECORDER_EXPECTED_VISIBLE_AGENTS ?? (scenario === "portal_coop" ? "3" : "1"), 10);
const recorderSelectedTargetName = recorderLastCandidateMatch?.target ?? "";
const recorderUniqueTargetNames = [
  ...new Set(
    [
      ...clientLogText.matchAll(/MineLink recorder client (?:following|target visible|target centered) server_agent\s+([^\s]+)/g),
    ].map((match) => match[1]),
  ),
];
const recorderVisibleAgentCountMatchesExpectation =
  Number.isFinite(recorderObservedServerAgentCount) &&
  Number.isFinite(recorderExpectedVisibleServerAgents) &&
  recorderObservedServerAgentCount === recorderExpectedVisibleServerAgents;
const recorderSelectedSingleTargetStable =
  recorderUniqueTargetNames.length <= 1 &&
  (recorderUniqueTargetNames.length === 0 ||
    !recorderSelectedTargetName ||
    recorderUniqueTargetNames.includes(recorderSelectedTargetName));
const recorderReadyBeforeScenario = metadataBool(clientReadyLog, "recorderReadyBeforeScenario");
const recorderWorkHoldCompleted = metadataBool(clientReadyLog, "recorderWorkHoldCompleted");
const recorderMinWorkVisibleSeconds = metadataNumber(clientReadyLog, "recorderMinWorkVisibleSeconds", 10);
const recorderPostScenarioSeconds = metadataNumber(clientReadyLog, "recorderPostScenarioSeconds", 0);
const captureStartedAtEpoch = metadataNumber(clientReadyLog, "captureStartedAtEpoch", 0);
const recorderReadyBeforeScenarioAtEpoch = metadataNumber(clientReadyLog, "recorderReadyBeforeScenarioAtEpoch", 0);
const scenarioCompletedAtEpoch = metadataNumber(clientReadyLog, "scenarioCompletedAtEpoch", 0);
const recorderWorkHoldStartedAtEpoch = metadataNumber(clientReadyLog, "recorderWorkHoldStartedAtEpoch", 0);
const recorderWorkHoldEndedAtEpoch = metadataNumber(clientReadyLog, "recorderWorkHoldEndedAtEpoch", 0);
const recorderWorkHoldSeconds =
  recorderWorkHoldStartedAtEpoch > 0 && recorderWorkHoldEndedAtEpoch >= recorderWorkHoldStartedAtEpoch
    ? recorderWorkHoldEndedAtEpoch - recorderWorkHoldStartedAtEpoch
    : recorderPostScenarioSeconds;
const recorderTaskWindowSeconds =
  recorderReadyBeforeScenarioAtEpoch > 0 && scenarioCompletedAtEpoch >= recorderReadyBeforeScenarioAtEpoch
    ? scenarioCompletedAtEpoch - recorderReadyBeforeScenarioAtEpoch
    : 0;
const recorderVisibleMining = serverLogText.includes("MineLink recorder visible mining server_agent");
const requiresVisibleMining = successfulWorkToolNames.includes("action.mine_visible_block");
function hasRecorderVisibleAction(toolName) {
  const escaped = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`MineLink recorder visible action server_agent .* tool=${escaped}(?:\\s|$)`).test(serverLogText);
}
const requiresVisiblePlacement = successfulWorkToolNames.includes("block.place");
const requiresVisibleUse = successfulWorkToolNames.includes("action.use");
const recorderVisiblePlacement = hasRecorderVisibleAction("block.place");
const recorderVisibleUse = hasRecorderVisibleAction("action.use");
const recorderNonMiningActionVisible =
  (!requiresVisiblePlacement || recorderVisiblePlacement) && (!requiresVisibleUse || recorderVisibleUse);
const recorderVisibleMiningMs = Math.max(
  0,
  ...successfulWorkTools
    .filter(
      (item) =>
        item?.name === "action.mine_visible_block" ||
        item?.result?.action_result?.mined ||
        item?.result?.action_result?.visible_mining_ms ||
        item?.result?.result?.action_result?.mined ||
        item?.result?.result?.action_result?.visible_mining_ms,
    )
    .map((item) =>
      Math.max(
        toolResultNumber(item, "visible_mining_ms"),
        toolActionResultNumber(item, "visible_mining_ms"),
      ),
    ),
);
const recorderMinVisibleMiningMs = Math.max(
  0,
  metadataNumber(
    clientReadyLog,
    "recorderMinVisibleMiningMs",
    Number.parseFloat(process.env.MINELINK_RECORDER_MINING_VISIBLE_MS ?? "1000"),
  ),
);
const recorderVisibleMiningDurationAdequate =
  !requiresVisibleMining || (recorderVisibleMining && recorderVisibleMiningMs >= recorderMinVisibleMiningMs);
const recorderScenarioActionVisible = recorderVisibleMiningDurationAdequate && recorderNonMiningActionVisible;
const recorderVisibleActionSeconds = Math.max(recorderTaskWindowSeconds, recorderVisibleMiningMs / 1000);
const recorderWorkCoverageAdequate =
  recorderReadyBeforeScenario &&
  recorderWorkHoldCompleted &&
  recorderVisibleActionSeconds >= recorderMinWorkVisibleSeconds &&
  captureDurationSeconds >= recorderMinWorkVisibleSeconds;
const recorderWorkVisible =
  passed &&
  successfulWorkTools.length > 0 &&
  successfulAssertions.length > 0 &&
  recorderScenarioActionVisible &&
  recorderTargetMoved &&
  recorderClientFollow &&
  recorderClientTargetCentered &&
  recorderClientTargetVisible &&
  recorderWorkCoverageAdequate &&
  submittedActionsTerminalConfirmed;
const serverAgentTaskActionVisible = recorderWorkVisible;
const visualAnalysisStartSeconds =
  captureStartedAtEpoch > 0 && recorderReadyBeforeScenarioAtEpoch >= captureStartedAtEpoch
    ? Math.max(0, recorderReadyBeforeScenarioAtEpoch - captureStartedAtEpoch)
    : 0;
const visualAnalysisEndSeconds =
  captureStartedAtEpoch > 0 && scenarioCompletedAtEpoch >= captureStartedAtEpoch
    ? Math.min(
        captureDurationSeconds,
        Math.max(visualAnalysisStartSeconds + 1, scenarioCompletedAtEpoch - captureStartedAtEpoch + Math.min(4, recorderPostScenarioSeconds)),
      )
    : 0;
let visualAnalysis = null;
let visualAnalysisPath = path.join(args.outputDir, "acceptance-video-visual-analysis.json");
let visualAnalysisMdPath = path.join(args.outputDir, "acceptance-video-visual-analysis.md");
const diagnosticStoryboardPath = path.join(args.outputDir, "acceptance-client-capture-storyboard.png");
const diagnosticStoryboardJsonPath = path.join(args.outputDir, "acceptance-client-capture-storyboard.json");
let visualStaticTailTrimmedForRelease = false;
let visualLastMotionSeconds = 0;
let compositeDurationSeconds = Math.max(4, Math.min(120, captureDurationSeconds || 10));

if (clientVideoStat?.isFile()) {
  const runVisualAnalysis = async (analysisEndSeconds) => {
    const configuredStaticTailSeconds = Number.parseFloat(process.env.MINELINK_VIDEO_MAX_STATIC_TAIL_SECONDS ?? "14");
    const evidenceHoldStaticTailSeconds = recorderPostScenarioSeconds > 0 ? recorderPostScenarioSeconds + 3 : 14;
    const maxStaticTailSeconds = Math.max(
      Number.isFinite(configuredStaticTailSeconds) ? configuredStaticTailSeconds : 14,
      evidenceHoldStaticTailSeconds,
    );
    await execFileAsync(
      process.execPath,
      [
        "scripts/dev/analyze-acceptance-video.mjs",
        "--mp4",
        args.clientVideo,
        "--output-json",
        visualAnalysisPath,
        "--output-md",
        visualAnalysisMdPath,
      ],
      {
        env: {
          ...process.env,
          MINELINK_VIDEO_MAX_STATIC_TAIL_SECONDS: String(maxStaticTailSeconds),
          MINELINK_VIDEO_ABRUPT_JUMP_DIFF: process.env.MINELINK_VIDEO_ABRUPT_JUMP_DIFF ?? "32",
          MINELINK_VIDEO_ANALYSIS_START_SECONDS: String(visualAnalysisStartSeconds),
          MINELINK_VIDEO_ANALYSIS_END_SECONDS: String(analysisEndSeconds),
        },
        maxBuffer: 1024 * 1024 * 8,
      },
    );
    return readJson(visualAnalysisPath);
  };
  try {
    visualAnalysis = await runVisualAnalysis(visualAnalysisEndSeconds);
    visualLastMotionSeconds = Number.parseFloat(visualAnalysis?.lastMotionSeconds ?? "0");
    const releaseHoldSeconds = Math.max(3, Math.min(6, recorderWorkHoldSeconds || recorderPostScenarioSeconds || 4));
    const trimmedEndSeconds =
      Number.isFinite(visualLastMotionSeconds) && visualLastMotionSeconds > 0
        ? Math.min(
            captureDurationSeconds,
            Math.max(visualAnalysisStartSeconds + recorderMinWorkVisibleSeconds, visualLastMotionSeconds + releaseHoldSeconds),
          )
        : 0;
    const canTrimStaticTail =
      visualAnalysis?.staticTailPassed !== true &&
      visualAnalysis?.jitterPassed === true &&
      visualAnalysis?.actionMotionCoveragePassed === true &&
      recorderWorkVisible &&
      Number.isFinite(trimmedEndSeconds) &&
      trimmedEndSeconds > visualAnalysisStartSeconds + 1 &&
      trimmedEndSeconds < captureDurationSeconds - 0.5;
    if (canTrimStaticTail) {
      visualStaticTailTrimmedForRelease = true;
      compositeDurationSeconds = Math.max(4, Math.min(120, trimmedEndSeconds));
      visualAnalysis = await runVisualAnalysis(compositeDurationSeconds);
      visualLastMotionSeconds = Number.parseFloat(visualAnalysis?.lastMotionSeconds ?? String(visualLastMotionSeconds));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`Acceptance video visual analysis failed to run: ${message}`);
  }
  try {
    await execFileAsync(
      process.execPath,
      [
        "scripts/dev/render-video-storyboard.mjs",
        "--mp4",
        args.clientVideo,
        "--output",
        diagnosticStoryboardPath,
        "--json-output",
        diagnosticStoryboardJsonPath,
        "--frames-dir",
        path.join(args.outputDir, "client-capture-storyboard-frames"),
      ],
      { maxBuffer: 1024 * 1024 * 8 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Acceptance client capture storyboard failed to render: ${message}`);
  }
}
const visualActionMotionCoveragePassed = visualAnalysis?.actionMotionCoveragePassed === true;
const visualStaticTailPassed = visualAnalysis?.staticTailPassed === true;
const visualCameraFollowMotionTolerated =
  visualAnalysis != null &&
  visualAnalysis.jitterPassed !== true &&
  visualActionMotionCoveragePassed &&
  visualStaticTailPassed &&
  recorderWorkVisible &&
  recorderSelectedSingleTargetStable &&
  recorderClientFollow &&
  recorderClientTargetCentered &&
  recorderClientTargetVisible;
const visualJitterPassed = visualAnalysis?.jitterPassed === true || visualCameraFollowMotionTolerated;
const visualQualityPassed = visualAnalysis?.passed === true || visualCameraFollowMotionTolerated;

if (!clientWorldReady) {
  failures.push("Recorder client did not confirm an in-world Minecraft view before acceptance rendering");
}
if (!captureStartedAfterWorldReady) {
  failures.push("Client capture did not start after the recorder client reached the Minecraft world");
}
if (!recorderAutoFollow) {
  failures.push("Recorder client did not confirm auto-follow camera binding to the active server_agent");
}
if (!recorderTargetMoved) {
  failures.push("Recorder did not confirm visible movement from the active server_agent during the captured task");
}
if (!recorderClientFollow) {
  failures.push("Recorder client did not confirm a visible client-side follow target for the active server_agent");
}
if (!recorderClientTargetCentered) {
  failures.push("Recorder client did not confirm the active server_agent target is centered in the client view");
}
if (!recorderClientTargetVisible) {
  failures.push("Recorder client did not confirm clear line-of-sight visibility for the active server_agent target");
}
if (!recorderVisibleAgentCountMatchesExpectation) {
  failures.push(
    `Recorder observed ${recorderObservedServerAgentCount || "unknown"} visible server_agent candidate(s), expected ${recorderExpectedVisibleServerAgents || "unknown"}`,
  );
}
if (!recorderSelectedSingleTargetStable) {
  failures.push(
    `Recorder target identity was unstable or ambiguous: selected=${recorderSelectedTargetName || "unknown"} observed=${recorderUniqueTargetNames.join(",") || "none"}`,
  );
}
if (!recorderReadyBeforeScenario) {
  failures.push(
    "Recorder did not confirm the active server_agent was visible, centered, and followed before task work began",
  );
}
if (!recorderWorkCoverageAdequate) {
  failures.push(
    `Recorder work coverage is too short or incomplete: hold=${recorderWorkHoldSeconds}s, min=${recorderMinWorkVisibleSeconds}s, capture=${captureDurationSeconds.toFixed(1)}s`,
  );
}
if (!submittedActionsTerminalConfirmed) {
  failures.push(
    `Scenario finished with ${submittedActionPendingCount} submitted action(s) still lacking terminal lifecycle confirmation`,
  );
}
if (requiresVisibleMining && !recorderVisibleMining) {
  failures.push("Recorder did not capture a visible mining marker for action.mine_visible_block");
}
if (requiresVisibleMining && !recorderVisibleMiningDurationAdequate) {
  failures.push(
    `Recorder visible mining duration is too short: ${recorderVisibleMiningMs}ms < ${recorderMinVisibleMiningMs}ms`,
  );
}
if (requiresVisiblePlacement && !recorderVisiblePlacement) {
  failures.push("Recorder did not capture a visible block.place action marker for the task");
}
if (requiresVisibleUse && !recorderVisibleUse) {
  failures.push("Recorder did not capture a visible action.use marker for the task");
}
if (!recorderWorkVisible) {
  failures.push(
    "Recorder did not confirm active visible server_agent work for this task; final evidence requires successful work tools, passing assertions, and visible centered follow footage",
  );
}
if (!mcpTerminalLogPanel) {
  failures.push("Client acceptance video cannot prove the right-side MCP/server terminal log panel because no matching runtime logs were found");
}
if (!visualQualityPassed) {
  failures.push("Acceptance video visual QA did not pass; final evidence must not be jittery, static, or action-ambiguous");
}

const terminalLines = [
  "MINELINK CLIENT ACCEPTANCE",
  `task: ${compact(args.taskId, 34)}`,
  `scenario: ${compact(scenario, 28)}`,
  `runtime: ${compact(runtime, 30)}`,
  `result: ${passed ? "PASS" : "FAIL"}`,
  `world ready: ${clientWorldReady ? "YES" : "NO"}`,
  `capture after ready: ${captureStartedAfterWorldReady ? "YES" : "NO"}`,
  `auto follow: ${recorderAutoFollow ? "YES" : "NO"}`,
  `target moved: ${recorderTargetMoved ? "YES" : "NO"}`,
  `client follow: ${recorderClientFollow ? "YES" : "NO"}`,
  `target centered: ${recorderClientTargetCentered ? "YES" : "NO"}`,
  `target visible: ${recorderClientTargetVisible ? "YES" : "NO"}`,
  `agent count: ${recorderObservedServerAgentCount}/${recorderExpectedVisibleServerAgents}`,
  `visual qa: ${visualQualityPassed ? "YES" : "NO"}`,
  `ready before work: ${recorderReadyBeforeScenario ? "YES" : "NO"}`,
  `work hold sec: ${recorderWorkHoldSeconds}`,
  `task window sec: ${recorderTaskWindowSeconds}`,
  `action visible sec: ${recorderVisibleActionSeconds.toFixed(1)}`,
  `visible mining: ${recorderVisibleMining ? "YES" : "NO"}`,
  `visible place: ${recorderVisiblePlacement ? "YES" : "NO"}`,
  `visible use: ${recorderVisibleUse ? "YES" : "NO"}`,
  `mining ms: ${recorderVisibleMiningMs}/${recorderMinVisibleMiningMs}`,
  `actions terminal: ${submittedActionsTerminalConfirmed ? "YES" : "NO"}`,
  `work visible: ${recorderWorkVisible ? "YES" : "NO"}`,
  `report sha256: ${reportHash.slice(0, 12)}`,
  "",
  "assertions:",
  ...(finalAssertions.length === 0
    ? ["- none"]
    : finalAssertions.slice(0, 8).map((assertion) => `- ${compact(displayValue(assertion), 34)}`)),
  "",
  "tools:",
  ...toolResults.slice(0, 8).map((item) => {
    const result = item?.result ?? {};
    return `- ${compact(item?.name ?? "tool", 14)} ${compact(result.status ?? (result.ok === false ? "failed" : "ok"), 14)}`;
  }),
  `work tools: ${successfulWorkTools.length}`,
  ...(failedTools.length > 0 ? ["", `failed tools: ${failedTools.length}`] : []),
  "",
  "agent log:",
  ...tailLines(agentLog, 8).map((line) => compact(line, 36)),
  "",
  "server/client:",
  ...tailLines(serverLogText, 4).map((line) => compact(line, 36)),
  ...tailLines(clientStdout, 4).map((line) => compact(line, 36)),
].slice(0, 42);

const terminalTextPath = path.join(args.outputDir, "acceptance-terminal-panel.txt");
const terminalImagePath = path.join(args.outputDir, "acceptance-terminal-panel.ppm");
const outputFps = Number.parseInt(String(args.outputFps), 10) > 0 ? String(args.outputFps) : "15";
await fs.writeFile(terminalTextPath, `${terminalLines.join("\n")}\n`, "utf8");

const glyphs = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11110", "00000", "00000", "00000"],
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "\\": ["10000", "01000", "01000", "00100", "00010", "00010", "00001"],
  "#": ["01010", "11111", "01010", "01010", "11111", "01010", "00000"],
  "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"],
  "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  ",": ["00000", "00000", "00000", "00000", "00110", "00100", "01000"],
  "'": ["00100", "00100", "00000", "00000", "00000", "00000", "00000"],
  "\"": ["01010", "01010", "00000", "00000", "00000", "00000", "00000"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

async function writeTerminalPanelPpm(filePath, lines) {
  const width = 320;
  const height = 720;
  const scale = 2;
  const charWidth = 6 * scale;
  const lineHeight = 9 * scale;
  const originX = 14;
  const originY = 18;
  const background = [0x0b, 0x13, 0x20];
  const foreground = [0xe8, 0xf1, 0xff];
  const accent = [0x72, 0xe0, 0xc1];
  const buffer = Buffer.alloc(width * height * 3);
  for (let index = 0; index < buffer.length; index += 3) {
    buffer[index] = background[0];
    buffer[index + 1] = background[1];
    buffer[index + 2] = background[2];
  }
  const putPixel = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 3;
    buffer[index] = color[0];
    buffer[index + 1] = color[1];
    buffer[index + 2] = color[2];
  };
  const drawGlyph = (char, x, y, color) => {
    const glyph = glyphs[char.toUpperCase()] ?? glyphs["?"];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            putPixel(x + column * scale + dx, y + row * scale + dy, color);
          }
        }
      }
    }
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const y = originY + lineIndex * lineHeight;
    if (y + 7 * scale >= height) break;
    const line = compact(lines[lineIndex], 25);
    const color = lineIndex === 0 ? accent : foreground;
    for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
      const x = originX + charIndex * charWidth;
      if (x + 5 * scale >= width) break;
      drawGlyph(line[charIndex], x, y, color);
    }
  }
  await fs.writeFile(filePath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii"), buffer]));
}

await writeTerminalPanelPpm(terminalImagePath, terminalLines);

const summaryPath = path.join(args.outputDir, "acceptance-summary.md");
const mp4Path = path.join(args.outputDir, "acceptance.mp4");
const originJsonPath = path.join(args.outputDir, "acceptance-video-origin.json");
const originMdPath = path.join(args.outputDir, "acceptance-video-origin.md");
const unavailablePath = path.join(args.outputDir, "acceptance.mp4.unavailable.txt");

const summaryLines = [
  "# MineLink Client Acceptance Video Summary",
  "",
  `- Task id: \`${args.taskId}\``,
  `- Branch: \`${args.branch || "unknown"}\``,
  `- Scenario reports: \`${report ? 1 : 0}\``,
  `- Scenario: \`${scenario}\``,
  `- Runtime: \`${runtime}\``,
  `- Passed: \`${passed ? "yes" : "no"}\``,
  "- Client GUI capture: `yes`",
  `- Minecraft client panel: \`${minecraftClientPanel ? "yes" : "no"}\``,
  `- MCP terminal log panel: \`${mcpTerminalLogPanel ? "yes" : "no"}\``,
  `- Client world ready: \`${clientWorldReady ? "yes" : "no"}\``,
  `- Capture started after world ready: \`${captureStartedAfterWorldReady ? "yes" : "no"}\``,
  `- Recorder auto-follow: \`${recorderAutoFollow ? "yes" : "no"}\``,
  `- Recorder target moved: \`${recorderTargetMoved ? "yes" : "no"}\``,
  `- Recorder client follow: \`${recorderClientFollow ? "yes" : "no"}\``,
  `- Recorder client target centered: \`${recorderClientTargetCentered ? "yes" : "no"}\``,
  `- Recorder client target visible: \`${recorderClientTargetVisible ? "yes" : "no"}\``,
  `- Recorder observed server agent count: \`${recorderObservedServerAgentCount || "unknown"}\``,
  `- Recorder expected visible server agents: \`${recorderExpectedVisibleServerAgents || "unknown"}\``,
  `- Recorder visible agent count matches expectation: \`${recorderVisibleAgentCountMatchesExpectation ? "yes" : "no"}\``,
  `- Recorder selected target name: \`${recorderSelectedTargetName || "unknown"}\``,
  `- Recorder unique target names: \`${recorderUniqueTargetNames.join(",") || "none"}\``,
  `- Recorder selected target stable: \`${recorderSelectedSingleTargetStable ? "yes" : "no"}\``,
  `- Recorder ready before scenario: \`${recorderReadyBeforeScenario ? "yes" : "no"}\``,
  `- Recorder work hold completed: \`${recorderWorkHoldCompleted ? "yes" : "no"}\``,
  `- Recorder work hold seconds: \`${recorderWorkHoldSeconds}\``,
  `- Recorder min work visible seconds: \`${recorderMinWorkVisibleSeconds}\``,
  `- Recorder task window seconds: \`${recorderTaskWindowSeconds}\``,
  `- Recorder visible action seconds: \`${recorderVisibleActionSeconds.toFixed(3)}\``,
  `- Recorder capture duration seconds: \`${captureDurationSeconds.toFixed(3)}\``,
  `- Recorder work coverage adequate: \`${recorderWorkCoverageAdequate ? "yes" : "no"}\``,
  `- Recorder visible mining: \`${recorderVisibleMining ? "yes" : "no"}\``,
  `- Recorder visible mining ms: \`${recorderVisibleMiningMs}\``,
  `- Recorder min visible mining ms: \`${recorderMinVisibleMiningMs}\``,
  `- Recorder visible mining duration adequate: \`${recorderVisibleMiningDurationAdequate ? "yes" : "no"}\``,
  `- Recorder visible placement: \`${recorderVisiblePlacement ? "yes" : "no"}\``,
  `- Recorder visible use: \`${recorderVisibleUse ? "yes" : "no"}\``,
  `- Requires visible placement: \`${requiresVisiblePlacement ? "yes" : "no"}\``,
  `- Requires visible use: \`${requiresVisibleUse ? "yes" : "no"}\``,
  `- Recorder scenario action visible: \`${recorderScenarioActionVisible ? "yes" : "no"}\``,
    `- Visual QA passed: \`${visualQualityPassed ? "yes" : "no"}\``,
    `- Visual jitter passed: \`${visualJitterPassed ? "yes" : "no"}\``,
    `- Visual follow-camera motion tolerated: \`${visualCameraFollowMotionTolerated ? "yes" : "no"}\``,
    `- Visual action motion coverage passed: \`${visualActionMotionCoveragePassed ? "yes" : "no"}\``,
    `- Visual static tail passed: \`${visualStaticTailPassed ? "yes" : "no"}\``,
    `- Visual static tail trimmed for release: \`${visualStaticTailTrimmedForRelease ? "yes" : "no"}\``,
    `- Visual last motion seconds: \`${Number.isFinite(visualLastMotionSeconds) ? visualLastMotionSeconds.toFixed(3) : "0.000"}\``,
    `- Composite duration seconds: \`${compositeDurationSeconds.toFixed(3)}\``,
  `- Visual analysis: \`${visualAnalysisPath}\``,
  `- Diagnostic client capture storyboard: \`${diagnosticStoryboardPath}\``,
  `- Submitted actions terminal confirmed: \`${submittedActionsTerminalConfirmed ? "yes" : "no"}\``,
  `- Submitted action pending count: \`${submittedActionPendingCount}\``,
  `- Recorder work visible: \`${recorderWorkVisible ? "yes" : "no"}\``,
  `- Server agent task action visible: \`${serverAgentTaskActionVisible ? "yes" : "no"}\``,
  `- Successful work tools: \`${successfulWorkTools.length}\``,
  `- Successful final assertions: \`${successfulAssertions.length}\``,
  "- Video kind: `minecraft-client-terminal-composite`",
  "- Capture/composite mode: `split-game-capture-post-terminal-composite`",
  `- Client capture source: \`${args.clientVideo}\``,
  `- Terminal panel source: \`${terminalTextPath}\``,
  `- Report: \`${args.report}\``,
  "",
  "## Final Assertions",
  "",
  ...(finalAssertions.length === 0 ? ["- none"] : finalAssertions.map((assertion) => `- ${displayValue(assertion)}`)),
  "",
  "## Boundary",
  "",
  "- The left panel is a real Minecraft client recording from the same e2e run.",
  "- The right panel is rendered after capture from the matching MCP/server/agent logs so terminal rendering does not compete with Minecraft during the scenario.",
  "- This proves the recorded scenario only; it does not upgrade unrelated MineLink gates.",
  "",
  "## Render Failures",
  "",
  ...(failures.length === 0 ? ["- none"] : failures.map((failure) => `- ${failure}`)),
  "",
];
await fs.writeFile(summaryPath, `${summaryLines.join("\n")}\n`, "utf8");

const generatedAt = new Date().toISOString();
const origin = {
  generatedAt,
  taskId: args.taskId,
  branch: args.branch || "unknown",
  producer: args.producer,
  videoKind: "minecraft-client-terminal-composite",
  splitCaptureComposite: true,
  captureCompositionMode: "split-game-capture-post-terminal-composite",
  clientGuiCapture: true,
  minecraftClientPanel,
  mcpTerminalLogPanel,
  clientWorldReady,
  captureStartedAfterWorldReady,
  recorderAutoFollow,
  recorderTargetMoved,
  recorderClientFollow,
  recorderClientTargetCentered,
  recorderClientTargetVisible,
  recorderObservedServerAgentCount,
  recorderExpectedVisibleServerAgents,
  recorderVisibleAgentCountMatchesExpectation,
  recorderSelectedTargetName,
  recorderUniqueTargetNames,
  recorderSelectedSingleTargetStable,
  recorderReadyBeforeScenario,
  recorderWorkHoldCompleted,
  recorderWorkHoldSeconds,
  recorderMinWorkVisibleSeconds,
  recorderTaskWindowSeconds,
  recorderVisibleActionSeconds: Number(recorderVisibleActionSeconds.toFixed(3)),
  recorderCaptureDurationSeconds: Number(captureDurationSeconds.toFixed(3)),
  recorderWorkCoverageAdequate,
  recorderVisibleMining,
  recorderVisibleMiningMs,
  recorderMinVisibleMiningMs,
  recorderVisibleMiningDurationAdequate,
  requiresVisibleMining,
  recorderVisiblePlacement,
  recorderVisibleUse,
  requiresVisiblePlacement,
  requiresVisibleUse,
  recorderScenarioActionVisible,
  visualAnalysis: visualAnalysisPath,
  diagnosticClientCaptureStoryboard: diagnosticStoryboardPath,
  diagnosticClientCaptureStoryboardJson: diagnosticStoryboardJsonPath,
  visualQualityPassed,
  visualJitterPassed,
  visualCameraFollowMotionTolerated,
  visualActionMotionCoveragePassed,
  visualStaticTailPassed,
  visualStaticTailTrimmedForRelease,
  visualLastMotionSeconds: Number.isFinite(visualLastMotionSeconds) ? Number(visualLastMotionSeconds.toFixed(3)) : 0,
  compositeDurationSeconds: Number(compositeDurationSeconds.toFixed(3)),
  submittedActionsTerminalConfirmed,
  submittedActionPendingCount,
  recorderWorkVisible,
  serverAgentTaskActionVisible,
  successfulWorkTools: successfulWorkToolNames,
  successfulWorkToolCount: successfulWorkTools.length,
  successfulFinalAssertionCount: successfulAssertions.length,
  scenarioReports: report ? 1 : 0,
  clientVideo: args.clientVideo,
  report: args.report,
  terminalPanel: terminalTextPath,
  terminalPanelImage: terminalImagePath,
  outputFps,
  boundary:
    "Real Minecraft client capture plus terminal evidence from the same MineLink NeoForge e2e run; scenario-scoped acceptance only.",
};
await fs.writeFile(originJsonPath, `${JSON.stringify(origin, null, 2)}\n`, "utf8");
await fs.writeFile(
  originMdPath,
  [
    "# MineLink Acceptance Video Origin",
    "",
    `- Generated: \`${generatedAt}\``,
    `- Task id: \`${args.taskId}\``,
    `- Branch: \`${args.branch || "unknown"}\``,
    `- Producer: \`${args.producer}\``,
    "- Video kind: `minecraft-client-terminal-composite`",
    "- Capture/composite mode: `split-game-capture-post-terminal-composite`",
    "- Client GUI capture: `yes`",
    `- Minecraft client panel: \`${minecraftClientPanel ? "yes" : "no"}\``,
    `- MCP terminal log panel: \`${mcpTerminalLogPanel ? "yes" : "no"}\``,
    `- Client world ready: \`${clientWorldReady ? "yes" : "no"}\``,
    `- Capture started after world ready: \`${captureStartedAfterWorldReady ? "yes" : "no"}\``,
    `- Recorder auto-follow: \`${recorderAutoFollow ? "yes" : "no"}\``,
    `- Recorder target moved: \`${recorderTargetMoved ? "yes" : "no"}\``,
    `- Recorder client follow: \`${recorderClientFollow ? "yes" : "no"}\``,
    `- Recorder client target centered: \`${recorderClientTargetCentered ? "yes" : "no"}\``,
    `- Recorder client target visible: \`${recorderClientTargetVisible ? "yes" : "no"}\``,
    `- Recorder observed server agent count: \`${recorderObservedServerAgentCount || "unknown"}\``,
    `- Recorder expected visible server agents: \`${recorderExpectedVisibleServerAgents || "unknown"}\``,
    `- Recorder visible agent count matches expectation: \`${recorderVisibleAgentCountMatchesExpectation ? "yes" : "no"}\``,
    `- Recorder selected target name: \`${recorderSelectedTargetName || "unknown"}\``,
    `- Recorder selected target stable: \`${recorderSelectedSingleTargetStable ? "yes" : "no"}\``,
    `- Recorder ready before scenario: \`${recorderReadyBeforeScenario ? "yes" : "no"}\``,
    `- Recorder work hold completed: \`${recorderWorkHoldCompleted ? "yes" : "no"}\``,
    `- Recorder work hold seconds: \`${recorderWorkHoldSeconds}\``,
    `- Recorder min work visible seconds: \`${recorderMinWorkVisibleSeconds}\``,
    `- Recorder task window seconds: \`${recorderTaskWindowSeconds}\``,
    `- Recorder visible action seconds: \`${recorderVisibleActionSeconds.toFixed(3)}\``,
    `- Recorder capture duration seconds: \`${captureDurationSeconds.toFixed(3)}\``,
    `- Recorder work coverage adequate: \`${recorderWorkCoverageAdequate ? "yes" : "no"}\``,
    `- Recorder visible mining: \`${recorderVisibleMining ? "yes" : "no"}\``,
    `- Recorder visible mining ms: \`${recorderVisibleMiningMs}\``,
    `- Recorder min visible mining ms: \`${recorderMinVisibleMiningMs}\``,
    `- Recorder visible mining duration adequate: \`${recorderVisibleMiningDurationAdequate ? "yes" : "no"}\``,
    `- Recorder visible placement: \`${recorderVisiblePlacement ? "yes" : "no"}\``,
    `- Recorder visible use: \`${recorderVisibleUse ? "yes" : "no"}\``,
    `- Requires visible placement: \`${requiresVisiblePlacement ? "yes" : "no"}\``,
    `- Requires visible use: \`${requiresVisibleUse ? "yes" : "no"}\``,
    `- Recorder scenario action visible: \`${recorderScenarioActionVisible ? "yes" : "no"}\``,
    `- Visual QA passed: \`${visualQualityPassed ? "yes" : "no"}\``,
    `- Visual jitter passed: \`${visualJitterPassed ? "yes" : "no"}\``,
    `- Visual follow-camera motion tolerated: \`${visualCameraFollowMotionTolerated ? "yes" : "no"}\``,
    `- Visual action motion coverage passed: \`${visualActionMotionCoveragePassed ? "yes" : "no"}\``,
    `- Visual static tail passed: \`${visualStaticTailPassed ? "yes" : "no"}\``,
    `- Visual static tail trimmed for release: \`${visualStaticTailTrimmedForRelease ? "yes" : "no"}\``,
    `- Visual last motion seconds: \`${Number.isFinite(visualLastMotionSeconds) ? visualLastMotionSeconds.toFixed(3) : "0.000"}\``,
    `- Composite duration seconds: \`${compositeDurationSeconds.toFixed(3)}\``,
    `- Visual analysis: \`${visualAnalysisPath}\``,
    `- Diagnostic client capture storyboard: \`${diagnosticStoryboardPath}\``,
    `- Submitted actions terminal confirmed: \`${submittedActionsTerminalConfirmed ? "yes" : "no"}\``,
    `- Submitted action pending count: \`${submittedActionPendingCount}\``,
    `- Recorder work visible: \`${recorderWorkVisible ? "yes" : "no"}\``,
    `- Server agent task action visible: \`${serverAgentTaskActionVisible ? "yes" : "no"}\``,
    `- Successful work tools: \`${successfulWorkTools.length}\``,
    `- Successful final assertions: \`${successfulAssertions.length}\``,
    `- Scenario reports: \`${report ? 1 : 0}\``,
    `- Client video: \`${args.clientVideo}\``,
    `- Report: \`${args.report}\``,
    `- Boundary: \`${origin.boundary}\``,
    "",
  ].join("\n"),
  "utf8",
);

if (failures.length === 0) {
  try {
    const filter = [
      "[0:v]fps=15,scale=960:720:force_original_aspect_ratio=decrease,pad=960:720:(ow-iw)/2:(oh-ih)/2:color=black[game]",
      "[1:v]scale=320:720[term]",
      "[game][term]hstack=inputs=2[v]",
    ].join(";");
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-i",
        args.clientVideo,
        "-loop",
        "1",
        "-i",
        terminalImagePath,
        "-filter_complex",
        filter,
        "-map",
        "[v]",
        "-an",
        "-t",
        compositeDurationSeconds.toFixed(3),
        "-r",
        outputFps,
        "-c:v",
        "libx264",
        "-preset",
        process.env.MINELINK_ACCEPTANCE_COMPOSITE_X264_PRESET ?? "veryfast",
        "-crf",
        process.env.MINELINK_ACCEPTANCE_COMPOSITE_CRF ?? "24",
        "-threads",
        process.env.MINELINK_ACCEPTANCE_COMPOSITE_THREADS ?? "2",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        mp4Path,
      ],
      { maxBuffer: 1024 * 1024 * 8 },
    );
    await fs.rm(unavailablePath, { force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`ffmpeg composite render failed: ${message}`);
    await fs.writeFile(unavailablePath, `${message}\n`, "utf8");
  }
}

if (failures.length > 0) {
  if (args.requireMp4) {
    console.error(`Client acceptance video render failed: ${failures.join("; ")}`);
    process.exit(1);
  }
}

console.log(`Wrote ${summaryPath}`);
console.log(`Wrote ${originJsonPath}`);
if ((await stat(mp4Path))?.isFile()) {
  console.log(`Wrote ${mp4Path}`);
}
