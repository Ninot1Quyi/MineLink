#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

let reviewPath = ".minelink-dev/reports/artifacts/video-review.md";
let summaryPath = ".minelink-dev/reports/artifacts/acceptance-summary.md";
let mp4Path = ".minelink-dev/reports/artifacts/acceptance.mp4";
let originPath = ".minelink-dev/reports/artifacts/acceptance-video-origin.json";
let manifestPath = ".minelink-dev/reports/artifacts/video-storage-manifest.json";
let outputPath = ".minelink-dev/reports/artifacts/video-release-gate.md";
let requireMp4 = false;
let requireProducer = "";
let requireClientGuiCapture = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--review") {
    reviewPath = process.argv[++index] ?? "";
  } else if (arg === "--summary") {
    summaryPath = process.argv[++index] ?? "";
  } else if (arg === "--mp4") {
    mp4Path = process.argv[++index] ?? "";
  } else if (arg === "--origin") {
    originPath = process.argv[++index] ?? "";
  } else if (arg === "--manifest") {
    manifestPath = process.argv[++index] ?? "";
  } else if (arg === "--output") {
    outputPath = process.argv[++index] ?? "";
  } else if (arg === "--require-producer") {
    requireProducer = process.argv[++index] ?? "";
  } else if (arg === "--require-mp4") {
    requireMp4 = true;
  } else if (arg === "--require-client-gui-capture") {
    requireClientGuiCapture = true;
  } else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/check-video-review.mjs [--require-mp4] [--require-client-gui-capture]

Checks the Goal-mode acceptance-video release gate before release. The
verifier report must explicitly contain:

Verifier: Ona Platform Codex
Release decision: pass
Task matched: yes
Video matched: yes
Client GUI capture: yes
Minecraft client panel: yes
MCP terminal log panel: yes
Client world ready: yes
Capture started after world ready: yes
Recorder auto-follow: yes
Recorder target moved: yes
Recorder client follow: yes
Recorder client target centered: yes
Recorder client target visible: yes
Recorder visible agent count matches expectation: yes
Recorder selected target stable: yes
Recorder ready before scenario: yes
Recorder work coverage adequate: yes
Recorder visible mining: yes
Recorder visible mining duration adequate: yes
Requires visible mining: yes
Recorder scenario action visible: yes
Visual QA passed: yes
Visual jitter passed: yes
Visual action motion coverage passed: yes
Submitted actions terminal confirmed: yes
Recorder work visible: yes
Server agent task action visible: yes
Summary sha256: <current acceptance-summary.md sha256>
MP4 sha256: <current acceptance.mp4 sha256>

Any missing video, missing report, negative marker, or non-pass decision fails
the release gate. Use --require-producer <producer> to require a specific video
origin such as ona-environment. Use --require-client-gui-capture for Minecraft
product video gates that must show a real Minecraft client view rather than a
trace-driven server-observation composite, must start after the client reaches
the world, and must follow the active server_agent.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!reviewPath || !summaryPath || !mp4Path || !outputPath) {
  console.error("--review, --summary, --mp4, and --output cannot be empty");
  process.exit(2);
}

async function stat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function marker(text, label) {
  const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim().toLowerCase() ?? "";
}

