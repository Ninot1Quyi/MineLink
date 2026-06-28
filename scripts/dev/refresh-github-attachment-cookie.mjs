#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text.length > 0 && !["none", "null", "undefined", "-"].includes(text.toLowerCase())) return text;
  }
  return "";
}

const args = {
  repository: firstNonEmpty(process.env.GITHUB_REPOSITORY),
  pr: firstNonEmpty(process.env.MINELINK_PR_NUMBER),
  secretName: "MINELINK_GITHUB_USER_SESSION",
  cookie: firstNonEmpty(
    process.env.MINELINK_GITHUB_USER_SESSION,
    process.env.GH_SESSION_TOKEN,
  ),
  cookieFile:
    process.env.MINELINK_GITHUB_USER_SESSION_FILE ??
    ".minelink-dev/secrets/github-user-session.cookie",
  updateSecret: false,
  timeoutMs: Number(process.env.MINELINK_GITHUB_COOKIE_REFRESH_TIMEOUT_MS ?? 30000),
  output: ".minelink-dev/reports/github-attachment-cookie-refresh.md",
  jsonOutput: ".minelink-dev/reports/github-attachment-cookie-refresh.json",
};

let dryRun = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repository") args.repository = readValue();
  else if (arg === "--pr") args.pr = readValue();
  else if (arg === "--secret-name") args.secretName = readValue();
  else if (arg === "--cookie") args.cookie = readValue();
  else if (arg === "--cookie-file") args.cookieFile = readValue();
  else if (arg === "--update-secret") args.updateSecret = true;
  else if (arg === "--timeout-ms") args.timeoutMs = Number(readValue());
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/refresh-github-attachment-cookie.mjs --repository owner/repo [--pr N]

Validates a still-accepted GitHub Web raw user_session without opening or
controlling a browser. The script reads an existing raw user_session from
MINELINK_GITHUB_USER_SESSION, GH_SESSION_TOKEN, or an ignored local file,
synthesizes the required Cookie header, fetches the GitHub
PR/repository page, also exercises GitHub's shared websocket /_alive refresh
path when present, absorbs Set-Cookie updates, verifies the page is still signed
in, and writes the updated cookie back to the ignored local file.

This cannot create a new GitHub web login, cannot mint user_session from
saved_user_sessions, and cannot make GitHub cookies non-expiring. If GitHub
rejects the existing user_session, refresh fails closed.

Options:
  --repository owner/repo   Repository used for the refresh request.
  --pr N                    Prefer this PR page for refresh/validation.
  --cookie-file FILE        Ignored local cookie file. Defaults to
                            .minelink-dev/secrets/github-user-session.cookie.
  --cookie VALUE            Raw GitHub user_session override. Cookie headers are
                            accepted only for local diagnostics.
  --update-secret           Also update MINELINK_GITHUB_USER_SESSION through gh.
  --dry-run                 Validate and report without writing cookie/secret.`);
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
    .replace(/(github_pat_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(ghp_)[A-Za-z0-9_]+/g, "$1[redacted]")
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

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function pageTitle(html) {
  const match = String(html ?? "").match(/<title>\s*([\s\S]*?)\s*<\/title>/i);
  return match ? decodeHtml(match[1]).replace(/\s+/g, " ").trim() : "";
}

function tagAttribute(tag, name) {
  const match = String(tag ?? "").match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function sharedWebSocketRefreshUrl(html, pageUrl) {
  const links = String(html ?? "").match(/<link\b[^>]*>/gi) ?? [];
  for (const link of links) {
    if (!/\brel=["'][^"']*\bshared-web-socket\b/i.test(link)) continue;
    const refreshUrl = tagAttribute(link, "data-refresh-url");
    if (!hasValue(refreshUrl)) return "";
    return new URL(refreshUrl, pageUrl).toString();
  }
  return "";
}

function isSignedOutGithubHtml(html) {
  const source = String(html ?? "");
  return (
    /sign in to github/i.test(pageTitle(source)) ||
    /<form\b[^>]*action=["']\/session["'][^>]*>/i.test(source) ||
    /\/login\?return_to=/i.test(source)
  );
}

function parseCookiePairs(cookie) {
  const text = String(cookie ?? "").trim();
  if (!hasValue(text)) return [];
  if (!text.includes("=") && !text.includes(";")) {
    return [
      ["user_session", text],
      ["__Host-user_session_same_site", text],
      ["logged_in", "yes"],
    ];
  }
  return text
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      if (index < 1) return null;
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    })
    .filter(Boolean);
}

function cookieHeaderFromJar(cookieJar) {
  const priority = new Map([
    ["logged_in", 1],
    ["dotcom_user", 2],
    ["user_session", 3],
    ["__Host-user_session_same_site", 4],
    ["_gh_sess", 5],
  ]);
  return Array.from(cookieJar.entries())
    .filter(([name, value]) => hasValue(name) && hasValue(value))
    .sort(([left], [right]) => (priority.get(left) ?? 100) - (priority.get(right) ?? 100))
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function updateCookieJar(cookieJar, response) {
  const headers = response?.headers;
  const setCookies =
    typeof headers?.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers?.get?.("set-cookie")].filter(Boolean);
  const names = [];
  for (const header of setCookies) {
    for (const cookie of String(header ?? "").split(/,(?=\s*[^;,]+=)/)) {
      const first = cookie.split(";")[0]?.trim();
      const index = first?.indexOf("=") ?? -1;
      if (index > 0) {
        const name = first.slice(0, index);
        names.push(name);
        cookieJar.set(name, first.slice(index + 1));
      }
    }
  }
  if (cookieJar.has("user_session") && !cookieJar.has("__Host-user_session_same_site")) {
    cookieJar.set("__Host-user_session_same_site", cookieJar.get("user_session"));
  }
  if (cookieJar.has("user_session") && !cookieJar.has("logged_in")) {
    cookieJar.set("logged_in", "yes");
  }
  return names;
}

async function readCookieSource() {
  if (hasValue(args.cookie)) return args.cookie.trim();
  if (!hasValue(args.cookieFile)) return "";
  try {
    return (await fs.readFile(args.cookieFile, "utf8")).trim();
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function validationUrls(repository) {
  const urls = [];
  if (/^\d+$/.test(String(args.pr))) urls.push(`https://github.com/${repository}/pull/${args.pr}`);
  urls.push(`https://github.com/${repository}`);
  return urls;
}

