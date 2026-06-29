#!/usr/bin/env node
import { createHash, pbkdf2Sync, createDecipheriv } from "node:crypto";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text.length > 0 && !["none", "null", "undefined", "-"].includes(text.toLowerCase())) return text;
  }
  return "";
}

const args = {
  chromeCookieDb:
    process.env.MINELINK_GITHUB_CHROME_COOKIE_DB ??
    path.join(os.homedir(), "Library/Application Support/Google/Chrome/Default/Cookies"),
  cookieFile:
    process.env.MINELINK_GITHUB_USER_SESSION_FILE ??
    ".minelink-dev/secrets/github-user-session.cookie",
  output: ".minelink-dev/reports/github-chrome-db-cookie-export.md",
  jsonOutput: ".minelink-dev/reports/github-chrome-db-cookie-export.json",
};

let dryRun = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const readValue = () => process.argv[++index] ?? "";
  if (arg === "--chrome-cookie-db") args.chromeCookieDb = readValue();
  else if (arg === "--cookie-file") args.cookieFile = readValue();
  else if (arg === "--output") args.output = readValue();
  else if (arg === "--json-output") args.jsonOutput = readValue();
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(`Usage: node scripts/dev/export-github-cookie-from-chrome-db.mjs

Exports GitHub web cookies from the local macOS Chrome cookie database into the
ignored MineLink cookie file used by GitHub user-attachment upload helpers.
Cookie values are never printed. The script uses the local macOS Keychain entry
"Chrome Safe Storage" to decrypt Chrome v10 cookies and strips Chrome's
SHA256(host_key) cookie-binding prefix when present.

This is a local trusted-publisher helper only. It does not work in GitHub
Actions or Ona containers, does not log in to GitHub, and does not make a
GitHub session non-expiring.`);
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

function cookieExpiresChromeToIso(expiresUtc) {
  const value = Number(expiresUtc);
  if (!Number.isFinite(value) || value <= 0) return "session";
  const unixMs = Math.trunc(value / 1000 - 11644473600000);
  return new Date(unixMs).toISOString();
}

function keychainPassword() {
  const result = spawnSync("security", ["find-generic-password", "-w", "-a", "Chrome", "-s", "Chrome Safe Storage"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || !hasValue(result.stdout)) {
    throw new Error(`Chrome Safe Storage keychain lookup failed: ${compact(result.stderr || result.stdout)}`);
  }
  return result.stdout.trim();
}

function decryptChromeValue(hostKey, encryptedHex, key) {
  const encrypted = Buffer.from(encryptedHex, "hex");
  let plaintext = encrypted;
  if (encrypted.subarray(0, 3).toString("utf8") === "v10") {
    const iv = Buffer.alloc(16, 0x20);
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    plaintext = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
  }

  const hostDigest = createHash("sha256").update(hostKey).digest();
  if (plaintext.length > hostDigest.length && plaintext.subarray(0, hostDigest.length).equals(hostDigest)) {
    plaintext = plaintext.subarray(hostDigest.length);
  }
  const value = plaintext.toString("utf8");
  if (!/^[\x20-\x7e]*$/.test(value)) {
    throw new Error(`Decrypted cookie ${hostKey} contains non-HTTP-header bytes after Chrome host binding strip.`);
  }
  return value;
}

function queryChromeCookies(dbPath) {
  const sql = `
select host_key || char(9) || name || char(9) || hex(encrypted_value) || char(9) || expires_utc
from cookies
where host_key like '%github.com'
  and name in ('logged_in','dotcom_user','user_session','__Host-user_session_same_site','_gh_sess','saved_user_sessions','_device_id','_octo')
order by case name
  when 'logged_in' then 1
  when 'dotcom_user' then 2
  when 'user_session' then 3
  when '__Host-user_session_same_site' then 4
  when '_gh_sess' then 5
  when 'saved_user_sessions' then 6
  when '_device_id' then 7
  when '_octo' then 8
  else 99
end;`;
  const result = spawnSync("sqlite3", [dbPath, sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`sqlite3 cookie query failed: ${compact(result.stderr || result.stdout)}`);
  return result.stdout
    .trim()
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hostKey, name, encryptedHex, expiresUtc] = line.split("\t");
      return { hostKey, name, encryptedHex, expiresUtc };
    });
}

