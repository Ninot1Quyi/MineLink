#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const linearEndpoint = "https://api.linear.app/graphql";

let issueRef = process.env.MINELINK_LINEAR_ISSUE ?? "";
let statusName = "";
let commentBody = "";
let attachmentTitle = "";
let attachmentUrl = "";
let output = ".minelink-dev/reports/linear-sync.md";
let requireKey = false;
let requireUpdate = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--issue") {
    issueRef = process.argv[++index] ?? "";
  } else if (arg === "--status") {
    statusName = process.argv[++index] ?? "";
  } else if (arg === "--comment") {
    commentBody = process.argv[++index] ?? "";
  } else if (arg === "--attachment-title") {
    attachmentTitle = process.argv[++index] ?? "";
  } else if (arg === "--attachment-url") {
    attachmentUrl = process.argv[++index] ?? "";
  } else if (arg === "--output") {
    output = process.argv[++index] ?? "";
  } else if (arg === "--require-key") {
    requireKey = true;
  } else if (arg === "--require-update") {
    requireUpdate = true;
  } else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/sync-linear-status.mjs [--issue NIN-7] [--status "In Progress"] [--comment text] [--attachment-title title --attachment-url url] [--require-key] [--require-update]

Updates a Linear issue through LINEAR_API_KEY. The script never prints the key.
If no issue is supplied, or the issue is "none", it writes a skipped report and
exits successfully unless --require-update is paired with a real issue.`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!output) {
  console.error("--output cannot be empty");
  process.exit(2);
}

const normalizedIssueRef = issueRef.trim();
const hasIssue =
  normalizedIssueRef.length > 0 &&
  !["none", "null", "undefined", "-"].includes(normalizedIssueRef.toLowerCase());
const apiKey = process.env.LINEAR_API_KEY ?? "";
const report = {
  issue: hasIssue ? normalizedIssueRef : "none",
  keyPresent: apiKey.length > 0,
  statusRequested: statusName || "none",
  commentRequested: commentBody.length > 0,
  attachmentRequested: attachmentUrl.length > 0,
  operations: [],
  errors: [],
};

async function writeReport() {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const lines = [
    "# MineLink Linear Sync",
    "",
    `- Issue: \`${report.issue}\``,
    `- LINEAR_API_KEY present: \`${report.keyPresent ? "yes" : "no"}\``,
    `- Status requested: \`${report.statusRequested}\``,
    `- Comment requested: \`${report.commentRequested ? "yes" : "no"}\``,
    `- Attachment requested: \`${report.attachmentRequested ? "yes" : "no"}\``,
    "",
    "## Operations",
    "",
    ...(report.operations.length > 0
      ? report.operations.map((operation) => `- ${operation}`)
      : ["- none"]),
    "",
    "## Errors",
    "",
    ...(report.errors.length > 0 ? report.errors.map((error) => `- ${error}`) : ["- none"]),
    "",
  ];
  await fs.writeFile(output, lines.join("\n"), "utf8");
}

function recordError(message) {
  report.errors.push(String(message).replace(/\s+/g, " ").trim());
}

