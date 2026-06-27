#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const defaults = {
  repository: process.env.GITHUB_REPOSITORY ?? "",
  repositoryId: process.env.MINELINK_GITHUB_REPOSITORY_ID ?? "",
  filePath: process.env.MINELINK_ACCEPTANCE_VIDEO_PATH ?? ".minelink-dev/reports/artifacts/acceptance.mp4",
  name: process.env.MINELINK_GITHUB_ATTACHMENT_NAME ?? "acceptance.mp4",
  contentType: process.env.MINELINK_GITHUB_ATTACHMENT_CONTENT_TYPE ?? "",
  cookie: process.env.MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE ?? process.env.GITHUB_USER_ATTACHMENTS_COOKIE ?? "",
  cookieFile:
    process.env.MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE_FILE ??
    ".minelink-dev/secrets/github-user-attachments.cookie",
  token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "",
  referer: process.env.MINELINK_GITHUB_ATTACHMENT_REFERER ?? process.env.MINELINK_AGENT_FACTORY_PR_URL ?? "",
  authenticityToken: process.env.MINELINK_GITHUB_ATTACHMENT_AUTHENTICITY_TOKEN ?? "",
  uploadToken: process.env.MINELINK_GITHUB_ATTACHMENT_UPLOAD_TOKEN ?? "",
  fetchNonce: process.env.MINELINK_GITHUB_ATTACHMENT_FETCH_NONCE ?? "",
  clientVersion: process.env.MINELINK_GITHUB_CLIENT_VERSION ?? "",
  dynamicPageToken:
    process.env.MINELINK_GITHUB_ATTACHMENT_DYNAMIC_PAGE_TOKEN !== "0" &&
    process.env.MINELINK_GITHUB_ATTACHMENT_DYNAMIC_PAGE_TOKEN !== "false",
  chromePath: process.env.CHROME_PATH ?? process.env.MINELINK_GITHUB_ATTACHMENT_CHROME_PATH ?? "",
  chromePort: Number(process.env.MINELINK_GITHUB_ATTACHMENT_CHROME_PORT ?? 9233),
  chromeTimeoutMs: Number(process.env.MINELINK_GITHUB_ATTACHMENT_CHROME_TIMEOUT_MS ?? 45000),
  attempts: Number(process.env.MINELINK_GITHUB_ATTACHMENT_UPLOAD_ATTEMPTS ?? 3),
  retryDelayMs: Number(process.env.MINELINK_GITHUB_ATTACHMENT_RETRY_DELAY_MS ?? 1500),
  timeoutMs: Number(process.env.MINELINK_GITHUB_ATTACHMENT_TIMEOUT_MS ?? 30000),
  output: ".minelink-dev/reports/github-user-attachment-upload.md",
  jsonOutput: ".minelink-dev/reports/github-user-attachment-upload.json",
};

const args = { ...defaults };
let requireUpload = false;
let dryRun = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repository") args.repository = readValue();
  else if (arg === "--repository-id") args.repositoryId = readValue();
  else if (arg === "--file") args.filePath = readValue();
  else if (arg === "--name") args.name = readValue();
  else if (arg === "--content-type") args.contentType = readValue();
  else if (arg === "--cookie") args.cookie = readValue();
  else if (arg === "--cookie-file") args.cookieFile = readValue();
  else if (arg === "--token") args.token = readValue();
  else if (arg === "--referer") args.referer = readValue();
  else if (arg === "--authenticity-token") args.authenticityToken = readValue();
  else if (arg === "--upload-token") args.uploadToken = readValue();
  else if (arg === "--fetch-nonce") args.fetchNonce = readValue();
  else if (arg === "--client-version") args.clientVersion = readValue();
  else if (arg === "--dynamic-page-token") args.dynamicPageToken = true;
  else if (arg === "--no-dynamic-page-token") args.dynamicPageToken = false;
  else if (arg === "--chrome") args.chromePath = readValue();
  else if (arg === "--chrome-port") args.chromePort = Number(readValue());
  else if (arg === "--chrome-timeout-ms") args.chromeTimeoutMs = Number(readValue());
  else if (arg === "--attempts") args.attempts = Number(readValue());
  else if (arg === "--retry-delay-ms") args.retryDelayMs = Number(readValue());
  else if (arg === "--timeout-ms") args.timeoutMs = Number(readValue());
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--require-upload") requireUpload = true;
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/upload-github-user-attachment.mjs --repository owner/repo --file acceptance.mp4

Uploads a validated acceptance MP4 to GitHub's issue/PR user-attachments
storage so PR Markdown can render the MP4 as an inline GitHub video player.

This uses GitHub's web attachment flow, which currently requires a GitHub web
session cookie in MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE. PAT/GITHUB_TOKEN can
read the repository id, but cannot create user-attachments by itself. If the
cookie is missing and --require-upload is not set, the script writes a skipped
report and exits successfully so the downstream release gate can fail closed.

