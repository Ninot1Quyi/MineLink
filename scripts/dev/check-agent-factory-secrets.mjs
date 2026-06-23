#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = {
  repo: process.env.GITHUB_REPOSITORY ?? "",
  output: ".minelink-dev/reports/agent-factory-secrets.md",
  jsonOutput: ".minelink-dev/reports/agent-factory-secrets.json",
  githubAttachmentUrl: process.env.MINELINK_GITHUB_ATTACHMENT_VIDEO_URL ?? "",
};

let requireGithubSecrets = false;
let requireOnaContext = false;
let requireLinearEnv = false;
let requireGithubAttachmentCookie = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repo") args.repo = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--github-attachment-url") args.githubAttachmentUrl = readValue();
  else if (arg === "--require-github-secrets") requireGithubSecrets = true;
  else if (arg === "--require-ona-context") requireOnaContext = true;
  else if (arg === "--require-linear-env") requireLinearEnv = true;
  else if (arg === "--require-github-attachment-cookie") requireGithubAttachmentCookie = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/check-agent-factory-secrets.mjs [options]

Checks only the presence and usability of credentials needed by the MineLink
agent factory. It never prints secret values.

Options:
  --repo owner/name              GitHub repository to inspect.
  --github-attachment-url url    Existing GitHub user-attachments MP4 URL, if manually provided.
  --require-github-secrets       Fail if ONA_TOKEN, LINEAR_API_KEY, or AGENT_FACTORY_GITHUB_TOKEN is missing.
  --require-ona-context          Fail if local/runner Ona CLI has no active context.
  --require-linear-env           Fail if LINEAR_API_KEY is not present in the current environment.
  --require-github-attachment-cookie
                                  Fail if final PR video publication lacks both a GitHub web attachment cookie and a provided attachment URL.
