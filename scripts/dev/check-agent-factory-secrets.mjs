#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = {
  repo: process.env.GITHUB_REPOSITORY ?? "",
  output: ".minelink-dev/reports/agent-factory-secrets.md",
  jsonOutput: ".minelink-dev/reports/agent-factory-secrets.json",
};

let requireGithubSecrets = false;
let requireOnaContext = false;
let requireLinearEnv = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--repo") args.repo = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--require-github-secrets") requireGithubSecrets = true;
  else if (arg === "--require-ona-context") requireOnaContext = true;
  else if (arg === "--require-linear-env") requireLinearEnv = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/check-agent-factory-secrets.mjs [options]

Checks only the presence and usability of credentials needed by the MineLink
agent factory. It never prints secret values.

Options:
  --repo owner/name              GitHub repository to inspect.
  --require-github-secrets       Fail if ONA_TOKEN or LINEAR_API_KEY is missing in GitHub secrets.
  --require-ona-context          Fail if local/runner Ona CLI has no active context.
  --require-linear-env           Fail if LINEAR_API_KEY is not present in the current environment.
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

const repo = inferRepo();
const env = {
  onaTokenPresent: Boolean(process.env.ONA_TOKEN || process.env.GITPOD_TOKEN),
  linearKeyPresent: Boolean(process.env.LINEAR_API_KEY),
  ghTokenPresent: Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN),
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
  ]
    .filter(([, present]) => !present)
    .map(([name]) => name);
  record(
    "GitHub Actions secret env",
    missing.length === 0 ? "passed" : "blocked",
    missing.length === 0
      ? "ONA_TOKEN and LINEAR_API_KEY are visible to this runner as environment variables"
      : `missing secret-backed environment variables: ${missing.join(", ")}`,
    requireGithubSecrets && missing.length > 0
      ? `Configure GitHub repository secrets or workflow environment: ${missing.join(", ")}.`
      : "",
  );
} else if (repo && ghAuth.status === 0) {
  const secretList = run("gh", ["secret", "list", "--repo", repo]);
  if (secretList.status === 0) {
    githubSecrets = parseSecretNames(secretList.stdout);
    const missing = ["ONA_TOKEN", "LINEAR_API_KEY"].filter((name) => !githubSecrets.has(name));
    record(
      "GitHub repo secrets",
      missing.length === 0 ? "passed" : "blocked",
      missing.length === 0
        ? "ONA_TOKEN and LINEAR_API_KEY are configured as GitHub repository secrets"
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
const report = {
  repo: repo || "unknown",
  generatedAt: new Date().toISOString(),
  result,
  checks,
  blockers,
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
  ...(blockers.length > 0 ? blockers.map((blocker) => `- ${escapeMd(blocker)}`) : ["- none"]),
  "",
];

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, lines.join("\n"), "utf8");
await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Agent factory secret preflight wrote ${args.output} and ${args.jsonOutput}`);
process.exit(blockers.length > 0 ? 1 : 0);