Reliability options:
  --referer URL         GitHub PR/issue page used for evidence context.
  --cookie-file FILE    Local ignored file containing the GitHub web attachment
                         cookie. Used only when the cookie env var is missing.
  --upload-token TOKEN  GitHub repository uploadToken override for policy upload.
  --dynamic-page-token  Render the PR page in temporary headless Chrome when
                         static HTML does not expose the upload-policy CSRF.
  --attempts N          Retry count for transient web/object-store failures.
  --retry-delay-ms N    Base retry delay in milliseconds.
  --timeout-ms N        Per-request timeout in milliseconds.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

const mimeByExt = {
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mov: "video/quicktime",
  mp4: "video/mp4",
  png: "image/png",
  webm: "video/webm",
};

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

function boundedNumber(value, fallback, min, max) {
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

args.attempts = boundedNumber(args.attempts, 3, 1, 8);
args.retryDelayMs = boundedNumber(args.retryDelayMs, 1500, 100, 30000);
args.timeoutMs = boundedNumber(args.timeoutMs, 30000, 1000, 120000);
args.chromePort = boundedNumber(args.chromePort, 9233, 1024, 65535);
args.chromeTimeoutMs = boundedNumber(args.chromeTimeoutMs, 45000, 5000, 180000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableHttpStatus(status) {
  return [408, 409, 423, 425, 429, 500, 502, 503, 504].includes(status);
}

function classifyFailure(message) {
  const text = String(message ?? "").toLowerCase();
  if (text.includes("not configured")) return "missing-github-web-cookie";
  if (text.includes("web cookie rejected") || text.includes("sign in to github")) return "github-web-cookie-rejected";
  if (text.includes("upload policy csrf missing")) return "github-attachment-upload-policy-csrf-missing";
  if (text.includes("uploadtoken missing")) return "github-attachment-upload-token-missing";
  if (text.includes("github-attachment-page-token")) return "github-attachment-page-token-failed";
  if (text.includes("policy request failed with http 401") || text.includes("policy request failed with http 403")) {
    return "github-web-cookie-rejected";
  }
  if (text.includes("policy request failed")) return "github-attachment-policy-failed";
  if (text.includes("object upload failed")) return "github-attachment-object-upload-failed";
  if (text.includes("finalization failed")) return "github-attachment-finalization-failed";
  if (text.includes("did not return asset.href")) return "github-attachment-missing-href";
  if (text.includes("repository id lookup failed")) return "github-repository-id-lookup-failed";
  return "unknown";
}

function cookieSignals(cookie) {
  const text = String(cookie ?? "");
  return {
    present: hasValue(text),
    hasLoggedIn: /(?:^|;\s*)logged_in=yes(?:;|$)/.test(text),
    hasDotcomUser: /(?:^|;\s*)dotcom_user=/.test(text),
    hasGhSess: /(?:^|;\s*)_gh_sess=/.test(text),
    hasUserSession: /(?:^|;\s*)user_session=/.test(text),
    hasHostUserSessionSameSite: /(?:^|;\s*)__Host-user_session_same_site=/.test(text),
  };
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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
  throw new Error("could not find Chrome/Chromium for dynamic upload-policy token discovery");
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${compact(text)}`);
  return JSON.parse(text);
}

async function waitForDebuggerUrl(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const body = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
    } catch {
      // Chrome may still be starting.
    }
    await sleep(500);
  }
  throw new Error("timed out waiting for Chrome DevTools Protocol");
}

async function cdpCall(ws, method, params = {}, sessionId = "") {
  const id = cdpCall.nextId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error(`CDP ${method} timed out`));
    }, Math.max(5000, Math.min(args.chromeTimeoutMs, 30000)));
    function onMessage(event) {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      ws.removeEventListener("message", onMessage);
      if (payload.error) reject(new Error(`CDP ${method} failed: ${payload.error.message}`));
      else resolve(payload.result ?? {});
    }
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
cdpCall.nextId = 1;

function cookiePairsForCdp() {
  return Array.from(cookieJar.entries())
    .filter(([name, value]) => hasValue(name) && hasValue(value))
    .map(([name, value]) => ({
      name,
      value,
      url: "https://github.com/",
      path: "/",
      secure: true,
      httpOnly: ["_gh_sess", "user_session", "__Host-user_session_same_site", "logged_in"].includes(name),
      sameSite: "Lax",
    }));
}

function isSignedOutGithubTitle(title) {
  return /sign in to github/i.test(String(title ?? ""));
}

async function discoverDynamicUploadTokens() {
  if (!args.dynamicPageToken || !hasValue(args.cookie) || !hasValue(args.referer)) return null;
  const chrome = await resolveChrome();
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "minelink-github-attachment-"));
  let browser = null;
  let ws = null;
  try {
    browser = spawn(
      chrome,
      [
        `--remote-debugging-port=${args.chromePort}`,
        `--user-data-dir=${profileDir}`,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-sandbox",
        "about:blank",
      ],
      { stdio: "ignore", detached: true },
    );
    const webSocketDebuggerUrl = await waitForDebuggerUrl(args.chromePort, args.chromeTimeoutMs);
    ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    const target = await cdpCall(ws, "Target.createTarget", { url: "about:blank" });
    const attached = await cdpCall(ws, "Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    const sessionId = attached.sessionId;
    await cdpCall(ws, "Page.enable", {}, sessionId);
    await cdpCall(ws, "Network.enable", {}, sessionId);
    const cookieSetResults = [];
    for (const cookie of cookiePairsForCdp()) {
      try {
        const result = await cdpCall(ws, "Network.setCookie", cookie, sessionId);
        cookieSetResults.push({ name: cookie.name, success: result.success !== false });
      } catch (error) {
        cookieSetResults.push({ name: cookie.name, success: false, error: compact(error?.message ?? error) });
      }
    }
    const cookieReadback = await cdpCall(
      ws,
      "Network.getCookies",
      { urls: ["https://github.com/", args.referer] },
      sessionId,
    ).catch(() => ({ cookies: [] }));
    report.pageTokenSignals.dynamicPageTokenCookieSetCount = cookieSetResults.filter((cookie) => cookie.success).length;
    report.pageTokenSignals.dynamicPageTokenCookieCount = Array.isArray(cookieReadback.cookies)
      ? cookieReadback.cookies.length
      : 0;
    report.pageTokenSignals.dynamicPageTokenHasUserSessionCookie = Array.isArray(cookieReadback.cookies)
      ? cookieReadback.cookies.some((cookie) => cookie.name === "user_session")
      : false;
    await cdpCall(ws, "Page.navigate", { url: args.referer }, sessionId);

    const startedAt = Date.now();
    let lastResult = null;
    while (Date.now() - startedAt < args.chromeTimeoutMs) {
      await sleep(500);
      const result = await cdpCall(
        ws,
        "Runtime.evaluate",
        {
          returnByValue: true,
          expression: `(() => {
            const policyToken = document.querySelector('file-attachment .js-data-upload-policy-url-csrf')?.getAttribute('value') || '';
            const fetchNonce = document.querySelector('[data-fetch-nonce]')?.getAttribute('data-fetch-nonce')
              || document.querySelector('meta[name="fetch-nonce"]')?.getAttribute('content') || '';
            const clientVersion = document.querySelector('meta[name="github-client-version"]')?.getAttribute('content') || '';
            const fileAttachment = document.querySelector('file-attachment');
            return {
              policyToken,
              fetchNonce,
              clientVersion,
              hasFileAttachment: Boolean(fileAttachment),
              readyState: document.readyState,
              url: location.href,
              title: document.title
            };
          })()`,
        },
        sessionId,
      );
      lastResult = result.result?.value ?? null;
      if (hasValue(lastResult?.policyToken)) return lastResult;
    }
    return lastResult;
  } finally {
    try {
      ws?.close();
    } catch {
      // Best effort.
    }
    if (browser) {
      try {
        process.kill(-browser.pid, "SIGTERM");
      } catch {
        try {
          browser.kill("SIGTERM");
        } catch {
          // Best effort.
        }
      }
    }
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

if (!hasValue(args.cookie) && hasValue(args.cookieFile)) {
  try {
    args.cookie = (await fs.readFile(args.cookieFile, "utf8")).trim();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const cookieJar = new Map(parseCookiePairs(args.cookie));
if (cookieJar.has("user_session") && !cookieJar.has("__Host-user_session_same_site")) {
  cookieJar.set("__Host-user_session_same_site", cookieJar.get("user_session"));
}
if (cookieJar.has("user_session") && !cookieJar.has("logged_in")) {
  cookieJar.set("logged_in", "yes");
}
args.cookie = Array.from(cookieJar.entries())
  .map(([key, value]) => `${key}=${value}`)
  .join("; ");

function updateCookieJar(response) {
  const headers = response?.headers;
  const setCookies =
    typeof headers?.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers?.get?.("set-cookie")].filter(Boolean);
  for (const header of setCookies) {
    for (const cookie of String(header ?? "").split(/,(?=\s*[^;,]+=)/)) {
      const first = cookie.split(";")[0]?.trim();
      const index = first?.indexOf("=") ?? -1;
      if (index > 0) {
        cookieJar.set(first.slice(0, index), first.slice(index + 1));
      }
    }
  }
  if (cookieJar.has("user_session") && !cookieJar.has("__Host-user_session_same_site")) {
    cookieJar.set("__Host-user_session_same_site", cookieJar.get("user_session"));
  }
}

function cookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function repositoryPageUrl() {
  if (!/^[^/\s]+\/[^/\s]+$/.test(args.repository)) return "https://github.com";
  return `https://github.com/${args.repository}`;
}

function contentTypeFor(fileName) {
  if (hasValue(args.contentType)) return args.contentType;
  const extension = String(fileName).split(".").pop()?.toLowerCase() ?? "";
  return mimeByExt[extension] ?? "application/octet-stream";
}

function githubHeaders(extra = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
  if (hasValue(args.token)) headers.Authorization = `Bearer ${args.token}`;
  return headers;
}

function webHeaders(extra = {}) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Origin: "https://github.com",
    Referer: args.referer || `https://github.com/${args.repository || ""}`,
    ...extra,
  };
  const cookies = cookieHeader();
  if (hasValue(cookies)) headers.Cookie = cookies;
  if (hasValue(args.fetchNonce)) headers["X-Fetch-Nonce"] = args.fetchNonce;
  if (hasValue(args.clientVersion)) headers["X-GitHub-Client-Version"] = args.clientVersion;
  return headers;
}

