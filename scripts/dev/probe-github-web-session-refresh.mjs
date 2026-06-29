#!/usr/bin/env node
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
  cookie: firstNonEmpty(
    process.env.MINELINK_GITHUB_USER_SESSION,
    process.env.GH_SESSION_TOKEN,
  ),
  cookieFile:
    process.env.MINELINK_GITHUB_USER_SESSION_FILE ??
    ".minelink-dev/secrets/github-user-session.cookie",
  timeoutMs: Number(process.env.MINELINK_GITHUB_COOKIE_PROBE_TIMEOUT_MS ?? 30000),
  output: ".minelink-dev/reports/github-web-cookie-refresh-deep-probe.md",
  jsonOutput: ".minelink-dev/reports/github-web-cookie-refresh-deep-probe.json",
};

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repository") args.repository = readValue();
  else if (arg === "--pr") args.pr = readValue();
  else if (arg === "--cookie") args.cookie = readValue();
  else if (arg === "--cookie-file") args.cookieFile = readValue();
  else if (arg === "--timeout-ms") args.timeoutMs = Number(readValue());
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/probe-github-web-session-refresh.mjs --repository owner/repo --pr N

Runs a redacted, script-only probe for GitHub Web session-cookie rolling.
It does not upload files, comment on PRs, submit account-changing forms, open a
browser, or print cookie values. It tests authenticated page GETs, current PR
read-only async endpoints, the shared websocket /_alive refresh path, and
saved_user_sessions-only negative controls.`);
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

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function redactUrl(value) {
  return String(value ?? "")
    .replace(/([?&](?:authenticity_token|csrf|token|session|gid|href|textarea_id|oid|after_cursor|before_cursor)=)[^&]+/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9_-]{80,}/g, "[redacted]");
}

function pageTitle(html) {
  const match = String(html ?? "").match(/<title>\s*([\s\S]*?)\s*<\/title>/i);
  return match ? decodeHtml(match[1]).replace(/\s+/g, " ").trim() : "";
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
  return Array.from(cookieJar.entries())
    .filter(([name, value]) => hasValue(name) && hasValue(value))
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function normalizeCookieJar(cookieJar) {
  if (cookieJar.has("user_session") && !cookieJar.has("__Host-user_session_same_site")) {
    cookieJar.set("__Host-user_session_same_site", cookieJar.get("user_session"));
  }
  if (cookieJar.has("user_session") && !cookieJar.has("logged_in")) {
    cookieJar.set("logged_in", "yes");
  }
}

function cookieNames(cookieJar) {
  return Array.from(cookieJar.keys()).sort();
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
    hasSavedUserSessions: /(?:^|;\s*)saved_user_sessions=/.test(text),
  };
}

function updateCookieJar(cookieJar, response) {
  const setCookies =
    typeof response?.headers?.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response?.headers?.get?.("set-cookie")].filter(Boolean);
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
  normalizeCookieJar(cookieJar);
  return names;
}

async function readCookieSource() {
  if (hasValue(args.cookie)) return args.cookie.trim();
  try {
    return (await fs.readFile(args.cookieFile, "utf8")).trim();
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function attr(tag, name) {
  const match = String(tag ?? "").match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function sharedWebSocketRefreshUrl(html, pageUrl) {
  const links = String(html ?? "").match(/<link\b[^>]*>/gi) ?? [];
  for (const link of links) {
    if (!/\brel=["'][^"']*\bshared-web-socket\b/i.test(link)) continue;
    const refreshUrl = attr(link, "data-refresh-url");
    if (hasValue(refreshUrl)) return new URL(refreshUrl, pageUrl).toString();
  }
  return "";
}

function pageUrls(html, pageUrl) {
  const values = [];
  const source = String(html ?? "");
  for (const match of source.matchAll(/\b(?:href|src|action|data-[\w-]*url|data-url|data-refresh-url|data-pjax-url|data-target-url|data-src)=(['"])(.*?)\1/gi)) {
    const value = decodeHtml(match[2]);
    if (!value || /^(javascript:|mailto:|#)/i.test(value)) continue;
    try {
      const url = new URL(value, pageUrl);
      if (url.host === "github.com") values.push(url.toString());
    } catch {
      // ignore malformed page state
    }
  }
  return [...new Set(values)];
}

function pickReadOnlyAsyncUrls(urls) {
  const patterns = [
    ["notifications-shelf", /\/notifications\/beta\/shelf/],
    ["body-partial", /\/pull\/\d+\/partials\/body/],
    ["hovercard", /\/hovercard/],
    ["actions-menu", /actions_menu/],
    ["edit-form", /edit_form/],
    ["timeline-more", /timeline_more_items/],
    ["commit-status-icon", /commit_status_icon/],
    ["checks-statuses-rollups", /checks-statuses-rollups/],
    ["comment-partial", /partials\/timeline_issue_comment/],
    ["in-product-messaging", /in-product-messaging/],
    ["sudo-modal", /\/sessions\/sudo_modal/],
  ];
  const selected = [];
  for (const [name, pattern] of patterns) {
    const url = urls.find((candidate) => pattern.test(candidate));
    if (url) selected.push({ name, url, method: "GET" });
  }
  return selected;
}

async function probeRequest({ name, url, method = "GET", cookieJar, referer, savedOnly = false }) {
  const startedAt = Date.now();
  const isPost = method.toUpperCase() !== "GET";
  const isAsyncProbe =
    isPost ||
    /\/(?:notifications\/beta\/shelf|partials\/|hovercard|actions_menu|edit_form|timeline_more_items|sessions\/sudo_modal|in-product-messaging|commits\/checks-statuses-rollups)/.test(
      new URL(url).pathname,
    );
  const headers = {
    Accept: name === "alive-websocket-refresh" ? "text/plain, */*; q=0.01" : "text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8",
    Cookie: cookieHeaderFromJar(cookieJar),
    Referer: referer,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  };
  if (isAsyncProbe) {
    headers["GitHub-Verified-Fetch"] = "true";
    headers["X-Requested-With"] = "XMLHttpRequest";
  }
  if (isPost) {
    headers.Origin = "https://github.com";
  }
  const response = await fetch(url, {
    method,
    redirect: "manual",
    headers,
    signal: AbortSignal.timeout(args.timeoutMs),
  });
  const setCookieNames = updateCookieJar(cookieJar, response);
  const text = await response.text().catch(() => "");
  return {
    name,
    method,
    url: redactUrl(url),
    status: response.status,
    location: redactUrl(response.headers.get("location") ?? ""),
    contentType: response.headers.get("content-type") ?? "",
    signedOut: isSignedOutGithubHtml(text),
    title: pageTitle(text),
    bodyShape: text.startsWith("wss://")
      ? "wss-url"
      : text
          .slice(0, 80)
          .replace(/\s+/g, " ")
          .trim(),
    setCookieNames,
    userSessionSetCookie: setCookieNames.some((cookieName) => cookieName === "user_session" || cookieName === "__Host-user_session_same_site"),
    savedOnly,
    durationMs: Date.now() - startedAt,
  };
}

function withoutActiveSession(cookieJar) {
  const clone = new Map(cookieJar);
  for (const name of ["user_session", "__Host-user_session_same_site", "_gh_sess"]) clone.delete(name);
  return clone;
}

async function writeReport(report) {
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
  const lines = [
    "# GitHub Web Session Refresh Deep Probe",
    "",
    `- Generated: \`${report.generated}\``,
    `- Repository: \`${report.repository}\``,
    `- PR: \`${report.pr || "none"}\``,
    `- Cookie file: \`${args.cookieFile || "none"}\``,
    `- Boundary: \`${report.boundary}\``,
    `- Initial cookie names: ${report.initialCookieNames.map((name) => `\`${name}\``).join(", ") || "none"}`,
    `- Final cookie names: ${report.finalCookieNames.map((name) => `\`${name}\``).join(", ") || "none"}`,
    `- Any user_session Set-Cookie observed: \`${report.anyUserSessionSetCookie ? "yes" : "no"}\``,
    "",
    "## Initial Cookie Signals",
    "",
    ...Object.entries(report.initialCookieSignals).map(([key, value]) => `- ${key}: \`${value ? "yes" : "no"}\``),
    "",
    "## Probes",
    "",
    ...report.probes.map(
      (probe) =>
        `- ${probe.name}: ${probe.method} ${probe.url} -> status \`${probe.status}\`, signedOut \`${probe.signedOut ? "yes" : "no"}\`, setCookie \`${probe.setCookieNames.length ? probe.setCookieNames.join(",") : "none"}\`, userSessionSetCookie \`${probe.userSessionSetCookie ? "yes" : "no"}\`, title \`${probe.title || probe.bodyShape || "none"}\``,
    ),
    "",
    "## Conclusion",
    "",
    report.anyUserSessionSetCookie
      ? "- At least one probe observed a user_session Set-Cookie; inspect JSON before relying on this path."
      : "- No probe observed user_session or __Host-user_session_same_site Set-Cookie. Observed rolling remains limited to _gh_sess in this run.",
    "",
  ];
  await fs.writeFile(args.output, `${lines.join("\n")}\n`, "utf8");
  await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