function cookieHeader(pairs) {
  return pairs.map(({ name, value }) => `${name}=${value}`).join("; ");
}

async function writeReport(report) {
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.mkdir(path.dirname(args.jsonOutput), { recursive: true });
  const lines = [
    "# GitHub Chrome DB Cookie Export",
    "",
    `- Result: \`${report.result}\``,
    `- Chrome cookie DB: \`${args.chromeCookieDb}\``,
    `- Cookie file: \`${args.cookieFile}\``,
    `- Dry run: \`${dryRun ? "yes" : "no"}\``,
    `- Cookie count: \`${report.cookieCount}\``,
    `- Has user_session: \`${report.hasUserSession ? "yes" : "no"}\``,
    `- Has _gh_sess: \`${report.hasGhSess ? "yes" : "no"}\``,
    `- Boundary: \`${report.boundary}\``,
    "",
    "## Cookies",
    "",
    ...(report.cookies.length > 0
      ? report.cookies.map(
          (cookie) =>
            `- \`${cookie.name}\`: length \`${cookie.length}\`, expires \`${cookie.expires}\`, strippedHostPrefix \`${cookie.strippedHostPrefix ? "yes" : "no"}\``,
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
  cookieCount: 0,
  hasUserSession: false,
  hasGhSess: false,
  cookies: [],
  failures: [],
  boundary:
    "local trusted GitHub user-attachment helper; reads macOS Chrome cookie DB, writes only ignored MineLink cookie file, and never prints cookie values",
};

try {
  if (process.platform !== "darwin") throw new Error("Chrome DB export is currently implemented only for macOS.");
  const stat = await fs.stat(args.chromeCookieDb).catch(() => null);
  if (!stat?.isFile()) throw new Error(`Chrome cookie DB is missing: ${args.chromeCookieDb}`);
  const key = pbkdf2Sync(keychainPassword(), "saltysalt", 1003, 16, "sha1");
  const rows = queryChromeCookies(args.chromeCookieDb);
  const pairs = [];
  for (const row of rows) {
    const hostDigest = createHash("sha256").update(row.hostKey).digest();
    const encrypted = Buffer.from(row.encryptedHex, "hex");
    let plaintext = encrypted;
    if (encrypted.subarray(0, 3).toString("utf8") === "v10") {
      const iv = Buffer.alloc(16, 0x20);
      const decipher = createDecipheriv("aes-128-cbc", key, iv);
      plaintext = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
    }
    const strippedHostPrefix =
      plaintext.length > hostDigest.length && plaintext.subarray(0, hostDigest.length).equals(hostDigest);
    const value = decryptChromeValue(row.hostKey, row.encryptedHex, key);
    if (!hasValue(value)) continue;
    pairs.push({ name: row.name, value });
    report.cookies.push({
      name: row.name,
      length: value.length,
      expires: cookieExpiresChromeToIso(row.expiresUtc),
      strippedHostPrefix,
    });
  }
  report.cookieCount = pairs.length;
  report.hasUserSession = pairs.some((pair) => pair.name === "user_session");
  report.hasGhSess = pairs.some((pair) => pair.name === "_gh_sess");
  if (!report.hasUserSession) throw new Error("Chrome GitHub cookies do not contain user_session.");
  if (!dryRun) {
    await fs.mkdir(path.dirname(args.cookieFile), { recursive: true });
    await fs.writeFile(args.cookieFile, `${cookieHeader(pairs)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.chmod(args.cookieFile, 0o600).catch(() => {});
  }
  report.result = dryRun ? "dry-run" : "updated";
} catch (error) {
  report.result = "blocked";
  report.failures.push(compact(error?.message ?? error));
} finally {
  await writeReport(report);
}

if (report.result === "blocked") {
  console.error(`GitHub Chrome DB cookie export blocked; wrote ${args.output}`);
  process.exit(1);
}

console.log(`GitHub Chrome DB cookie export ${report.result}; wrote ${args.output}`);
