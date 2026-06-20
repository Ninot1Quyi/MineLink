#!/usr/bin/env node
import { MockRuntimeServer, parseFixture } from "./runtime.js";

async function main(): Promise<void> {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 1) {
    const part = process.argv[i];
    if (part.startsWith("--")) {
      const key = part.slice(2);
      const next = process.argv[i + 1];
      if (next && !next.startsWith("--")) {
        args.set(key, next);
        i += 1;
      } else {
        args.set(key, "true");
      }
    }
  }

  const server = new MockRuntimeServer({
    fixture: parseFixture(args.get("fixture")),
    port: Number(args.get("port") ?? 25575),
    host: args.get("host") ?? "127.0.0.1",
    logDir: args.get("log-dir") ?? ".minelink-dev/logs",
    tracePath: args.get("trace") ?? ".minelink-dev/replays/latest-action-trace.jsonl",
    onlineMode: args.get("online-mode") === "true"
  });

  await server.start();
  process.stderr.write(`MineLink mock runtime ready at ${server.endpoint()}\n`);

  const stop = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