function objectStoreHeaders(extra = {}) {
  return {
    Origin: "https://github.com",
    ...extra,
  };
}

function toMultipart(values, file) {
  const boundary = `----MineLinkFormBoundary${randomBytes(12).toString("hex")}`;
  const chunks = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${String(value)}\r\n`));
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.fileName}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
    );
    chunks.push(file.buffer);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);
  return {
    body,
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.byteLength),
    },
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

function firstAttribute(tag, name) {
  const match = String(tag ?? "").match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function extractAuthenticityToken(html) {
  const inputTags = String(html ?? "").match(/<input\b[^>]*>/gi) ?? [];
  for (const tag of inputTags) {
    if (firstAttribute(tag, "name") === "authenticity_token") {
      const value = firstAttribute(tag, "value");
      if (hasValue(value)) return value;
    }
  }
  const metaTags = String(html ?? "").match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const name = firstAttribute(tag, "name") || firstAttribute(tag, "property");
    if (["csrf-token", "github-csrf-token"].includes(name)) {
      const content = firstAttribute(tag, "content");
      if (hasValue(content)) return content;
    }
  }
  return "";
}

function extractFetchNonce(html) {
  const patterns = [
    /\bdata-fetch-nonce=["']([^"']+)["']/i,
    /\bx-fetch-nonce=["']([^"']+)["']/i,
    /"fetchNonce"\s*:\s*"([^"]+)"/i,
    /<meta\b[^>]*name=["']fetch-nonce["'][^>]*content=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = String(html ?? "").match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
}

function extractClientVersion(html) {
  const patterns = [
    /\bx-github-client-version=["']([^"']+)["']/i,
    /"clientVersion"\s*:\s*"([^"]+)"/i,
    /<meta\b[^>]*name=["']github-client-version["'][^>]*content=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = String(html ?? "").match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
}

function extractUploadToken(html) {
  const patterns = [
    /"uploadToken"\s*:\s*"([^"]+)"/i,
    /\buploadToken["']?\s*[:=]\s*["']([^"']+)["']/i,
    /&quot;uploadToken&quot;\s*:\s*&quot;([^&]+)&quot;/i,
  ];
  for (const pattern of patterns) {
    const match = String(html ?? "").match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
}

function extractUploadPolicyCsrf(html) {
  const source = String(html ?? "");
  const policyWindows = [];
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const index = source.indexOf("/upload/policies/assets", searchFrom);
    if (index < 0) break;
    policyWindows.push(source.slice(Math.max(0, index - 5000), Math.min(source.length, index + 5000)));
    searchFrom = index + "/upload/policies/assets".length;
  }
  for (const block of policyWindows) {
    const inputs = block.match(/<input\b[^>]*>/gi) ?? [];
    let localFormToken = "";
    for (const input of inputs) {
      const className = firstAttribute(input, "class");
      const dataCsrf = firstAttribute(input, "data-csrf");
      const name = firstAttribute(input, "name");
      const value = firstAttribute(input, "value");
      if (!hasValue(value)) continue;
      if (dataCsrf === "true" || /\bjs-data-upload-policy-url-csrf\b/.test(className)) {
        return value;
      }
      if (!hasValue(localFormToken) && name === "authenticity_token") {
        localFormToken = value;
      }
    }
    if (hasValue(localFormToken)) return localFormToken;
  }

  const fileAttachmentBlocks = source.match(/<file-attachment\b[\s\S]*?<\/file-attachment>/gi) ?? [];
  for (const block of fileAttachmentBlocks) {
    if (!/data-upload-policy-url=["']\/upload\/policies\/assets["']/i.test(block)) continue;
    const inputs = block.match(/<input\b[^>]*>/gi) ?? [];
    for (const input of inputs) {
      const className = firstAttribute(input, "class");
      const dataCsrf = firstAttribute(input, "data-csrf");
      const value = firstAttribute(input, "value");
      if (
        hasValue(value) &&
        (dataCsrf === "true" || /\bjs-data-upload-policy-url-csrf\b/.test(className))
      ) {
        return value;
      }
    }
  }

  const patterns = [
    /data-upload-policy-url=["']\/upload\/policies\/assets["'][\s\S]{0,4000}?<input\b(?=[^>]*\bvalue=["']([^"']+)["'])(?=[^>]*(?:\bdata-csrf=["']true["']|\bjs-data-upload-policy-url-csrf\b))[^>]*>/i,
    /<input\b(?=[^>]*\bvalue=["']([^"']+)["'])(?=[^>]*(?:\bdata-csrf=["']true["']|\bjs-data-upload-policy-url-csrf\b))[^>]*>[\s\S]{0,4000}?data-upload-policy-url=["']\/upload\/policies\/assets["']/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
}

async function discoverTokensFromPage(label, url, { allowFormToken = false } = {}) {
  const { response, text } = await requestText(label, url, {
    headers: webHeaders({
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: url,
    }),
  });
  const uploadPolicyCsrf = extractUploadPolicyCsrf(text);
  const uploadToken = extractUploadToken(text);
  const authenticityToken = allowFormToken ? extractAuthenticityToken(text) : "";
  const fetchNonce = extractFetchNonce(text);
  const clientVersion = extractClientVersion(text);
  return {
    pageStatus: response.status,
    uploadPolicyCsrf,
    uploadToken,
    authenticityToken,
    fetchNonce,
    clientVersion,
  };
}

async function discoverPageUploadTokens() {
  if (!hasValue(args.cookie)) return;
  const tokenPages = [
    ...(hasValue(args.referer) ? [{ label: "github-attachment-page-token", url: args.referer }] : []),
    { label: "github-attachment-repository-token", url: repositoryPageUrl() },
  ];
  const pageResults = [];
  for (const page of tokenPages) {
    const tokens = await discoverTokensFromPage(page.label, page.url, { allowFormToken: true });
    pageResults.push({ url: page.url, ...tokens });
    if (hasValue(tokens.uploadPolicyCsrf)) {
      args.authenticityToken = tokens.uploadPolicyCsrf;
    }
    if (!hasValue(args.authenticityToken) && hasValue(tokens.authenticityToken)) {
      args.authenticityToken = tokens.authenticityToken;
    }
    if (!hasValue(args.uploadToken) && hasValue(tokens.uploadToken)) args.uploadToken = tokens.uploadToken;
    if (!hasValue(args.authenticityToken) && hasValue(args.uploadToken)) args.authenticityToken = args.uploadToken;
    if (!hasValue(args.fetchNonce)) args.fetchNonce = tokens.fetchNonce;
    if (!hasValue(args.clientVersion)) args.clientVersion = tokens.clientVersion;
    if (hasValue(args.authenticityToken)) break;
  }
  const selected = pageResults.find((page) => hasValue(page.uploadPolicyCsrf) || hasValue(page.uploadToken)) ?? pageResults.at(-1) ?? {};
  report.pageTokenSignals.tokenPage = selected.url ?? "";
  report.pageTokenSignals.checkedPages = pageResults.map((page) => ({
    url: page.url,
    status: page.pageStatus,
    hasUploadPolicyCsrf: hasValue(page.uploadPolicyCsrf),
    hasUploadToken: hasValue(page.uploadToken),
    hasAuthenticityToken: hasValue(page.authenticityToken),
    hasFetchNonce: hasValue(page.fetchNonce),
    hasClientVersion: hasValue(page.clientVersion),
  }));
  report.pageTokenSignals.pageStatus = selected.pageStatus ?? "";
  report.pageTokenSignals.hasUploadPolicyCsrf = pageResults.some((page) => hasValue(page.uploadPolicyCsrf));
  report.pageTokenSignals.hasUploadToken = pageResults.some((page) => hasValue(page.uploadToken)) || hasValue(args.uploadToken);
  report.pageTokenSignals.hasAuthenticityToken =
    pageResults.some((page) => hasValue(page.authenticityToken)) || hasValue(args.authenticityToken);
  report.pageTokenSignals.hasFetchNonce = hasValue(args.fetchNonce);
  report.pageTokenSignals.hasClientVersion = hasValue(args.clientVersion);

  if (!report.pageTokenSignals.hasUploadPolicyCsrf && args.dynamicPageToken) {
    try {
      const dynamicTokens = await discoverDynamicUploadTokens();
      report.pageTokenSignals.dynamicPageTokenAttempted = true;
      report.pageTokenSignals.dynamicPageTokenTitle = dynamicTokens?.title ?? "";
      report.pageTokenSignals.dynamicPageTokenUrl = dynamicTokens?.url ?? "";
      report.pageTokenSignals.dynamicPageTokenReadyState = dynamicTokens?.readyState ?? "";
      report.pageTokenSignals.dynamicPageTokenHasFileAttachment = dynamicTokens?.hasFileAttachment === true;
      report.pageTokenSignals.dynamicPageTokenHasUploadPolicyCsrf = hasValue(dynamicTokens?.policyToken);
      report.pageTokenSignals.dynamicPageTokenHasFetchNonce = hasValue(dynamicTokens?.fetchNonce);
      report.pageTokenSignals.dynamicPageTokenHasClientVersion = hasValue(dynamicTokens?.clientVersion);
      if (hasValue(dynamicTokens?.policyToken)) {
        args.authenticityToken = dynamicTokens.policyToken;
        if (!hasValue(args.fetchNonce)) args.fetchNonce = dynamicTokens.fetchNonce;
        if (!hasValue(args.clientVersion)) args.clientVersion = dynamicTokens.clientVersion;
      }
      if (!hasValue(args.authenticityToken) && isSignedOutGithubTitle(dynamicTokens?.title)) {
        throw new Error("GitHub web cookie rejected: dynamic PR page rendered Sign in to GitHub.");
      }
      report.pageTokenSignals.hasUploadPolicyCsrf =
        pageResults.some((page) => hasValue(page.uploadPolicyCsrf)) || hasValue(dynamicTokens?.policyToken);
      report.pageTokenSignals.hasFetchNonce = hasValue(args.fetchNonce);
      report.pageTokenSignals.hasClientVersion = hasValue(args.clientVersion);
    } catch (error) {
      report.pageTokenSignals.dynamicPageTokenAttempted = true;
      const message = compact(error?.message ?? error);
      report.pageTokenSignals.dynamicPageTokenError = message;
      if (classifyFailure(message) === "github-web-cookie-rejected") throw error;
    }
  }
}

async function readRepositoryId() {
  if (hasValue(args.repositoryId)) return args.repositoryId;
  if (!/^[^/\s]+\/[^/\s]+$/.test(args.repository)) {
    throw new Error("--repository must be owner/repo when --repository-id is omitted.");
  }
  const { response, text } = await requestText("github-repository-id", `https://api.github.com/repos/${args.repository}`, {
    headers: githubHeaders(),
  });
  if (!response.ok) {
    throw new Error(`GitHub repository id lookup failed with HTTP ${response.status}: ${compact(text)}`);
  }
  const body = JSON.parse(text);
  if (!hasValue(body?.id)) throw new Error("GitHub repository id lookup did not return id.");
  return String(body.id);
}

