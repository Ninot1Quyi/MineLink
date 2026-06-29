#!/usr/bin/env node
import { createHash } from "node:crypto";
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
  cdpUrl: firstNonEmpty(process.env.MINELINK_GITHUB_BROWSER_CDP_URL, "http://127.0.0.1:9222"),
  repository: firstNonEmpty(process.env.GITHUB_REPOSITORY),
  pr: firstNonEmpty(process.env.MINELINK_PR_NUMBER),
  targetUrl: firstNonEmpty(process.env.MINELINK_GITHUB_BROWSER_TARGET_URL, "https://github.com/"),
  cookieFile:
    process.env.MINELINK_GITHUB_USER_SESSION_FILE ??
    ".minelink-dev/secrets/github-user-session.cookie",
  output: ".minelink-dev/reports/github-browser-cookie-cdp-export.md",
  jsonOutput: ".minelink-dev/reports/github-browser-cookie-cdp-export.json",
  timeoutMs: Number(process.env.MINELINK_GITHUB_BROWSER_CDP_TIMEOUT_MS ?? 15000),
};

let dryRun = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--cdp-url") args.cdpUrl = readValue();
  else if (arg === "--repository") args.repository = readValue();
  else if (arg === "--pr") args.pr = readValue();
  else if (arg === "--target-url") args.targetUrl = readValue();
  else if (arg === "--cookie-file") args.cookieFile = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--timeout-ms") args.timeoutMs = Number(readValue());
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/export-github-cookie-from-cdp.mjs --repository owner/repo --pr N

Exports the current GitHub web cookies from an already-running browser exposed
through Chrome DevTools Protocol, then writes a redacted report plus an ignored
cookie header file for GitHub user-attachment upload helpers.

This script does not open a browser, does not log in, does not upload files,
does not comment on PRs, and never prints cookie values. It requires a browser
already running with a remote debugging endpoint such as
http://127.0.0.1:9222 and an active GitHub login in that browser.

Options:
  --cdp-url URL       CDP HTTP endpoint. Defaults to http://127.0.0.1:9222.
  --target-url URL    GitHub URL used for Network.getCookies.
  --repository REPO   Adds https://github.com/owner/repo[/pull/N] to cookie URLs.
  --pr N              Adds the PR page to cookie URLs.
  --cookie-file FILE  Ignored output cookie file.
  --dry-run           Validate and report without writing the cookie file.`);
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

function normalizeCdpUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

function cdpHttpUrl(base, pathname) {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}${pathname}`;
  return url.toString();
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`CDP request failed: ${response.status} ${response.statusText} ${url}`);
  return response.json();
}

function githubCookieUrls() {
  const urls = new Set(["https://github.com/"]);
  if (hasValue(args.targetUrl)) urls.add(args.targetUrl);
  if (hasValue(args.repository)) {
    urls.add(`https://github.com/${args.repository}`);
    if (/^\d+$/.test(String(args.pr))) urls.add(`https://github.com/${args.repository}/pull/${args.pr}`);
  }
  return Array.from(urls);
}

function selectPageTarget(targets) {
  const pages = targets.filter((target) => target.type === "page" && hasValue(target.webSocketDebuggerUrl));
  const githubPage = pages.find((target) => {
    try {
      return new URL(target.url).hostname === "github.com";
    } catch {
      return false;
    }
  });
  return githubPage ?? pages[0] ?? null;
}