`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: "pipe",
  });
}

function sanitize(text) {
  return String(text ?? "")
    .replace(/(lin_api_)[A-Za-z0-9]+/g, "$1[redacted]")
    .replace(/(github_pat_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(ghp_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(sk-[A-Za-z0-9_-]+)/g, "[redacted]")
    .slice(0, 1200)
    .trim();
}

function inferRepo() {
  if (args.repo) return args.repo;
  const remote = run("git", ["remote", "get-url", "origin"]);
  if (remote.status !== 0) return "";
  const value = remote.stdout.trim();
  const match = value.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
  return match?.[1] ?? "";
}

function parseSecretNames(output) {
  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean),
  );
}

function githubInlineAttachment(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "github.com" && parsed.pathname.startsWith("/user-attachments/assets/")) return true;
    if (parsed.hostname === "user-images.githubusercontent.com") return true;
  } catch {
    return false;
  }
  return false;
}

const repo = inferRepo();
const env = {
  onaTokenPresent: Boolean(process.env.ONA_TOKEN || process.env.GITPOD_TOKEN),
  linearKeyPresent: Boolean(process.env.LINEAR_API_KEY),
  agentFactoryGithubTokenPresent: Boolean(process.env.AGENT_FACTORY_GITHUB_TOKEN),
  ghTokenPresent: Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN),
  githubUserAttachmentsCookiePresent: Boolean(
    process.env.MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE || process.env.GITHUB_USER_ATTACHMENTS_COOKIE,
  ),
  githubActions: Boolean(process.env.GITHUB_ACTIONS),
};

const checks = [];
const blockers = [];

function record(name, status, evidence, blocker = "") {
  checks.push({ name, status, evidence, blocker });
  if (blocker) blockers.push(blocker);
}

record(
  "current ONA_TOKEN/GITPOD_TOKEN",
  env.onaTokenPresent ? "present" : "missing",
  env.onaTokenPresent ? "environment variable is present" : "environment variable is missing",
  "",
);
record(
  "current LINEAR_API_KEY",
  env.linearKeyPresent ? "present" : "missing",
  env.linearKeyPresent ? "environment variable is present" : "environment variable is missing",
  requireLinearEnv && !env.linearKeyPresent
    ? "LINEAR_API_KEY is required in the current environment for Linear watcher/status sync."
    : "",
);
record(
  "current AGENT_FACTORY_GITHUB_TOKEN",
  env.agentFactoryGithubTokenPresent ? "present" : "missing",
  env.agentFactoryGithubTokenPresent
    ? "environment variable is present"
    : "environment variable is missing",
  "",
);
record(
  "current MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE",
  env.githubUserAttachmentsCookiePresent ? "present" : "missing",
  env.githubUserAttachmentsCookiePresent
    ? "environment variable is present"
    : "environment variable is missing",
  "",
);
record(
  "configured GitHub attachment video URL",
  args.githubAttachmentUrl ? "present" : "missing",
  args.githubAttachmentUrl
    ? "manual github.com/user-attachments MP4 URL was provided"
    : "manual GitHub attachment URL was not provided",
  "",
);

if (requireGithubAttachmentCookie && args.githubAttachmentUrl && !githubInlineAttachment(args.githubAttachmentUrl)) {
  record(
    "final PR inline video publication",
    "blocked",
    "manual video URL is not a GitHub user-attachments URL",
    "Pass a github.com/user-attachments/assets/... MP4 URL or configure MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE.",
  );
} else if (requireGithubAttachmentCookie && !env.githubUserAttachmentsCookiePresent && !args.githubAttachmentUrl) {
  record(
    "final PR inline video publication",
    "blocked",
    "no GitHub web attachment cookie and no manual GitHub attachment URL are available",
    "Configure MINELINK_GITHUB_USER_ATTACHMENTS_COOKIE or pass github_attachment_video_url before running full-chain PR video publication.",
  );
} else if (requireGithubAttachmentCookie) {
  record(
    "final PR inline video publication",
    "passed",
    args.githubAttachmentUrl
      ? "manual GitHub attachment URL can be used for final PR playback"
      : "GitHub web attachment cookie can create the PR playback attachment",
    "",
  );
}

const ghAuth = run("gh", ["auth", "status"]);
record(
  "GitHub CLI auth",
  ghAuth.status === 0 ? "passed" : "blocked",
  ghAuth.status === 0 ? "gh auth status succeeded" : sanitize(ghAuth.stderr || ghAuth.stdout),
  ghAuth.status === 0 || !requireGithubSecrets
    ? ""
    : "GitHub CLI is not authenticated; cannot inspect repo secrets.",
);

let githubSecrets = new Set();
if (env.githubActions) {
  const missing = [
    ["ONA_TOKEN", env.onaTokenPresent],
    ["LINEAR_API_KEY", env.linearKeyPresent],
    ["AGENT_FACTORY_GITHUB_TOKEN", env.agentFactoryGithubTokenPresent],
  ]
    .filter(([, present]) => !present)
    .map(([name]) => name);
  record(
    "GitHub Actions secret env",
    missing.length === 0 ? "passed" : "blocked",
    missing.length === 0
      ? "ONA_TOKEN, LINEAR_API_KEY, and AGENT_FACTORY_GITHUB_TOKEN are visible to this runner as environment variables"
      : `missing secret-backed environment variables: ${missing.join(", ")}`,
    requireGithubSecrets && missing.length > 0
      ? `Configure GitHub repository secrets or workflow environment: ${missing.join(", ")}.`
      : "",
  );
} else if (repo && ghAuth.status === 0) {
  const secretList = run("gh", ["secret", "list", "--repo", repo]);
  if (secretList.status === 0) {
    githubSecrets = parseSecretNames(secretList.stdout);
    const missing = ["ONA_TOKEN", "LINEAR_API_KEY", "AGENT_FACTORY_GITHUB_TOKEN"].filter(
      (name) => !githubSecrets.has(name),
    );
    record(
      "GitHub repo secrets",
      missing.length === 0 ? "passed" : "blocked",
      missing.length === 0
        ? "ONA_TOKEN, LINEAR_API_KEY, and AGENT_FACTORY_GITHUB_TOKEN are configured as GitHub repository secrets"
        : `missing GitHub repository secrets: ${missing.join(", ")}`,
      requireGithubSecrets && missing.length > 0
        ? `Configure GitHub repository secrets: ${missing.join(", ")}.`
        : "",
    );
  } else {
    record(
      "GitHub repo secrets",
      "blocked",
      sanitize(secretList.stderr || secretList.stdout),
      requireGithubSecrets ? "Could not list GitHub repository secrets." : "",
    );
  }
} else {
  record(
    "GitHub repo secrets",
    "missing",
    repo ? "GitHub auth unavailable" : "repository could not be inferred",
    requireGithubSecrets ? "GitHub repository secret preflight could not run." : "",
  );
}

const onaWhoami = run("ona", ["whoami"]);
record(
  "Ona CLI active context",
  onaWhoami.status === 0 ? "passed" : "blocked",
  onaWhoami.status === 0 ? "ona whoami succeeded" : sanitize(onaWhoami.stderr || onaWhoami.stdout),
  requireOnaContext && onaWhoami.status !== 0
    ? "Ona CLI has no active context. In CI, configure ONA_TOKEN and run ona login before starting automation."
    : "",
);

const observedIssues = checks.some((check) => check.status === "blocked");
const result = blockers.length > 0 ? "blocked" : observedIssues ? "attention" : "completed";
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const nextActions = unique([
  ...blockers,
  ...checks.flatMap((check) => {
    if (check.name === "current ONA_TOKEN/GITPOD_TOKEN" && check.status === "missing" && env.githubActions) {
      return ["Provide ONA_TOKEN to the runner before dispatching Ona automation."];
    }
    if (
      check.name === "current LINEAR_API_KEY" &&
      check.status === "missing" &&
      (env.githubActions || requireLinearEnv)
    ) {
      return ["Provide LINEAR_API_KEY to the runner before enabling Linear watch/status sync."];
    }
    if (
      check.name === "current AGENT_FACTORY_GITHUB_TOKEN" &&
      check.status === "missing" &&
      env.githubActions
    ) {
      return [
        "Provide AGENT_FACTORY_GITHUB_TOKEN to the runner before creating or updating agent-factory pull requests.",
      ];
    }
    if (check.name === "GitHub CLI auth" && check.status === "blocked") {
      return ["Authenticate GitHub CLI or provide GH_TOKEN/GITHUB_TOKEN before inspecting repository state."];
    }
    if (check.name === "GitHub repo secrets" && check.status === "blocked") {
      return [
        "Configure GitHub repository secrets: ONA_TOKEN, LINEAR_API_KEY, and AGENT_FACTORY_GITHUB_TOKEN.",
      ];
    }
    if (check.name === "GitHub Actions secret env" && check.status === "blocked") {
      return [
        "Configure GitHub repository or environment secrets so ONA_TOKEN, LINEAR_API_KEY, and AGENT_FACTORY_GITHUB_TOKEN are visible to the workflow runner.",
      ];
    }
    if (check.name === "Ona CLI active context" && check.status === "blocked") {
      return ["Verify ona login creates an active Ona context before running ona ai automation start."];
    }
    return [];
  }),
]);

const report = {
  repo: repo || "unknown",
  generatedAt: new Date().toISOString(),
  result,
  checks,
  blockers,
  nextActions,
  boundary:
    "This report checks credential presence and CLI context only. It never proves MineLink product acceptance.",
};

function escapeMd(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

const lines = [
  "# MineLink Agent Factory Secret Preflight",
  "",
  `- Repository: \`${escapeMd(report.repo)}\``,
  `- Generated: \`${report.generatedAt}\``,
  `- Result: \`${result}\``,
  "- Boundary: `credential presence and CLI context only; no secret values printed`",
  "",
  "## Checks",
  "",
  "| Check | Status | Evidence | Blocker |",
  "| --- | --- | --- | --- |",
  ...checks.map(
    (check) =>
      `| ${escapeMd(check.name)} | \`${check.status}\` | ${escapeMd(check.evidence || "none")} | ${escapeMd(check.blocker || "none")} |`,
  ),
  "",
  "## Next Actions",
  "",
  ...(nextActions.length > 0 ? nextActions.map((action) => `- ${escapeMd(action)}`) : ["- none"]),
  "",
];

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, lines.join("\n"), "utf8");
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Agent factory secret preflight wrote ${args.output} and ${args.jsonOutput}`);
process.exit(blockers.length > 0 ? 1 : 0);
