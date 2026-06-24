#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

const args = {
  repository: process.env.GITHUB_REPOSITORY ?? "",
  secretName: "MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE",
  profileDir: path.resolve(".minelink-dev/github-attachment-cookie-profile"),
  chromePath: process.env.CHROME_PATH ?? "",
  port: Number(process.env.MINELINK_GITHUB_COOKIE_REFRESH_PORT ?? 9223),
  timeoutSeconds: Number(process.env.MINELINK_GITHUB_COOKIE_REFRESH_TIMEOUT_SECONDS ?? 900),
  output: ".minelink-dev/reports/github-attachment-cookie-refresh.md",
  jsonOutput: ".minelink-dev/reports/github-attachment-cookie-refresh.json",
};

let dryRun = false;
let keepBrowser = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repository") args.repository = readValue();
  else if (arg === "--secret-name") args.secretName = readValue();
  else if (arg === "--profile-dir") args.profileDir = path.resolve(readValue());
  else if (arg === "--chrome") args.chromePath = readValue();
  else if (arg === "--port") args.port = Number(readValue());
  else if (arg === "--timeout-seconds") args.timeoutSeconds = Number(readValue());
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "--keep-browser") keepBrowser = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/refresh-github-attachment-cookie.mjs --repository owner/repo

Opens a dedicated Chrome profile for an explicit GitHub login, captures only
github.com cookies from that profile through Chrome DevTools Protocol, and
writes them directly to the GitHub repository secret used by the PR inline
video attachment bridge.

This tool does not read your normal browser profile and never prints cookie
values. It cannot run in GitHub Actions; it is a local operator refresh step.

Options:
  --repository owner/repo   Repository receiving the secret.
  --chrome path             Browser executable. Defaults to Chrome/Chromium.
  --profile-dir path        Dedicated temporary browser profile directory.
  --dry-run                 Validate cookie capture but do not update the secret.
  --keep-browser            Leave the dedicated browser process running.`);
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

async function writeReport(report) {
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
  const lines = [
    "# GitHub Attachment Cookie Refresh",
    "",
    `- Result: \`${report.result}\``,
    `- Repository: \`${report.repository}\``,
    `- Secret: \`${report.secretName}\``,
    `- Dry run: \`${report.dryRun ? "yes" : "no"}\``,
    `- Cookie names: ${report.cookieNames.length > 0 ? report.cookieNames.map((name) => `\`${name}\``).join(", ") : "none"}`,
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
  result: "pending",
  repository: inferRepo() || "unknown",
  secretName: args.secretName,
  dryRun,
  cookieNames: [],
  cookieSignals: cookieSignals(""),
  failures: [],
  boundary:
    "local explicit GitHub web cookie refresh for PR inline video attachment upload; secret values are never printed",
};

let browser = null;
try {
  if (!/^[^/\s]+\/[^/\s]+$/.test(report.repository)) {
    throw new Error("--repository must be owner/repo or origin must be a GitHub remote.");
  }
  const chrome = await resolveChrome();
  await fs.mkdir(args.profileDir, { recursive: true });
  const url = `https://github.com/${report.repository}/pulls`;
  browser = spawn(
    chrome,
    [
      `--remote-debugging-port=${args.port}`,
      `--user-data-dir=${args.profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      url,
    ],
    { stdio: "ignore", detached: true },
  );

  const webSocketDebuggerUrl = await waitForDebuggerUrl();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question(
      "A dedicated Chrome window is open. Log in to GitHub there, then press Enter to refresh the attachment cookie secret. ",
    );
  } finally {
    rl.close();
  }

  const cookies = await readGithubCookies(webSocketDebuggerUrl);
  report.cookieNames = [...new Set(cookies.map((cookie) => cookie.name))].sort();
  const cookieHeader = buildCookieHeader(cookies);
  report.cookieSignals = cookieSignals(cookieHeader);
  if (!report.cookieSignals.hasUserSession && !report.cookieSignals.hasHostUserSessionSameSite) {
    throw new Error("Dedicated browser profile does not contain a GitHub user_session cookie. Login may not be complete.");
  }
  if (!report.cookieSignals.hasLoggedIn || !report.cookieSignals.hasDotcomUser) {
    throw new Error("Dedicated browser profile does not look logged in to github.com.");
  }

  if (!dryRun) {
    const result = spawnSync("gh", ["secret", "set", args.secretName, "--repo", report.repository], {
      input: cookieHeader,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      throw new Error(`gh secret set failed: ${compact(result.stderr || result.stdout)}`);
    }
  }

  report.result = dryRun ? "dry-run" : "updated";
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
  await writeReport(report);
}

if (report.result === "blocked") {
  console.error(`GitHub attachment cookie refresh blocked; wrote ${args.output}`);
  process.exit(1);
}

console.log(`GitHub attachment cookie refresh ${report.result}; wrote ${args.output}`);