async function refreshAliveSocket(cookieJar, pageUrl, html) {
  const refreshUrl = sharedWebSocketRefreshUrl(html, pageUrl);
  if (!hasValue(refreshUrl)) return null;
  const startedAt = Date.now();
  const response = await fetch(refreshUrl, {
    method: "POST",
    headers: {
      Accept: "text/plain, */*; q=0.01",
      Cookie: cookieHeaderFromJar(cookieJar),
      "GitHub-Verified-Fetch": "true",
      Origin: "https://github.com",
      Referer: pageUrl,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(args.timeoutMs),
  });
  const setCookieNames = updateCookieJar(cookieJar, response);
  const text = await response.text().catch(() => "");
  return {
    kind: "alive-websocket-refresh",
    url: refreshUrl.replace(/([?&]session=)[^&]+/i, "$1[redacted]"),
    status: response.status,
    finalUrl: response.url,
    signedOut: false,
    title: text.startsWith("wss://") ? "alive websocket url" : pageTitle(text),
    setCookieNames,
    userSessionSetCookie: setCookieNames.some((name) => name === "user_session" || name === "__Host-user_session_same_site"),
    durationMs: Date.now() - startedAt,
  };
}

async function refreshCookie(repository, cookieJar) {
  const attempts = [];
  for (const url of validationUrls(repository)) {
    const startedAt = Date.now();
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Cookie: cookieHeaderFromJar(cookieJar),
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(args.timeoutMs),
    });
    const setCookieNames = updateCookieJar(cookieJar, response);
    const text = await response.text();
    const signedOut = isSignedOutGithubHtml(text);
    attempts.push({
      kind: "page-validation",
      url,
      status: response.status,
      finalUrl: response.url,
      signedOut,
      title: pageTitle(text),
      setCookieNames,
      userSessionSetCookie: setCookieNames.some(
        (name) => name === "user_session" || name === "__Host-user_session_same_site",
      ),
      durationMs: Date.now() - startedAt,
    });
    if (response.ok && !signedOut) {
      const aliveAttempt = await refreshAliveSocket(cookieJar, response.url, text).catch((error) => ({
        kind: "alive-websocket-refresh",
        url: "detected shared web socket refresh",
        status: 0,
        finalUrl: "",
        signedOut: false,
        title: `failed: ${compact(error?.message ?? error)}`,
        setCookieNames: [],
        userSessionSetCookie: false,
        durationMs: 0,
      }));
      if (aliveAttempt) attempts.push(aliveAttempt);
      return attempts;
    }
  }
  return attempts;
}