function summaryCount(text, label) {
  const match = text.match(new RegExp(`^-\\s*${label}:\\s*\`?(\\d+)\`?\\s*$`, "im"));
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

const failures = [];
const reviewStat = await stat(reviewPath);
const summaryStat = await stat(summaryPath);
const mp4Stat = await stat(mp4Path);
const origin = await readJson(originPath);
const storageManifest = await readJson(manifestPath);
const producer = origin?.producer ?? "unknown";
const videoKind = origin?.videoKind ?? "unknown";
const clientGuiCapture = origin?.clientGuiCapture === true;
const minecraftClientPanel = origin?.minecraftClientPanel === true;
const mcpTerminalLogPanel = origin?.mcpTerminalLogPanel === true;
const clientWorldReady = origin?.clientWorldReady === true;
const captureStartedAfterWorldReady = origin?.captureStartedAfterWorldReady === true;
const recorderAutoFollow = origin?.recorderAutoFollow === true;
const recorderTargetMoved = origin?.recorderTargetMoved === true;
const recorderClientFollow = origin?.recorderClientFollow === true;
const recorderClientTargetCentered = origin?.recorderClientTargetCentered === true;
const recorderClientTargetVisible = origin?.recorderClientTargetVisible === true;
const recorderObservedServerAgentCount = Number.isFinite(origin?.recorderObservedServerAgentCount)
  ? origin.recorderObservedServerAgentCount
  : 0;
const recorderExpectedVisibleServerAgents = Number.isFinite(origin?.recorderExpectedVisibleServerAgents)
  ? origin.recorderExpectedVisibleServerAgents
  : 0;
const recorderVisibleAgentCountMatchesExpectation = origin?.recorderVisibleAgentCountMatchesExpectation === true;
const recorderSelectedTargetName = origin?.recorderSelectedTargetName ?? "";
const recorderUniqueTargetNames = Array.isArray(origin?.recorderUniqueTargetNames) ? origin.recorderUniqueTargetNames : [];
const recorderSelectedSingleTargetStable = origin?.recorderSelectedSingleTargetStable === true;
const recorderReadyBeforeScenario = origin?.recorderReadyBeforeScenario === true;
const recorderWorkCoverageAdequate = origin?.recorderWorkCoverageAdequate === true;
const recorderWorkHoldSeconds = Number.isFinite(origin?.recorderWorkHoldSeconds) ? origin.recorderWorkHoldSeconds : 0;
const recorderMinWorkVisibleSeconds = Number.isFinite(origin?.recorderMinWorkVisibleSeconds)
  ? origin.recorderMinWorkVisibleSeconds
  : 0;
const recorderVisibleMining = origin?.recorderVisibleMining === true;
const recorderVisibleMiningMs = Number.isFinite(origin?.recorderVisibleMiningMs) ? origin.recorderVisibleMiningMs : 0;
const recorderMinVisibleMiningMs = Number.isFinite(origin?.recorderMinVisibleMiningMs)
  ? origin.recorderMinVisibleMiningMs
  : 0;
const recorderVisibleMiningDurationAdequate = origin?.recorderVisibleMiningDurationAdequate === true;
const requiresVisibleMining = origin?.requiresVisibleMining === true;
const recorderScenarioActionVisible = origin?.recorderScenarioActionVisible === true;
const visualQualityPassed = origin?.visualQualityPassed === true;
const visualJitterPassed = origin?.visualJitterPassed === true;
const visualActionMotionCoveragePassed = origin?.visualActionMotionCoveragePassed === true;
const visualStaticTailPassed = origin?.visualStaticTailPassed === true;
const submittedActionsTerminalConfirmed = origin?.submittedActionsTerminalConfirmed === true;
const submittedActionPendingCount = Number.isFinite(origin?.submittedActionPendingCount)
  ? origin.submittedActionPendingCount
  : 0;
const recorderWorkVisible = origin?.recorderWorkVisible === true;
const serverAgentTaskActionVisible = origin?.serverAgentTaskActionVisible === true;
const review = await readText(reviewPath);
const summary = await readText(summaryPath);
const scenarioReportCount = summaryCount(summary, "Scenario reports");

if (!summaryStat || !summaryStat.isFile() || summaryStat.size === 0) {
  failures.push(`Missing acceptance summary: ${summaryPath}`);
} else {
  if (scenarioReportCount === null) {
    failures.push("Acceptance summary does not declare Scenario reports");
  } else if (scenarioReportCount <= 0) {
    failures.push(
      "Acceptance video has zero scenario reports; placeholder videos cannot be released as final evidence",
    );
  }
  if (/^\s*-\s*No scenario reports found\./im.test(summary)) {
    failures.push("Acceptance summary contains no scenario reports");
  }
}

if (requireMp4 && (!mp4Stat || !mp4Stat.isFile() || mp4Stat.size === 0)) {
  failures.push(`Missing required acceptance MP4: ${mp4Path}`);
}

if (requireClientGuiCapture) {
  if (!origin) {
    failures.push(`Missing acceptance video origin metadata: ${originPath}`);
  } else if (!clientGuiCapture) {
    failures.push(
      `Acceptance video is ${videoKind} with clientGuiCapture=false; Minecraft product gates require normal Minecraft client footage`,
    );
  } else {
    if (!minecraftClientPanel) {
      failures.push("Acceptance video origin does not confirm a left-side normal Minecraft client panel");
    }
    if (!mcpTerminalLogPanel) {
      failures.push("Acceptance video origin does not confirm a right-side MCP/server terminal log panel");
    }
    if (!clientWorldReady) {
      failures.push("Acceptance video origin does not confirm the recorder client reached an in-world Minecraft view");
    }
    if (!captureStartedAfterWorldReady) {
      failures.push("Acceptance video origin does not confirm capture started after the recorder client reached the world");
    }
    if (!recorderAutoFollow) {
      failures.push("Acceptance video origin does not confirm recorder auto-follow of the active server_agent");
    }
    if (!recorderTargetMoved) {
      failures.push("Acceptance video origin does not confirm visible movement from the active server_agent");
    }
    if (!recorderClientFollow) {
      failures.push("Acceptance video origin does not confirm recorder client-visible follow of the active server_agent");
    }
    if (!recorderClientTargetCentered) {
      failures.push(
        "Acceptance video origin does not confirm recorder target-centered framing of the active server_agent",
      );
    }
    if (!recorderClientTargetVisible) {
      failures.push(
        "Acceptance video origin does not confirm clear line-of-sight visibility of the active server_agent",
      );
    }
    if (!recorderVisibleAgentCountMatchesExpectation) {
      failures.push(
        `Acceptance video origin saw ${recorderObservedServerAgentCount || "unknown"} visible server_agent candidate(s), expected ${recorderExpectedVisibleServerAgents || "unknown"}`,
      );
    }
    if (!recorderSelectedSingleTargetStable) {
      failures.push(
        `Acceptance video origin has ambiguous or unstable target identity: selected=${recorderSelectedTargetName || "unknown"} observed=${recorderUniqueTargetNames.join(",") || "none"}`,
      );
    }
    if (!recorderReadyBeforeScenario) {
      failures.push("Acceptance video origin does not confirm the recorder was ready before task work began");
    }
    if (!recorderWorkCoverageAdequate) {
      failures.push(
        `Acceptance video origin does not confirm adequate visible work coverage: postHold=${recorderWorkHoldSeconds}s minWork=${recorderMinWorkVisibleSeconds}s`,
      );
    }
    if (requiresVisibleMining && !recorderVisibleMining) {
      failures.push("Acceptance video origin requires visible mining evidence but recorderVisibleMining is false");
    }
    if (requiresVisibleMining && !recorderVisibleMiningDurationAdequate) {
      failures.push(
        `Acceptance video origin visible mining duration is too short: ${recorderVisibleMiningMs}ms < ${recorderMinVisibleMiningMs}ms`,
      );
    }
    if (!recorderScenarioActionVisible) {
      failures.push("Acceptance video origin does not confirm scenario-specific visible task action");
    }
    if (!visualQualityPassed) {
      failures.push("Acceptance video origin visual QA did not pass");
    }
    if (!visualJitterPassed) {
      failures.push("Acceptance video origin visual jitter check did not pass");
    }
    if (!visualActionMotionCoveragePassed) {
      failures.push("Acceptance video origin visual action-motion coverage check did not pass");
    }
    if (!visualStaticTailPassed) {
      failures.push("Acceptance video origin visual static-tail check did not pass");
    }
    if (!submittedActionsTerminalConfirmed) {
      failures.push(
        `Acceptance video origin does not confirm submitted actions reached terminal lifecycle states; pending=${submittedActionPendingCount}`,
      );
    }
    if (!recorderWorkVisible) {
      failures.push(
        "Acceptance video origin does not confirm active visible server_agent work for the task",
      );
    }
    if (!serverAgentTaskActionVisible) {
      failures.push(
        "Acceptance video origin does not confirm the visible server_agent is performing the requested task",
      );
    }
  }
}

if (storageManifest) {
  if (mp4Stat?.isFile()) {
    const currentMp4Hash = await sha256(mp4Path);
    if (storageManifest.mp4Sha256 !== currentMp4Hash) {
      failures.push(`Video storage manifest MP4 hash mismatch: ${storageManifest.mp4Sha256 || "missing"}`);
    }
  }
  if (summaryStat?.isFile()) {
    const currentSummaryHash = await sha256(summaryPath);
    if (storageManifest.summarySha256 !== currentSummaryHash) {
      failures.push(`Video storage manifest summary hash mismatch: ${storageManifest.summarySha256 || "missing"}`);
    }
  }
  if (requireProducer && storageManifest.producer !== requireProducer) {
    failures.push(`Video storage manifest producer is ${storageManifest.producer || "missing"}, expected ${requireProducer}`);
  }
  if (requireClientGuiCapture && storageManifest.clientGuiCapture !== true) {
    failures.push("Video storage manifest does not confirm clientGuiCapture=true");
  }
  if (requireClientGuiCapture && storageManifest.minecraftClientPanel !== true) {
    failures.push("Video storage manifest does not confirm minecraftClientPanel=true");
  }
  if (requireClientGuiCapture && storageManifest.mcpTerminalLogPanel !== true) {
    failures.push("Video storage manifest does not confirm mcpTerminalLogPanel=true");
  }
  if (requireClientGuiCapture && storageManifest.clientWorldReady !== true) {
    failures.push("Video storage manifest does not confirm clientWorldReady=true");
  }
  if (requireClientGuiCapture && storageManifest.captureStartedAfterWorldReady !== true) {
    failures.push("Video storage manifest does not confirm captureStartedAfterWorldReady=true");
  }
  if (requireClientGuiCapture && storageManifest.recorderAutoFollow !== true) {
    failures.push("Video storage manifest does not confirm recorderAutoFollow=true");
  }
  if (requireClientGuiCapture && storageManifest.recorderTargetMoved !== true) {
    failures.push("Video storage manifest does not confirm recorderTargetMoved=true");
  }
  if (requireClientGuiCapture && storageManifest.recorderClientFollow !== true) {
    failures.push("Video storage manifest does not confirm recorderClientFollow=true");
  }
  if (requireClientGuiCapture && storageManifest.recorderClientTargetCentered !== true) {
    failures.push("Video storage manifest does not confirm recorderClientTargetCentered=true");
  }
  if (requireClientGuiCapture && storageManifest.recorderClientTargetVisible !== true) {
    failures.push("Video storage manifest does not confirm recorderClientTargetVisible=true");
  }
  if (requireClientGuiCapture && storageManifest.recorderReadyBeforeScenario !== true) {
    failures.push("Video storage manifest does not confirm recorderReadyBeforeScenario=true");
  }
  if (requireClientGuiCapture && storageManifest.recorderWorkCoverageAdequate !== true) {
    failures.push("Video storage manifest does not confirm recorderWorkCoverageAdequate=true");
  }
  if (requireClientGuiCapture && storageManifest.requiresVisibleMining === true && storageManifest.recorderVisibleMining !== true) {
    failures.push("Video storage manifest requires visible mining evidence but recorderVisibleMining is not true");
  }
  if (
    requireClientGuiCapture &&
    storageManifest.requiresVisibleMining === true &&
    storageManifest.recorderVisibleMiningDurationAdequate !== true
  ) {
    failures.push("Video storage manifest requires visible mining evidence but duration is not adequate");
  }
  if (requireClientGuiCapture && storageManifest.recorderScenarioActionVisible !== true) {
    failures.push("Video storage manifest does not confirm recorderScenarioActionVisible=true");
  }
  if (requireClientGuiCapture && storageManifest.submittedActionsTerminalConfirmed !== true) {
    failures.push("Video storage manifest does not confirm submittedActionsTerminalConfirmed=true");
  }
  if (requireClientGuiCapture && storageManifest.recorderWorkVisible !== true) {
    failures.push("Video storage manifest does not confirm recorderWorkVisible=true");
  }
  if (requireClientGuiCapture && storageManifest.serverAgentTaskActionVisible !== true) {
    failures.push("Video storage manifest does not confirm serverAgentTaskActionVisible=true");
  }
}

if (!reviewStat || !reviewStat.isFile() || reviewStat.size === 0) {
  failures.push(`Missing same-session video verifier report: ${reviewPath}`);
} else {
  const releaseDecision = marker(review, "Release decision");
  const taskMatched = marker(review, "Task matched");
  const videoMatched = marker(review, "Video matched");
  const reviewedProducer = marker(review, "Video producer");
  const reviewedClientGuiCapture = marker(review, "Client GUI capture");
  const reviewedMinecraftClientPanel = marker(review, "Minecraft client panel");
  const reviewedMcpTerminalLogPanel = marker(review, "MCP terminal log panel");
  const reviewedClientWorldReady = marker(review, "Client world ready");
  const reviewedCaptureStartedAfterWorldReady = marker(review, "Capture started after world ready");
  const reviewedRecorderAutoFollow = marker(review, "Recorder auto-follow");
  const reviewedRecorderTargetMoved = marker(review, "Recorder target moved");
  const reviewedRecorderClientFollow = marker(review, "Recorder client follow");
  const reviewedRecorderClientTargetCentered = marker(review, "Recorder client target centered");
  const reviewedRecorderClientTargetVisible = marker(review, "Recorder client target visible");
  const reviewedRecorderVisibleAgentCountMatchesExpectation = marker(
    review,
    "Recorder visible agent count matches expectation",
  );
  const reviewedRecorderSelectedTargetStable = marker(review, "Recorder selected target stable");
  const reviewedRecorderReadyBeforeScenario = marker(review, "Recorder ready before scenario");
  const reviewedRecorderWorkCoverageAdequate = marker(review, "Recorder work coverage adequate");
  const reviewedRecorderVisibleMining = marker(review, "Recorder visible mining");
  const reviewedRecorderVisibleMiningDurationAdequate = marker(review, "Recorder visible mining duration adequate");
  const reviewedRequiresVisibleMining = marker(review, "Requires visible mining");
  const reviewedRecorderScenarioActionVisible = marker(review, "Recorder scenario action visible");
  const reviewedVisualQaPassed = marker(review, "Visual QA passed");
  const reviewedVisualJitterPassed = marker(review, "Visual jitter passed");
  const reviewedVisualActionMotionCoveragePassed = marker(review, "Visual action motion coverage passed");
  const reviewedSubmittedActionsTerminalConfirmed = marker(review, "Submitted actions terminal confirmed");
  const reviewedRecorderWorkVisible = marker(review, "Recorder work visible");
  const reviewedServerAgentTaskActionVisible = marker(review, "Server agent task action visible");
  const verifier = marker(review, "Verifier");
  const reviewedSummaryHash = marker(review, "Summary sha256");
  const reviewedMp4Hash = marker(review, "MP4 sha256");
  if (!verifier.includes("ona platform") || !verifier.includes("codex")) {
    failures.push(`Video verifier is not Ona Platform Codex: ${verifier || "missing"}`);
  }
  if (releaseDecision !== "pass") {
    failures.push(`Video verifier release decision is not pass: ${releaseDecision || "missing"}`);
  }
  if (taskMatched !== "yes") {
    failures.push(`Video verifier task match is not yes: ${taskMatched || "missing"}`);
  }
  if (videoMatched !== "yes") {
    failures.push(`Video verifier video match is not yes: ${videoMatched || "missing"}`);
  }
  if (reviewedProducer && reviewedProducer !== String(producer).toLowerCase()) {
    failures.push(`Video verifier producer mismatch: ${reviewedProducer}`);
  }
  if (requireProducer && producer !== requireProducer) {
    failures.push(`Acceptance video producer is ${producer}, expected ${requireProducer}`);
  }
  if (requireClientGuiCapture && reviewedClientGuiCapture !== "yes") {
    failures.push(
      `Video verifier did not confirm normal Minecraft client footage: ${reviewedClientGuiCapture || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedMinecraftClientPanel !== "yes") {
    failures.push(
      `Video verifier did not confirm the left-side Minecraft client panel: ${reviewedMinecraftClientPanel || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedMcpTerminalLogPanel !== "yes") {
    failures.push(
      `Video verifier did not confirm the right-side MCP/server terminal log panel: ${reviewedMcpTerminalLogPanel || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedClientWorldReady !== "yes") {
    failures.push(
      `Video verifier did not confirm in-world Minecraft capture: ${reviewedClientWorldReady || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedCaptureStartedAfterWorldReady !== "yes") {
    failures.push(
      `Video verifier did not confirm capture-after-world-ready: ${reviewedCaptureStartedAfterWorldReady || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedRecorderAutoFollow !== "yes") {
    failures.push(
      `Video verifier did not confirm recorder auto-follow: ${reviewedRecorderAutoFollow || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedRecorderTargetMoved !== "yes") {
    failures.push(
      `Video verifier did not confirm active server_agent movement: ${reviewedRecorderTargetMoved || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedRecorderClientFollow !== "yes") {
    failures.push(
      `Video verifier did not confirm recorder client-visible follow: ${reviewedRecorderClientFollow || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedRecorderClientTargetCentered !== "yes") {
    failures.push(
      `Video verifier did not confirm recorder target-centered framing: ${reviewedRecorderClientTargetCentered || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedRecorderClientTargetVisible !== "yes") {
    failures.push(
      `Video verifier did not confirm recorder target visibility: ${reviewedRecorderClientTargetVisible || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedRecorderVisibleAgentCountMatchesExpectation !== "yes") {
    failures.push(
      `Video verifier did not confirm expected visible server_agent count: ${reviewedRecorderVisibleAgentCountMatchesExpectation || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedRecorderSelectedTargetStable !== "yes") {
    failures.push(
      `Video verifier did not confirm stable unambiguous recorder target identity: ${reviewedRecorderSelectedTargetStable || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedRecorderReadyBeforeScenario !== "yes") {
    failures.push(
      `Video verifier did not confirm recorder readiness before task work: ${reviewedRecorderReadyBeforeScenario || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedRecorderWorkCoverageAdequate !== "yes") {
    failures.push(
      `Video verifier did not confirm adequate visible work coverage: ${reviewedRecorderWorkCoverageAdequate || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedRequiresVisibleMining === "yes" && reviewedRecorderVisibleMining !== "yes") {
    failures.push(
      `Video verifier did not confirm visible mining evidence: ${reviewedRecorderVisibleMining || "missing"}`,
    );
  }
  if (
    requireClientGuiCapture &&
    reviewedRequiresVisibleMining === "yes" &&
    reviewedRecorderVisibleMiningDurationAdequate !== "yes"
  ) {
    failures.push(
      `Video verifier did not confirm adequate visible mining duration: ${reviewedRecorderVisibleMiningDurationAdequate || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedRecorderScenarioActionVisible !== "yes") {
    failures.push(
      `Video verifier did not confirm scenario-specific visible task action: ${reviewedRecorderScenarioActionVisible || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedVisualQaPassed !== "yes") {
    failures.push(`Video verifier did not confirm visual QA passed: ${reviewedVisualQaPassed || "missing"}`);
  }
  if (requireClientGuiCapture && reviewedVisualJitterPassed !== "yes") {
    failures.push(`Video verifier did not confirm jitter-free enough footage: ${reviewedVisualJitterPassed || "missing"}`);
  }
  if (requireClientGuiCapture && reviewedVisualActionMotionCoveragePassed !== "yes") {
    failures.push(
      `Video verifier did not confirm action-motion coverage: ${reviewedVisualActionMotionCoveragePassed || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedSubmittedActionsTerminalConfirmed !== "yes") {
    failures.push(
      `Video verifier did not confirm submitted action terminal lifecycle completion: ${reviewedSubmittedActionsTerminalConfirmed || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedRecorderWorkVisible !== "yes") {
    failures.push(
      `Video verifier did not confirm active visible server_agent work: ${reviewedRecorderWorkVisible || "missing"}`,
    );
  }
  if (requireClientGuiCapture && reviewedServerAgentTaskActionVisible !== "yes") {
    failures.push(
      `Video verifier did not confirm visible server_agent task action: ${reviewedServerAgentTaskActionVisible || "missing"}`,
    );
  }
  if (/^Release decision:\s*fail/im.test(review)) {
    failures.push("Video verifier reported fail");
  }
  if (/^Task matched:\s*no/im.test(review)) {
    failures.push("Video verifier reported task mismatch");
  }
  if (/^Video matched:\s*no/im.test(review)) {
    failures.push("Video verifier reported video mismatch");
  }
  if (summaryStat?.isFile()) {
    const currentSummaryHash = await sha256(summaryPath);
    if (reviewedSummaryHash !== currentSummaryHash) {
      failures.push(`Video verifier summary hash mismatch: ${reviewedSummaryHash || "missing"}`);
    }
  }
  if (mp4Stat?.isFile()) {
    const currentMp4Hash = await sha256(mp4Path);
    if (reviewedMp4Hash !== currentMp4Hash) {
      failures.push(`Video verifier MP4 hash mismatch: ${reviewedMp4Hash || "missing"}`);
    }
  }
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const lines = [
  "# MineLink Goal-Mode Acceptance Video Release Gate",
  "",
  "- Boundary: `Goal-mode task release requires the Ona-produced acceptance.mp4 plus same-session Codex verifier approval; StartAgent launch/readback alone is not release evidence`",
  `- Review report: \`${reviewPath}\``,
  `- Acceptance summary: \`${summaryPath}\``,
  `- Acceptance MP4: \`${mp4Path}\``,
  `- Acceptance video origin: \`${originPath}\``,
  `- Video storage manifest: \`${manifestPath}\``,
  `- Video producer: \`${producer}\``,
  `- Video kind: \`${videoKind}\``,
  `- Required producer: \`${requireProducer || "none"}\``,
  `- MP4 required: \`${requireMp4 ? "yes" : "no"}\``,
  `- Client GUI capture: \`${clientGuiCapture ? "yes" : "no"}\``,
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
  `- Recorder work coverage adequate: \`${recorderWorkCoverageAdequate ? "yes" : "no"}\``,
  `- Recorder work hold seconds: \`${recorderWorkHoldSeconds}\``,
  `- Recorder min work visible seconds: \`${recorderMinWorkVisibleSeconds}\``,
  `- Recorder visible mining: \`${recorderVisibleMining ? "yes" : "no"}\``,
  `- Recorder visible mining ms: \`${recorderVisibleMiningMs}\``,
  `- Recorder min visible mining ms: \`${recorderMinVisibleMiningMs}\``,
  `- Recorder visible mining duration adequate: \`${recorderVisibleMiningDurationAdequate ? "yes" : "no"}\``,
  `- Requires visible mining: \`${requiresVisibleMining ? "yes" : "no"}\``,
  `- Recorder scenario action visible: \`${recorderScenarioActionVisible ? "yes" : "no"}\``,
  `- Visual QA passed: \`${visualQualityPassed ? "yes" : "no"}\``,
  `- Visual jitter passed: \`${visualJitterPassed ? "yes" : "no"}\``,
  `- Visual action motion coverage passed: \`${visualActionMotionCoveragePassed ? "yes" : "no"}\``,
  `- Visual static tail passed: \`${visualStaticTailPassed ? "yes" : "no"}\``,
  `- Submitted actions terminal confirmed: \`${submittedActionsTerminalConfirmed ? "yes" : "no"}\``,
  `- Submitted action pending count: \`${submittedActionPendingCount}\``,
  `- Recorder work visible: \`${recorderWorkVisible ? "yes" : "no"}\``,
  `- Server agent task action visible: \`${serverAgentTaskActionVisible ? "yes" : "no"}\``,
  `- Client GUI capture required: \`${requireClientGuiCapture ? "yes" : "no"}\``,
  `- Storage provider: \`${storageManifest?.storageProvider || "none"}\``,
  `- Storage object: \`${storageManifest?.objectKey || "none"}\``,
  `- Storage video URL: ${storageManifest?.videoUrl || "none"}`,
  `- Scenario reports: \`${scenarioReportCount ?? "unknown"}\``,
  `- Result: \`${failures.length === 0 ? "passed" : "failed"}\``,
  "",
  "## Failures",
  "",
  ...(failures.length === 0 ? ["- none"] : failures.map((failure) => `- ${failure}`)),
  "",
];
await fs.writeFile(outputPath, lines.join("\n"), "utf8");

if (failures.length > 0) {
  console.error(`Acceptance video release gate failed; wrote ${outputPath}`);
  process.exit(1);
}

console.log(`Acceptance video release gate passed; wrote ${outputPath}`);