async function graphql(query, variables = {}) {
  const response = await fetch(linearEndpoint, {
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
    throw new Error(`Linear HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const messages = payload.errors.map((error) => error.message).join("; ");
    throw new Error(`Linear GraphQL error: ${messages}`);
  }
  return payload.data;
}

async function issueById(ref) {
  const data = await graphql(
    `query MineLinkIssue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        url
        state { id name type }
        team { id name }
      }
    }`,
    { id: ref },
  );
  return data.issue ?? null;
}

async function issueByIdentifier(ref) {
  const data = await graphql(
    `query MineLinkIssueByIdentifier($identifier: String!) {
      issues(filter: { identifier: { eq: $identifier } }, first: 1) {
        nodes {
          id
          identifier
          title
          url
          state { id name type }
          team { id name }
        }
      }
    }`,
    { identifier: ref.toUpperCase() },
  );
  return data.issues?.nodes?.[0] ?? null;
}

async function loadIssue(ref) {
  try {
    const issue = await issueById(ref);
    if (issue) return issue;
  } catch (error) {
    report.operations.push(`issue(id) lookup failed; trying identifier lookup`);
    recordError(error instanceof Error ? error.message : error);
  }
  return issueByIdentifier(ref);
}

async function workflowStates() {
  try {
    const data = await graphql(
      `query MineLinkWorkflowStates {
        workflowStates(first: 250) {
          nodes {
            id
            name
            type
            team { id name }
          }
        }
      }`,
    );
    return data.workflowStates?.nodes ?? [];
  } catch (error) {
    report.operations.push(`workflow state lookup with team failed; trying flat lookup`);
    recordError(error instanceof Error ? error.message : error);
    const data = await graphql(
      `query MineLinkWorkflowStatesFlat {
        workflowStates(first: 250) {
          nodes {
            id
            name
            type
          }
        }
      }`,
    );
    return data.workflowStates?.nodes ?? [];
  }
}

async function updateStatus(issue, requestedName) {
  if (!requestedName) return false;
  const states = await workflowStates();
  const lower = requestedName.toLowerCase();
  const teamMatches = states.filter(
    (state) => state.name?.toLowerCase() === lower && state.team?.id === issue.team?.id,
  );
  const nameMatches = states.filter((state) => state.name?.toLowerCase() === lower);
  const selected = teamMatches[0] ?? (nameMatches.length === 1 ? nameMatches[0] : null);
  if (!selected) {
    throw new Error(
      `No unique Linear workflow state named "${requestedName}" for issue ${issue.identifier}`,
    );
  }
  const data = await graphql(
    `mutation MineLinkIssueUpdate($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        success
        issue { identifier state { id name type } }
      }
    }`,
    { id: issue.identifier, stateId: selected.id },
  );
  if (!data.issueUpdate?.success) {
    throw new Error(`Linear issueUpdate returned success=false for ${issue.identifier}`);
  }
  report.operations.push(
    `updated ${data.issueUpdate.issue.identifier} status to ${data.issueUpdate.issue.state.name}`,
  );
  return true;
}

async function createComment(issue, body) {
  if (!body) return false;
  const data = await graphql(
    `mutation MineLinkCommentCreate($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
        comment { id url }
      }
    }`,
    { issueId: issue.id, body },
  );
  if (!data.commentCreate?.success) {
    throw new Error(`Linear commentCreate returned success=false for ${issue.identifier}`);
  }
  report.operations.push(
    `created comment ${data.commentCreate.comment.id}${
      data.commentCreate.comment.url ? ` (${data.commentCreate.comment.url})` : ""
    }`,
  );
  return true;
}

async function createAttachment(issue, title, url) {
  if (!url) return false;
  const data = await graphql(
    `mutation MineLinkAttachmentCreate($issueId: String!, $title: String!, $url: String!) {
      attachmentCreate(input: { issueId: $issueId, title: $title, url: $url }) {
        success
        attachment { id title url }
      }
    }`,
    { issueId: issue.id, title: title || url, url },
  );
  if (!data.attachmentCreate?.success) {
    throw new Error(`Linear attachmentCreate returned success=false for ${issue.identifier}`);
  }
  report.operations.push(`attached ${data.attachmentCreate.attachment.title}`);
  return true;
}

let exitCode = 0;
try {
  if (!hasIssue) {
    report.operations.push("skipped because no Linear issue was supplied");
  } else if (!apiKey) {
    report.operations.push("skipped because LINEAR_API_KEY is not present");
    if (requireKey || requireUpdate) exitCode = 1;
  } else {
    const issue = await loadIssue(normalizedIssueRef);
    if (!issue) {
      throw new Error(`Linear issue not found: ${normalizedIssueRef}`);
    }
    report.operations.push(`loaded ${issue.identifier}: ${issue.title}`);
    let changed = false;
    changed = (await updateStatus(issue, statusName)) || changed;
    changed = (await createComment(issue, commentBody)) || changed;
    changed = (await createAttachment(issue, attachmentTitle, attachmentUrl)) || changed;
    if (requireUpdate && !changed) {
      throw new Error("No Linear update operation was requested");
    }
  }
} catch (error) {
  recordError(error instanceof Error ? error.message : error);
  exitCode = 1;
}

await writeReport();
if (exitCode === 0) {
  console.log(`Linear sync wrote ${output}`);
} else {
  console.error(`Linear sync failed; wrote ${output}`);
}
process.exit(exitCode);