async function uploadPolicy(repositoryId, fileName, size, contentType) {
  if (!hasValue(args.authenticityToken)) {
    throw new Error("GitHub attachment upload policy CSRF missing; fetch the PR/issue page with a valid GitHub web session.");
  }
  const multipart = toMultipart({
    repository_id: repositoryId,
    name: fileName,
    size,
    content_type: contentType,
    ...(hasValue(args.authenticityToken) ? { authenticity_token: args.authenticityToken } : {}),
  });
  const { response, text } = await requestText("github-attachment-policy", "https://github.com/upload/policies/assets", {
    method: "POST",
    headers: webHeaders({
      Accept: "application/json",
      Referer: args.referer || repositoryPageUrl(),
      "X-Requested-With": "XMLHttpRequest",
      ...multipart.headers,
    }),
    body: multipart.body,
  });
  if (!response.ok) {
    throw new Error(`GitHub user-attachment policy request failed with HTTP ${response.status}: ${compact(text)}`);
  }
  return JSON.parse(text);
}

async function uploadToObjectStore(policy, fileBuffer, fileName, contentType) {
  const multipart = toMultipart(policy.form ?? {}, {
    fieldName: "file",
    fileName,
    contentType,
    buffer: fileBuffer,
  });
  const { response, text } = await requestText("github-attachment-object-upload", policy.upload_url, {
    method: "POST",
    headers: objectStoreHeaders({
      ...(policy.header ?? {}),
      ...multipart.headers,
    }),
    body: multipart.body,
  });
  if (!response.ok) {
    throw new Error(`GitHub user-attachment object upload failed with HTTP ${response.status}: ${compact(text)}`);
  }
}