class CdpClient {
  constructor(wsUrl, timeoutMs) {
    this.wsUrl = wsUrl;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  connect() {
    if (typeof WebSocket !== "function") {
      throw new Error("This Node runtime does not expose WebSocket; use Node 22+.");
    }
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.wsUrl);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting to CDP websocket: ${this.wsUrl}`));
      }, this.timeoutMs);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.addEventListener("message", (event) => this.onMessage(event.data));
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`Failed to connect to CDP websocket: ${this.wsUrl}`));
      });
      socket.addEventListener("close", () => {
        for (const { reject: rejectPending } of this.pending.values()) rejectPending(new Error("CDP websocket closed"));
        this.pending.clear();
      });
    });
  }

  onMessage(data) {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!message.id || !this.pending.has(message.id)) return;
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(`${message.error.message ?? "CDP command failed"} (${message.error.code ?? "unknown"})`));
    } else {
      pending.resolve(message.result ?? {});
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP command ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(payload);
    });
  }

  close() {
    this.socket?.close();
  }
}

function hash12(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 12);
}

function cookieExpires(cookie) {
  return Number(cookie.expires) > 0 ? new Date(cookie.expires * 1000).toISOString() : "session";
}

function cookieMetadata(cookie) {
  return {
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookieExpires(cookie),
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
    sameSite: cookie.sameSite ?? "",
    length: String(cookie.value ?? "").length,
    hash12: hash12(cookie.value),
  };
}

function cookieHeader(cookies) {
  const order = new Map([
    ["logged_in", 1],
    ["dotcom_user", 2],
    ["user_session", 3],
    ["__Host-user_session_same_site", 4],
    ["_gh_sess", 5],
    ["saved_user_sessions", 6],
    ["_device_id", 7],
    ["_octo", 8],
  ]);
  return Array.from(cookies.values())
    .filter((cookie) => hasValue(cookie.name) && hasValue(cookie.value))
    .sort((left, right) => (order.get(left.name) ?? 100) - (order.get(right.name) ?? 100))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function selectCookies(cookies) {
  const wanted = new Set([
    "logged_in",
    "dotcom_user",
    "user_session",
    "__Host-user_session_same_site",
    "_gh_sess",
    "saved_user_sessions",
    "_device_id",
    "_octo",
  ]);
  const selected = new Map();
  for (const cookie of cookies) {
    if (!wanted.has(cookie.name)) continue;
    if (!/(^|\.)github\.com$/.test(cookie.domain ?? "")) continue;
    selected.set(cookie.name, cookie);
  }
  if (selected.has("user_session") && !selected.has("__Host-user_session_same_site")) {
    const source = selected.get("user_session");
    selected.set("__Host-user_session_same_site", {
      ...source,
      name: "__Host-user_session_same_site",
      sameSite: "Strict",
    });
  }
  return selected;
}

async function main() {
  const base = normalizeCdpUrl(args.cdpUrl);
  const targets = await fetchJson(cdpHttpUrl(base, "/json/list"), args.timeoutMs);
  const target = selectPageTarget(Array.isArray(targets) ? targets : []);
  if (!target) throw new Error(`No debuggable browser page target found at ${args.cdpUrl}`);

  const client = new CdpClient(target.webSocketDebuggerUrl, args.timeoutMs);
  await client.connect();
  try {
    await client.send("Network.enable");
    const result = await client.send("Network.getCookies", { urls: githubCookieUrls() });
    const selected = selectCookies(result.cookies ?? []);
    if (!selected.has("user_session")) {
      throw new Error("GitHub user_session cookie was not found in the selected browser target");
    }

    const header = cookieHeader(selected);
    const metadata = Array.from(selected.values())
      .map(cookieMetadata)
      .sort((left, right) => left.name.localeCompare(right.name));
    await fs.mkdir(path.dirname(args.output), { recursive: true });
    await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
    if (!dryRun) {
      await fs.mkdir(path.dirname(args.cookieFile), { recursive: true });
      await fs.writeFile(args.cookieFile, header, { mode: 0o600 });
      await fs.chmod(args.cookieFile, 0o600).catch(() => {});
    }

    const report = [
      "# GitHub Browser Cookie CDP Export",
      "",
      `- Result: \`${dryRun ? "dry-run" : "written"}\``,
      `- Source CDP URL: \`${args.cdpUrl}\``,
      `- Browser target URL: \`${target.url ?? ""}\``,
      `- Cookie file: \`${args.cookieFile}\``,
      "- Cookie values: `redacted`",
      "- Boundary: `connects to an already-running browser CDP endpoint; does not open a browser, log in, upload, or comment`",
      "",
      "## Exported Cookies",
      "",
      ...metadata.map(
        (cookie) =>
          `- \`${cookie.name}\`: domain \`${cookie.domain}\`, expires \`${cookie.expires}\`, httpOnly \`${
            cookie.httpOnly ? "yes" : "no"
          }\`, secure \`${cookie.secure ? "yes" : "no"}\`, length \`${cookie.length}\`, hash12 \`${cookie.hash12}\``,
      ),
      "",
    ].join("\n");

    await fs.writeFile(args.output, report);
    await fs.writeFile(
      args.jsonOutput,
      JSON.stringify(
        {
          result: dryRun ? "dry-run" : "written",
          generatedAt: new Date().toISOString(),
          cdpUrl: args.cdpUrl,
          target: { id: target.id, type: target.type, url: target.url, title: target.title },
          cookieFile: args.cookieFile,
          cookieNames: metadata.map((cookie) => cookie.name).sort(),
          cookies: metadata,
        },
        null,
        2,
      ),
    );
    console.log(
      `GitHub browser cookie CDP export ${dryRun ? "dry-run" : "wrote cookie file"}; wrote ${args.output}`,
    );
  } finally {
    client.close();
  }
}

main().catch(async (error) => {
  await fs.mkdir(path.dirname(args.output), { recursive: true }).catch(() => {});
  const message = error instanceof Error ? error.message : String(error);
  await fs
    .writeFile(
      args.output,
      [
        "# GitHub Browser Cookie CDP Export",
        "",
        "- Result: `failed`",
        `- Source CDP URL: \`${args.cdpUrl}\``,
        `- Failure: \`${message.replace(/`/g, "'")}\``,
        "- Cookie values: `not printed`",
        "",
      ].join("\n"),
    )
    .catch(() => {});
  console.error(`GitHub browser cookie CDP export failed: ${message}`);
  process.exit(1);
});
