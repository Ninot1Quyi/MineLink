#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseDate(value) {
  const ms = Date.parse(value ?? "");
  return Number.isFinite(ms) ? ms : null;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

function readHistory(historyPath) {
  if (!fs.existsSync(historyPath)) return [];
  return fs
    .readFileSync(historyPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${historyPath}:${index + 1}: ${error.message}`);
      }
    })
    .filter((entry) => entry && typeof entry === "object");
}

function summarize(entries) {
  const phaseStats = new Map();
  const firstObservedMs = parseDate(entries[0]?.observedAt);
  const lastEntry = entries[entries.length - 1];
  const lastObservedMs = parseDate(lastEntry?.observedAt);

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const phase = entry.phase ?? "unknown";
    const observedMs = parseDate(entry.observedAt);
    const nextObservedMs = parseDate(entries[index + 1]?.observedAt);
    const fallbackEndMs = parseDate(entry.completionTime) ?? observedMs;
    const endMs = nextObservedMs ?? fallbackEndMs;
    const deltaMs =
      observedMs !== null && endMs !== null && endMs >= observedMs ? endMs - observedMs : 0;

    const current = phaseStats.get(phase) ?? {
      phase,
      count: 0,
      firstObservedAt: entry.observedAt ?? "unknown",
      lastObservedAt: entry.observedAt ?? "unknown",
      observedMs: 0,
      maxSnapshotCompletionPercentage: 0,
    };
    current.count += 1;
    current.lastObservedAt = entry.observedAt ?? current.lastObservedAt;
    current.observedMs += deltaMs;
    current.maxSnapshotCompletionPercentage = Math.max(
      current.maxSnapshotCompletionPercentage,
      Number(entry.snapshotCompletionPercentage ?? 0),
    );
    phaseStats.set(phase, current);
  }

  const phases = [...phaseStats.values()].sort((left, right) => right.observedMs - left.observedMs);
  return {
    observationCount: entries.length,
    firstObservedAt: entries[0]?.observedAt ?? "unknown",
    lastObservedAt: lastEntry?.observedAt ?? "unknown",
    totalObservedMs:
      firstObservedMs !== null && lastObservedMs !== null && lastObservedMs >= firstObservedMs
        ? lastObservedMs - firstObservedMs
        : 0,
    phases,
    longestPhase: phases[0] ?? null,
    finalPhase: lastEntry?.phase ?? "unknown",
    finalSnapshotCompletionPercentage: Number(lastEntry?.snapshotCompletionPercentage ?? 0),
  };
}

function renderMarkdown(summary, historyPath) {
  const lines = [
    "# MineLink Ona Prebuild Phase Summary",
    "",
    `- History: \`${historyPath}\``,
    `- Observations: ${summary.observationCount}`,
    `- First observed: ${summary.firstObservedAt}`,
    `- Last observed: ${summary.lastObservedAt}`,
    `- Approx observed duration: ${formatDuration(summary.totalObservedMs)}`,
    `- Final phase: \`${summary.finalPhase}:${summary.finalSnapshotCompletionPercentage}\``,
  ];

  if (summary.longestPhase) {
    lines.push(
      `- Longest observed phase: \`${summary.longestPhase.phase}\` (${formatDuration(
        summary.longestPhase.observedMs,
      )})`,
    );
  }

  lines.push("", "| Phase | Polls | First seen | Last seen | Approx observed time | Max snapshot % |");
  lines.push("| --- | ---: | --- | --- | ---: | ---: |");
  for (const phase of summary.phases) {
    lines.push(
      `| \`${phase.phase}\` | ${phase.count} | ${phase.firstObservedAt} | ${
        phase.lastObservedAt
      } | ${formatDuration(phase.observedMs)} | ${
        phase.maxSnapshotCompletionPercentage
      } |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

const historyPath = readArg(
  "--history",
  path.join(".minelink-dev", "reports", "ona-prebuild-phase-history.jsonl"),
);
const outPath = readArg(
  "--out",
  path.join(".minelink-dev", "reports", "ona-prebuild-phase-summary.md"),
);
const jsonOutPath = readArg(
  "--json-out",
  path.join(".minelink-dev", "reports", "ona-prebuild-phase-summary.json"),
);

const entries = readHistory(historyPath);
const summary = summarize(entries);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, renderMarkdown(summary, historyPath));
fs.writeFileSync(jsonOutPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