async function finalizeUpload(policy) {
  const multipart = toMultipart({
    authenticity_token: policy.asset_upload_authenticity_token,
  });
  const { response, text } = await requestText(
    "github-attachment-finalization",
    new URL(policy.asset_upload_url, "https://github.com/").toString(),
    {
    method: "PUT",
    headers: webHeaders({
      Accept: "application/json",
      Referer: args.referer || repositoryPageUrl(),
      "X-Requested-With": "XMLHttpRequest",
      ...multipart.headers,
    }),
    body: multipart.body,
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub user-attachment finalization failed with HTTP ${response.status}: ${compact(text)}`);
  }
}

async function writeReports(report) {
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
  const lines = [
    "# GitHub User Attachment Upload",
    "",
    `Result: ${report.result}`,
    `File: ${report.filePath}`,
    `Name: ${report.name}`,
    `Content type: ${report.contentType || "missing"}`,
    `Size: ${report.size ?? "missing"}`,
    `SHA256: ${report.sha256 || "missing"}`,
    `Repository: ${report.repository || "missing"}`,
    `Repository id: ${report.repositoryId || "missing"}`,
    `Referer: ${report.referer || "missing"}`,
    `Attachment URL: ${report.href || "missing"}`,
    `Failure kind: ${report.failureKind || "none"}`,
    `Attempts: ${report.attempts.length}`,
    `Boundary: ${report.boundary}`,
    "",
    "## Cookie Signals",
    "",
    ...Object.entries(report.cookieSignals).map(([key, value]) => `- ${key}: \`${value ? "yes" : "no"}\``),
    "",
    "## Page Token Signals",
    "",
    ...Object.entries(report.pageTokenSignals).map(([key, value]) => `- ${key}: \`${value === "" ? "missing" : value}\``),
    "",
    "## Attempt Log",
    "",
    ...(report.attempts.length === 0
      ? ["- none"]
      : report.attempts.map(
          (attempt) =>
            `- ${attempt.phase} attempt ${attempt.attempt}: ${attempt.status} in ${attempt.durationMs}ms${attempt.retryable ? " (retryable)" : ""}${attempt.message ? ` - ${attempt.message}` : ""}`,
        )),
    "",
    "## Failures",
    "",
    ...(report.failures.length === 0 ? ["- none"] : report.failures.map((failure) => `- ${failure}`)),
    "",
  ];
  await fs.writeFile(args.output, `${lines.join("\n")}\n`, "utf8");
  await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (process.env.GITHUB_OUTPUT) {
    const outputs = [`result=${report.result}`];
    if (hasValue(report.href)) outputs.push(`video-url=${report.href}`);
    if (hasValue(report.id)) outputs.push(`asset-id=${report.id}`);
    await fs.appendFile(process.env.GITHUB_OUTPUT, `${outputs.join("\n")}\n`, "utf8");
  }
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function printUploadSummary(report, write = console.log) {
  const pageSignals = report.pageTokenSignals ?? {};
  const cookie = report.cookieSignals ?? {};
  write(
    `GitHub user attachment upload summary: result=${report.result} failureKind=${report.failureKind || "none"} attempts=${report.attempts.length}`,
  );
  write(
    [
      "GitHub user attachment cookie signals:",
      `present=${yesNo(cookie.present)}`,
      `loggedIn=${yesNo(cookie.hasLoggedIn)}`,
      `dotcomUser=${yesNo(cookie.hasDotcomUser)}`,
      `ghSess=${yesNo(cookie.hasGhSess)}`,
      `userSession=${yesNo(cookie.hasUserSession)}`,
      `hostUserSessionSameSite=${yesNo(cookie.hasHostUserSessionSameSite)}`,
    ].join(" "),
  );
  write(
    [
      "GitHub user attachment page-token signals:",
      `tokenPage=${pageSignals.tokenPage || "missing"}`,
      `pageStatus=${pageSignals.pageStatus || "missing"}`,
      `uploadPolicyCsrf=${yesNo(pageSignals.hasUploadPolicyCsrf)}`,
      `uploadToken=${yesNo(pageSignals.hasUploadToken)}`,
      `authenticityToken=${yesNo(pageSignals.hasAuthenticityToken)}`,
      `fetchNonce=${yesNo(pageSignals.hasFetchNonce)}`,
      `clientVersion=${yesNo(pageSignals.hasClientVersion)}`,
      `dynamicPageToken=${yesNo(pageSignals.dynamicPageTokenHasUploadPolicyCsrf)}`,
      `dynamicCookieSet=${pageSignals.dynamicPageTokenCookieSetCount ?? 0}`,
      `dynamicCookieReadback=${pageSignals.dynamicPageTokenCookieCount ?? 0}`,
      `dynamicUserSession=${yesNo(pageSignals.dynamicPageTokenHasUserSessionCookie)}`,
    ].join(" "),
  );
  const checkedPages = Array.isArray(pageSignals.checkedPages) ? pageSignals.checkedPages : [];
  if (checkedPages.length > 0) {
    for (const [index, page] of checkedPages.entries()) {
      write(
        [
          `GitHub user attachment checked page ${index + 1}:`,
          `status=${page.status || "missing"}`,
          `uploadPolicyCsrf=${yesNo(page.hasUploadPolicyCsrf)}`,
          `uploadToken=${yesNo(page.hasUploadToken)}`,
          `authenticityToken=${yesNo(page.hasAuthenticityToken)}`,
          `fetchNonce=${yesNo(page.hasFetchNonce)}`,
          `clientVersion=${yesNo(page.hasClientVersion)}`,
        ].join(" "),
      );
    }
  }
  if (report.attempts.length > 0) {
    write(
      `GitHub user attachment HTTP attempts: ${report.attempts
        .map((attempt) => `${attempt.phase}:${attempt.status}`)
        .join(", ")}`,
    );
  }
}

async function requestText(phase, url, options) {
  let lastError = null;
  for (let attempt = 1; attempt <= args.attempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(args.timeoutMs),
      });
      const text = await response.text();
      const retryable = !response.ok && retryableHttpStatus(response.status) && attempt < args.attempts;
      report.attempts.push({
        phase,
        attempt,
        status: response.status,
        durationMs: Date.now() - startedAt,
        retryable,
        message: response.ok ? "" : compact(text),
      });
      if (!retryable) return { response, text };
      await sleep(args.retryDelayMs * attempt);
    } catch (error) {
      const message = compact(error?.message ?? error);
      const retryable = attempt < args.attempts;
      lastError = new Error(`${phase} request failed: ${message}`);
      report.attempts.push({
        phase,
        attempt,
        status: "network-error",
        durationMs: Date.now() - startedAt,
        retryable,
        message,
      });
      if (!retryable) break;
      await sleep(args.retryDelayMs * attempt);
    }
  }
  throw lastError ?? new Error(`${phase} request failed`);
}