async function writeCookieFile(cookieHeader) {
  if (!hasValue(args.cookieFile) || dryRun) return;
  await fs.mkdir(path.dirname(args.cookieFile), { recursive: true });
  await fs.writeFile(args.cookieFile, `${cookieHeader}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(args.cookieFile, 0o600).catch(() => {});
}

async function updateCookieSecret(cookieHeader, report) {
  if (!args.updateSecret || dryRun) return;
  const result = spawnSync("gh", ["secret", "set", args.secretName, "--repo", report.repository], {
    input: cookieHeader,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  report.secretUpdateStatus = result.status ?? 1;
  report.secretUpdateStdout = compact(result.stdout);
  report.secretUpdateStderr = compact(result.stderr);
  if (result.status !== 0) {
    throw new Error(`gh secret set failed: ${compact(result.stderr || result.stdout)}`);
  }
  report.secretUpdated = true;
}

async function writeReport(report) {
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
  const lines = [
    "# GitHub Attachment Cookie Refresh",
    "",
    `- Result: \`${report.result}\``,
    `- Repository: \`${report.repository}\``,
    `- PR: \`${args.pr || "none"}\``,
    `- Cookie file: \`${args.cookieFile || "none"}\``,
    `- Secret update requested: \`${args.updateSecret ? "yes" : "no"}\``,
    `- Secret updated: \`${report.secretUpdated ? "yes" : "no"}\``,
    `- Dry run: \`${report.dryRun ? "yes" : "no"}\``,
    `- User session Set-Cookie observed: \`${report.userSessionSetCookieObserved ? "yes" : "no"}\``,
    `- Initial cookie names: ${
      report.initialCookieNames.length > 0 ? report.initialCookieNames.map((name) => `\`${name}\``).join(", ") : "none"
    }`,
    `- Cookie names: ${report.cookieNames.length > 0 ? report.cookieNames.map((name) => `\`${name}\``).join(", ") : "none"}`,
    `- Boundary: \`${report.boundary}\``,
    "",
    "## Initial Cookie Signals",
    "",
    ...Object.entries(report.initialCookieSignals).map(([key, value]) => `- ${key}: \`${value ? "yes" : "no"}\``),
    "",
    "## Cookie Signals",
    "",
    ...Object.entries(report.cookieSignals).map(([key, value]) => `- ${key}: \`${value ? "yes" : "no"}\``),
    "",
    "## HTTP Attempts",
    "",
    ...(report.attempts.length > 0
      ? report.attempts.map(
          (attempt) =>
            `- ${attempt.kind || "http"} ${attempt.url}: status \`${attempt.status}\`, signedOut \`${attempt.signedOut ? "yes" : "no"}\`, setCookie \`${attempt.setCookieNames?.length ? attempt.setCookieNames.join(",") : "none"}\`, userSessionSetCookie \`${attempt.userSessionSetCookie ? "yes" : "no"}\`, title \`${attempt.title || "none"}\``,
        )
      : ["- none"]),
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
  initialCookieNames: [],
  initialCookieSignals: cookieSignals(""),
  cookieSignals: cookieSignals(""),
  attempts: [],
  secretUpdated: false,
  secretUpdateStatus: null,
  secretUpdateStdout: "",
  secretUpdateStderr: "",
  userSessionSetCookieObserved: false,
  failures: [],
  boundary:
    "script-only GitHub web cookie validation and rolling update; no browser is opened or controlled, cookie values are never printed, and saved_user_sessions is not a user_session refresh token",
};

try {
  if (!/^[^/\s]+\/[^/\s]+$/.test(report.repository)) {
    throw new Error("--repository must be owner/repo or origin must be a GitHub remote.");
  }
  const cookieSource = await readCookieSource();
  if (!hasValue(cookieSource)) {
    throw new Error(
      "GitHub user_session is missing; provide MINELINK_GITHUB_USER_SESSION, GH_SESSION_TOKEN, --cookie, or --cookie-file.",
    );
  }
  const cookieJar = new Map(parseCookiePairs(cookieSource));
  updateCookieJar(cookieJar, { headers: new Headers() });
  const initialCookieHeader = cookieHeaderFromJar(cookieJar);
  report.initialCookieNames = Array.from(cookieJar.keys()).sort();
  report.initialCookieSignals = cookieSignals(initialCookieHeader);
  report.attempts = await refreshCookie(report.repository, cookieJar);
  report.userSessionSetCookieObserved = report.attempts.some((attempt) =>
    (attempt.setCookieNames ?? []).some((name) => name === "user_session" || name === "__Host-user_session_same_site"),
  );
  const accepted = report.attempts.some((attempt) => attempt.status >= 200 && attempt.status < 300 && !attempt.signedOut);
  const refreshedCookie = cookieHeaderFromJar(cookieJar);
  report.cookieNames = Array.from(cookieJar.keys()).sort();
  report.cookieSignals = cookieSignals(refreshedCookie);
  if (!accepted) {
    throw new Error("GitHub web cookie rejected: refresh pages rendered signed-out or non-OK responses.");
  }
  if (!report.cookieSignals.hasUserSession && !report.cookieSignals.hasHostUserSessionSameSite) {
    throw new Error("GitHub Web session does not contain a user_session marker after refresh.");
  }
  if (!report.cookieSignals.hasLoggedIn || !report.cookieSignals.hasDotcomUser) {
    throw new Error("GitHub web cookie does not look logged in after refresh.");
  }
  await writeCookieFile(refreshedCookie);
  await updateCookieSecret(refreshedCookie, report);
  report.result = dryRun ? "dry-run" : "updated";
} catch (error) {
  report.result = "blocked";
  report.failures.push(compact(error?.message ?? error));
} finally {
  await writeReport(report);
}

if (report.result === "blocked") {
  console.error(`GitHub attachment cookie refresh blocked; wrote ${args.output}`);
  process.exit(1);
}

console.log(`GitHub attachment cookie refresh ${report.result}; wrote ${args.output}`);
