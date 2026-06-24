#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const defaults = {
  apiBase: process.env.MINELINK_ONA_API_BASE ?? "https://app.gitpod.io/api",
  apiSession: ".minelink-dev/reports/ona-platform-codex-api-session.json",
  outputDir: ".minelink-dev/reports/ona-platform-codex-readback",
  output: ".minelink-dev/reports/ona-platform-codex-readback.md",
  jsonOutput: ".minelink-dev/reports/ona-platform-codex-readback.json",
  maxBytes: Number(process.env.MINELINK_ONA_READBACK_MAX_BYTES ?? 2_000_000),
};

const args = { ...defaults };

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--api-base") args.apiBase = readValue();
  else if (arg === "--api-session") args.apiSession = readValue();
  else if (arg === "--output-dir") args.outputDir = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--max-bytes") args.maxBytes = Number(readValue());
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/fetch-ona-agent-execution-readback.mjs

Fetches Ona Platform Codex conversation/transcript URLs from
.minelink-dev/reports/ona-platform-codex-api-session.json and writes sanitized
diagnostic artifacts. This is failure analysis only; it is not task acceptance
evidence.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

function hasValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.length > 0 && !["none", "null", "undefined", "-"].includes(normalized);
}

function token() {
  return process.env.GITPOD_API_KEY || process.env.ONA_TOKEN || "";
}

function methodUrl(method) {
  return `${args.apiBase.replace(/\/+$/u, "")}/${method}`;
}

async function post(method, body) {
  const bearer = token();
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
    const error = new Error(`${method} failed with HTTP ${response.status}: ${sanitize(text)}`);
    error.status = response.status;
    error.body = json;
    throw error;
  }
  return json;
}

