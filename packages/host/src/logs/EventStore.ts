import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface EventStoreOptions {
  logDir?: string;
  tracePath?: string;
}

export class EventStore {
  readonly logDir: string;
  readonly tracePath: string;
  readonly hostLogPath: string;

  constructor(options: EventStoreOptions = {}) {
    this.logDir = options.logDir ?? ".minelink-dev/logs";
    this.tracePath = options.tracePath ?? ".minelink-dev/replays/latest-action-trace.jsonl";
    this.hostLogPath = join(this.logDir, "host.log");
    mkdirSync(this.logDir, { recursive: true });
    mkdirSync(dirname(this.tracePath), { recursive: true });
    writeFileSync(this.hostLogPath, "", { flag: "a" });
    writeFileSync(this.tracePath, "", { flag: "a" });
  }

  log(message: string, fields: Record<string, unknown> = {}): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), level: "info", message, ...fields });
    appendFileSync(this.hostLogPath, `${line}\n`);
  }

  trace(event: Record<string, unknown>): void {
    appendFileSync(
      this.tracePath,
      `${JSON.stringify({ ts: new Date().toISOString(), source: "host", ...event })}\n`
    );
  }
}
