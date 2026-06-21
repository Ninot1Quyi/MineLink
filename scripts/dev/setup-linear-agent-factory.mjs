#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const endpoint = "https://api.linear.app/graphql";

const args = {
  team: process.env.MINELINK_LINEAR_TEAM ?? "NIN",
  project: process.env.MINELINK_LINEAR_PROJECT ?? "MineLink",
  output: ".minelink-dev/reports/linear-agent-factory-setup.md",
  jsonOutput: ".minelink-dev/reports/linear-agent-factory-setup.json",
};

let dryRun = false;
let requireKey = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--team") args.team = readValue();
  else if (arg === "--project") args.project = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "--require-key") requireKey = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/setup-linear-agent-factory.mjs [options]

Ensures the Linear project, labels, and issue workflow states used by the
MineLink agent factory. The script requires LINEAR_API_KEY and never prints the
key value.

Options:
  --team NIN             Linear team key, name, or id. Default: NIN.
  --project MineLink     Linear project name. Default: MineLink.
  --dry-run              Report missing objects without creating them.
  --require-key          Fail when LINEAR_API_KEY is missing.
`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

const requiredLabels = [
  "agent-ready",
  "agent:ona",
  "real-neoforge-required",
  "video-required",
  "mock-only",
  "smoke-only",
  "real-partial",
  "product-accepted",
  "blocked",
  "needs-human-review",
  "needs-acceptance-evidence",
  "ci-reporting",
  "docs-architecture",
  ...Array.from({ length: 12 }, (_, index) => `gate:${index}`),
];

const requiredStates = [
  { name: "Triage", type: "backlog", color: "#8A8F98", position: 100 },
  { name: "Ready for Agent", type: "unstarted", color: "#4EA7FC", position: 200 },
  { name: "Agent Queued", type: "started", color: "#F2C94C", position: 300 },
  { name: "Agent Running", type: "started", color: "#5E6AD2", position: 400 },
  { name: "PR Open", type: "started", color: "#26B5CE", position: 500 },
  { name: "CI Running", type: "started", color: "#00B894", position: 600 },
  { name: "Video Rendering", type: "started", color: "#A259FF", position: 700 },
  { name: "Video Review", type: "started", color: "#F2994A", position: 800 },
  { name: "Human Review", type: "started", color: "#EB5757", position: 900 },
  { name: "Accepted", type: "completed", color: "#27AE60", position: 1000 },
  { name: "Blocked", type: "started", color: "#C52828", position: 1100 },
];

const apiKey = process.env.LINEAR_API_KEY ?? "";
const report = {
  generatedAt: new Date().toISOString(),
  team: args.team,
  project: args.project,
  dryRun,
  keyPresent: apiKey.length > 0,
  operations: [],
  existing: [],
  planned: [],
  errors: [],
  result: "skipped",
};

function sanitize(text) {
  return String(text ?? "")
    .replace(/(lin_api_)[A-Za-z0-9]+/g, "$1[redacted]")
    .replace(/(github_pat_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/(ghp_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function sameName(left, right) {
  return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
}

async function graphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Linear returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`Linear HTTP ${response.status}: ${sanitize(JSON.stringify(payload))}`);
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(
      `Linear GraphQL error: ${payload.errors.map((error) => error.message).join("; ")}`,
    );
  }
  return payload.data;
}

async function writeReport() {
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.jsonOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const lines = [
    "# MineLink Linear Agent Factory Setup",
    "",
    `- Generated: \`${report.generatedAt}\``,
    `- Team: \`${report.team}\``,
    `- Project: \`${report.project}\``,
    `- Dry run: \`${report.dryRun ? "yes" : "no"}\``,
    `- LINEAR_API_KEY present: \`${report.keyPresent ? "yes" : "no"}\``,
    `- Result: \`${report.result}\``,
    "",
    "## Existing",
    "",
    ...(report.existing.length === 0 ? ["- none"] : report.existing.map((item) => `- ${item}`)),
    "",
    "## Planned",
    "",
    ...(report.planned.length === 0 ? ["- none"] : report.planned.map((item) => `- ${item}`)),
    "",
    "## Operations",
    "",
    ...(report.operations.length === 0
      ? ["- none"]
      : report.operations.map((item) => `- ${item}`)),
    "",
    "## Errors",
    "",
    ...(report.errors.length === 0 ? ["- none"] : report.errors.map((item) => `- ${item}`)),
    "",
    "## Boundary",
    "",
    "- This setup only prepares Linear routing metadata. It does not prove Ona Platform Codex execution, acceptance video review, PR creation, or MineLink product acceptance.",
    "",
  ];
  await fs.writeFile(args.output, lines.join("\n"), "utf8");
}