const report = {
  generated: new Date().toISOString(),
  repository: args.repository,
  pr: args.pr,
  boundary:
    "redacted script-only probe; no browser, no upload/comment, no account-changing form submission, cookie values never printed",
  initialCookieNames: [],
  finalCookieNames: [],
  initialCookieSignals: cookieSignals(""),
  probes: [],
  anyUserSessionSetCookie: false,
};

try {
  if (!/^[^/\s]+\/[^/\s]+$/.test(args.repository)) {
    throw new Error("--repository owner/repo is required.");
  }
  if (!/^\d+$/.test(String(args.pr))) {
    throw new Error("--pr N is required.");
  }
  const cookieSource = await readCookieSource();
  if (!hasValue(cookieSource)) {
    throw new Error("GitHub web cookie is missing; provide --cookie or --cookie-file.");
  }
  const cookieJar = new Map(parseCookiePairs(cookieSource));
  normalizeCookieJar(cookieJar);
  report.initialCookieNames = cookieNames(cookieJar);
  report.initialCookieSignals = cookieSignals(cookieHeaderFromJar(cookieJar));

  const pageUrl = `https://github.com/${args.repository}/pull/${args.pr}`;
  const pageProbe = await probeRequest({ name: "page-validation", url: pageUrl, cookieJar, referer: pageUrl });
  report.probes.push(pageProbe);
  let html = "";
  if (pageProbe.status >= 200 && pageProbe.status < 300 && !pageProbe.signedOut) {
    html = await fetch(pageUrl, {
      headers: {
        Accept: "text/html",
        Cookie: cookieHeaderFromJar(cookieJar),
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(args.timeoutMs),
    }).then((response) => response.text());
    const aliveUrl = sharedWebSocketRefreshUrl(html, pageUrl);
    if (aliveUrl) {
      report.probes.push(
        await probeRequest({ name: "alive-websocket-refresh", url: aliveUrl, method: "POST", cookieJar, referer: pageUrl }),
      );
    }
    const readOnlyUrls = pickReadOnlyAsyncUrls(pageUrls(html, pageUrl));
    for (const probe of readOnlyUrls) {
      report.probes.push(await probeRequest({ ...probe, cookieJar, referer: pageUrl }));
    }
  }

  for (const url of [
    "https://github.com/settings/profile",
    "https://github.com/settings/security",
    "https://github.com/settings/sessions",
    "https://github.com/notifications",
    "https://github.com/sessions/trusted-device?return_to=%2Fsettings%2Fsecurity",
  ]) {
    report.probes.push(await probeRequest({ name: new URL(url).pathname, url, cookieJar, referer: pageUrl }));
  }

  const savedOnlyJar = withoutActiveSession(cookieJar);
  for (const url of ["https://github.com/login", "https://github.com/settings/profile"]) {
    report.probes.push(await probeRequest({ name: `saved-only-${new URL(url).pathname}`, url, cookieJar: savedOnlyJar, referer: pageUrl, savedOnly: true }));
  }

  report.finalCookieNames = cookieNames(cookieJar);
  report.anyUserSessionSetCookie = report.probes.some((probe) => probe.userSessionSetCookie);
  await writeReport(report);
  console.log(`GitHub web session refresh deep probe wrote ${args.output}`);
} catch (error) {
  report.probes.push({
    name: "probe-error",
    method: "n/a",
    url: "n/a",
    status: 0,
    location: "",
    contentType: "",
    signedOut: false,
    title: String(error?.message ?? error),
    bodyShape: "",
    setCookieNames: [],
    userSessionSetCookie: false,
    savedOnly: false,
    durationMs: 0,
  });
  await writeReport(report);
  console.error(`GitHub web session refresh deep probe failed; wrote ${args.output}`);
  process.exit(1);
}