const report = {
  createdAt: new Date().toISOString(),
  result: "pending",
  repository: args.repository || "none",
  repositoryId: args.repositoryId || "",
  filePath: args.filePath,
  name: args.name,
  contentType: "",
  size: 0,
  sha256: "",
  id: "",
  href: "",
  asset: null,
  failureKind: "",
  cookieSignals: cookieSignals(args.cookie),
  pageTokenSignals: {
    refererConfigured: hasValue(args.referer),
    tokenPage: "",
    checkedPages: [],
    pageStatus: "",
    hasUploadPolicyCsrf: false,
    hasUploadToken: hasValue(args.authenticityToken) || hasValue(args.uploadToken),
    hasAuthenticityToken: hasValue(args.authenticityToken),
    hasFetchNonce: hasValue(args.fetchNonce),
    hasClientVersion: hasValue(args.clientVersion),
    dynamicPageTokenEnabled: args.dynamicPageToken,
    dynamicPageTokenAttempted: false,
    dynamicPageTokenCookieSetCount: 0,
    dynamicPageTokenCookieCount: 0,
    dynamicPageTokenHasUserSessionCookie: false,
    dynamicPageTokenHasFileAttachment: false,
    dynamicPageTokenHasUploadPolicyCsrf: false,
    dynamicPageTokenHasFetchNonce: false,
    dynamicPageTokenHasClientVersion: false,
    dynamicPageTokenUrl: "",
    dynamicPageTokenReadyState: "",
    dynamicPageTokenTitle: "",
    dynamicPageTokenError: "",
  },
  referer: args.referer || "",
  attempts: [],
  failures: [],
  boundary:
    "GitHub user-attachments transport only; release still requires Ona finalizer video, same-session Codex verifier, and check-video-review gate",
};