async function readWorkspace() {
  const teams = await graphql(
    `query MineLinkLinearTeams {
      teams(first: 20) {
        nodes {
          id
          key
          name
          states { nodes { id name type } }
        }
      }
    }`,
  );
  const labels = await graphql(
    `query MineLinkLinearLabels {
      issueLabels(first: 100) {
        nodes { id name team { id key } }
      }
    }`,
  );
  const projects = await graphql(
    `query MineLinkLinearProjects {
      projects(first: 100) {
        nodes {
          id
          name
          url
          state
          teams { nodes { id key } }
        }
      }
    }`,
  );
  return {
    teams: teams.teams,
    issueLabels: labels.issueLabels,
    projects: projects.projects,
  };
}

async function createIssueLabel(team, name) {
  if (dryRun) {
    report.planned.push(`create label ${name}`);
    return null;
  }
  const data = await graphql(
    `mutation MineLinkIssueLabelCreate($input: IssueLabelCreateInput!) {
      issueLabelCreate(input: $input) {
        success
        issueLabel { id name }
      }
    }`,
    { input: { name, color: "#ededed", teamId: team.id } },
  );
  if (!data.issueLabelCreate?.success) {
    throw new Error(`issueLabelCreate returned success=false for ${name}`);
  }
  const label = data.issueLabelCreate.issueLabel;
  report.operations.push(`created label ${label.name}`);
  return label;
}

async function createWorkflowState(team, state) {
  if (dryRun) {
    report.planned.push(`create workflow state ${state.name}`);
    return null;
  }
  const data = await graphql(
    `mutation MineLinkWorkflowStateCreate($input: WorkflowStateCreateInput!) {
      workflowStateCreate(input: $input) {
        success
        workflowState { id name type }
      }
    }`,
    { input: { ...state, teamId: team.id } },
  );
  if (!data.workflowStateCreate?.success) {
    throw new Error(`workflowStateCreate returned success=false for ${state.name}`);
  }
  const created = data.workflowStateCreate.workflowState;
  report.operations.push(`created workflow state ${created.name}`);
  return created;
}

async function createProject(team) {
  if (dryRun) {
    report.planned.push(`create project ${args.project}`);
    return null;
  }
  const data = await graphql(
    `mutation MineLinkProjectCreate($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        success
        project {
          id
          name
          url
          state
          teams { nodes { id key name } }
        }
      }
    }`,
    {
      input: {
        name: args.project,
        teamIds: [team.id],
        description:
          "MineLink product and agent-factory delivery board. Created by scripts/dev/setup-linear-agent-factory.mjs.",
      },
    },
  );
  if (!data.projectCreate?.success) {
    throw new Error(`projectCreate returned success=false for ${args.project}`);
  }
  const project = data.projectCreate.project;
  report.operations.push(`created project ${project.name} (${project.url})`);
  return project;
}

async function main() {
  if (!apiKey) {
    report.result = "blocked";
    report.errors.push("LINEAR_API_KEY is missing.");
    await writeReport();
    process.exit(requireKey ? 1 : 0);
  }

  const workspace = await readWorkspace();
  const teams = workspace.teams?.nodes ?? [];
  const team =
    teams.find((candidate) => sameName(candidate.key, args.team)) ??
    teams.find((candidate) => sameName(candidate.name, args.team)) ??
    teams.find((candidate) => candidate.id === args.team);
  if (!team) {
    throw new Error(`No Linear team matched ${args.team}`);
  }
  report.team = `${team.key} (${team.id})`;

  const labels = workspace.issueLabels?.nodes ?? [];
  for (const name of requiredLabels) {
    const existing = labels.find(
      (label) => sameName(label.name, name) && (!label.team?.id || label.team.id === team.id),
    );
    if (existing) {
      report.existing.push(`label ${name}`);
    } else {
      await createIssueLabel(team, name);
    }
  }

  const existingStates = team.states?.nodes ?? [];
  for (const state of requiredStates) {
    const existing = existingStates.find((candidate) => sameName(candidate.name, state.name));
    if (existing) {
      report.existing.push(`workflow state ${state.name}`);
    } else {
      await createWorkflowState(team, state);
    }
  }

  const projects = workspace.projects?.nodes ?? [];
  const project = projects.find(
    (candidate) =>
      sameName(candidate.name, args.project) &&
      candidate.teams?.nodes?.some((projectTeam) => projectTeam.id === team.id),
  );
  if (project) {
    report.existing.push(`project ${project.name} (${project.url})`);
  } else {
    await createProject(team);
  }

  report.result = report.errors.length === 0 ? "completed" : "blocked";
  await writeReport();
}

main().catch(async (error) => {
  report.result = "blocked";
  report.errors.push(sanitize(error instanceof Error ? error.message : error));
  await writeReport();
  console.error(`Linear agent-factory setup failed; wrote ${args.output}`);
  process.exit(1);
});
