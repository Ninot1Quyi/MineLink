#!/usr/bin/env node
import { startHttpMcpServer } from "./mcp/httpServer.js";
import { startMcpServer } from "./mcp/server.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "mcp";

  if (command === "mcp" || command === "stdio" || command === "dev") {
    await startMcpServer();
    return;
  }

  if (command === "http" || command === "gateway") {
    const server = await startHttpMcpServer({
      host: getArg("--host") ?? process.env.MINELINK_HOST ?? "127.0.0.1",
      port: Number(getArg("--port") ?? process.env.MINELINK_PORT ?? "8765")
    });
    process.stderr.write(`MineLink Streamable HTTP Gateway listening on ${server.url}\n`);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    process.stderr.write(`MineLink Host ${process.env.npm_package_version ?? "0.1.0"}\n`);
    process.stderr.write("Usage: minelink-host [mcp|stdio|dev|http|gateway] [--host 127.0.0.1] [--port 8765]\n");
    return;
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