try {
  if (!hasValue(args.cookie)) {
    report.result = "skipped";
    report.failureKind = "missing-github-web-cookie";
    report.failures.push(
      "MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE is not configured; cannot create a GitHub inline video attachment.",
    );
    if (requireUpload) throw new Error(report.failures[0]);
    await writeReports(report);
    printUploadSummary(report);
    console.log(`GitHub user attachment upload skipped; wrote ${args.output}`);
    process.exit(0);
  }

  const signals = report.cookieSignals;
  if (!signals.hasUserSession && !signals.hasHostUserSessionSameSite) {
    report.failures.push(
      "MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE is present but does not include common GitHub web session markers; upload may fail if the cookie is incomplete.",
    );
  }

  const buffer = await fs.readFile(args.filePath);
  report.size = buffer.byteLength;
  report.sha256 = createHash("sha256").update(buffer).digest("hex");
  report.contentType = contentTypeFor(args.name || path.basename(args.filePath));

  if (dryRun) {
    report.result = "dry-run";
    report.repositoryId = args.repositoryId || "dry-run";
    await writeReports(report);
    printUploadSummary(report);
    console.log(`GitHub user attachment upload dry-run passed; wrote ${args.output}`);
    process.exit(0);
  }

  const repositoryId = await readRepositoryId();
  report.repositoryId = repositoryId;
  const fileName = args.name || path.basename(args.filePath);

  await discoverPageUploadTokens();
  const policy = await uploadPolicy(repositoryId, fileName, buffer.byteLength, report.contentType);
  await uploadToObjectStore(policy, buffer, fileName, report.contentType);
  await finalizeUpload(policy);

  report.asset = policy.asset ?? null;
  report.id = String(policy.asset?.id ?? "");
  report.href = policy.asset?.href ?? "";
  if (!hasValue(report.href)) throw new Error("GitHub user-attachment upload did not return asset.href.");
  report.result = "passed";
  await writeReports(report);
  printUploadSummary(report);
  console.log(`GitHub user attachment upload passed; wrote ${args.output}`);
} catch (error) {
  report.result = "blocked";
  const message = compact(error?.message ?? error);
  report.failureKind = classifyFailure(message);
  report.failures.push(message);
  await writeReports(report);
  printUploadSummary(report, console.error);
  console.error(`GitHub user attachment upload blocked; wrote ${args.output}`);
  process.exit(1);
}