async function createConversationToken(agentExecutionId) {
  if (!hasValue(agentExecutionId) || !hasValue(token())) return "";
  const response = await post("gitpod.v1.AgentService/CreateAgentExecutionConversationToken", {
    agentExecutionId,
  });
  return response.token ?? "";
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function urlEntries(apiSession) {
  const status = apiSession?.readback?.agentExecution?.status ?? {};
  const urls = status.conversationUrls ?? {};
  return [
    ["conversation", status.conversationUrl],
    ["transcript", status.transcriptUrl],
    ["history", urls.history],
    ["live", urls.live],
  ].filter(([, url]) => hasValue(url));
}

function sanitize(text) {
  return String(text ?? "")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_[REDACTED]")
    .replace(/ghp_[A-Za-z0-9_]+/g, "ghp_[REDACTED]")
    .replace(/lin_api_[A-Za-z0-9]+/g, "lin_api_[REDACTED]")
    .replace(/cfat_[A-Za-z0-9_-]+/g, "cfat_[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(secret(access)?key["'\s:=]+)[A-Za-z0-9/+_=.-]+/gi, "$1[REDACTED]")
    .replace(/(access[-_]?key[-_]?id["'\s:=]+)[A-Za-z0-9/+_=.-]+/gi, "$1[REDACTED]");
}

function extFromContentType(contentType) {
  if (/json/i.test(contentType)) return ".json";
  if (/html/i.test(contentType)) return ".html";
  return ".txt";
}

function withQueryToken(urlValue, key, bearer) {
  const url = new URL(urlValue);
  url.searchParams.set(key, bearer);
  return url.toString();
}

async function fetchUrlWithAuth(label, urlValue, authMode, bearer) {
  const options = {};
  let requestUrl = urlValue;
  if (authMode === "conversation-bearer" || authMode === "ona-bearer") {
    options.headers = { Authorization: `Bearer ${bearer}` };
  } else if (authMode === "token-query") {
    requestUrl = withQueryToken(urlValue, "token", bearer);
  } else if (authMode === "access-token-query") {
    requestUrl = withQueryToken(urlValue, "access_token", bearer);
  }
  const response = await fetch(requestUrl, options);
  const contentType = response.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await response.arrayBuffer());
  const truncated = buffer.length > args.maxBytes;
  const body = sanitize(buffer.subarray(0, Math.max(0, args.maxBytes)).toString("utf8"));
  const fileName = `${label}${extFromContentType(contentType)}`;
  const filePath = path.join(args.outputDir, fileName);
  await fs.writeFile(filePath, body, "utf8");
  return {
    label,
    url: urlValue,
    authMode,
    status: response.status,
    ok: response.ok,
    contentType,
    bytes: buffer.length,
    truncated,
    path: filePath,
  };
}

async function fetchUrl(label, urlValue, conversationToken) {
  const authAttempts = [];
  if (hasValue(conversationToken)) {
    authAttempts.push(["conversation-bearer", conversationToken]);
    authAttempts.push(["token-query", conversationToken]);
    authAttempts.push(["access-token-query", conversationToken]);
  }
  if (hasValue(token())) authAttempts.push(["ona-bearer", token()]);
  let latest = null;
  for (const [authMode, bearer] of authAttempts) {
    latest = await fetchUrlWithAuth(label, urlValue, authMode, bearer);
    if (latest.ok) return latest;
  }
  return latest ?? {
    label,
    url: urlValue,
    ok: false,
    error: "No usable auth mode was available for conversation readback.",
  };
}

await fs.mkdir(args.outputDir, { recursive: true });
await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });

const apiSession = await readJson(args.apiSession);
const entries = urlEntries(apiSession);
const report = {
  generatedAt: new Date().toISOString(),
  result: "blocked",
  apiSession: args.apiSession,
  agentExecutionId: apiSession?.agentExecutionId ?? "",
  environmentId: apiSession?.environmentId ?? "",
  readbackPhase: apiSession?.readbackPhase ?? apiSession?.readback?.agentExecution?.status?.phase ?? "",
  tokenPresent: hasValue(token()),
  conversationTokenPresent: false,
  entries: [],
  blockers: [],
  boundary:
    "Ona Platform Codex transcript/history diagnostics only. This is not task implementation, video, verifier, or product acceptance evidence.",
};

if (!apiSession) {
  report.blockers.push(`Missing or invalid API session JSON: ${args.apiSession}`);
} else if (entries.length === 0) {
  report.blockers.push("API session did not expose conversation, transcript, history, or live URLs.");
} else if (!hasValue(token())) {
  report.blockers.push("Missing ONA_TOKEN or GITPOD_API_KEY for authenticated readback fetch.");
} else {
  let conversationToken = "";
  try {
    conversationToken = await createConversationToken(report.agentExecutionId);
    report.conversationTokenPresent = hasValue(conversationToken);
  } catch (error) {
    report.blockers.push(`CreateAgentExecutionConversationToken failed: ${sanitize(error.message)}`);
  }
  for (const [label, urlValue] of entries) {
    try {
      report.entries.push(await fetchUrl(label, urlValue, conversationToken));
    } catch (error) {
      report.entries.push({
        label,
        url: urlValue,
        ok: false,
        error: sanitize(error.message),
      });
    }
  }
  if (report.entries.some((entry) => entry.ok)) report.result = "passed";
  else report.blockers.push("No conversation readback URL fetched successfully.");
}

const lines = [
  "# Ona Platform Codex Readback Diagnostics",
  "",
  `- Generated: \`${report.generatedAt}\``,
  `- Result: \`${report.result}\``,
  `- Agent execution id: \`${report.agentExecutionId || "missing"}\``,
  `- Environment id: \`${report.environmentId || "missing"}\``,
  `- Readback phase: \`${report.readbackPhase || "missing"}\``,
  `- Token present: \`${report.tokenPresent ? "yes" : "no"}\``,
  `- Conversation token created: \`${report.conversationTokenPresent ? "yes" : "no"}\``,
  `- Boundary: \`${report.boundary}\``,
  "",
  "## Entries",
  "",
  ...(report.entries.length > 0
    ? report.entries.map(
        (entry) =>
          `- ${entry.label}: ok=\`${entry.ok ? "yes" : "no"}\`, auth=\`${entry.authMode ?? "none"}\`, status=\`${entry.status ?? "missing"}\`, bytes=\`${entry.bytes ?? "missing"}\`, path=\`${entry.path ?? "none"}\``,
      )
    : ["- none"]),
  "",
  "## Blockers",
  "",
  ...(report.blockers.length > 0 ? report.blockers.map((item) => `- ${item}`) : ["- none"]),
];

await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(args.output, `${lines.join("\n")}\n`, "utf8");

console.log(`Ona Platform Codex readback diagnostics ${report.result}; wrote ${args.output}`);
