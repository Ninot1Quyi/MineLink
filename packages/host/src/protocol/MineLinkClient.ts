import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { MineLinkEnvelopeSchema, type JsonObject } from "@minelink/protocol";

export interface MineLinkClientOptions {
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: JsonObject) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

type TransportKind = "websocket" | "http";

export class MineLinkClient extends EventEmitter {
  private socket?: WebSocket;
  private endpointValue?: string;
  private transportKind?: TransportKind;
  private pending = new Map<string, PendingRequest>();
  private seq = 0;
  private readonly requestTimeoutMs: number;

  constructor(options: MineLinkClientOptions = {}) {
    super();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10000;
  }

  get connected(): boolean {
    if (this.transportKind === "http") return Boolean(this.endpointValue);
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get endpoint(): string | undefined {
    return this.endpointValue;
  }

  async connect(endpoint: string): Promise<void> {
    if (this.connected && this.endpointValue === endpoint) return;
    if (this.connected && this.endpointValue !== endpoint) {
      this.close();
    }

    const transportKind = detectTransport(endpoint);
    if (transportKind === "http") {
      this.endpointValue = endpoint;
      this.transportKind = "http";
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(endpoint);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting to ${endpoint}`));
      }, this.requestTimeoutMs);

      socket.once("open", () => {
        clearTimeout(timer);
        this.socket = socket;
        this.endpointValue = endpoint;
        this.transportKind = "websocket";
        this.installHandlers(socket);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async request<T extends JsonObject = JsonObject>(payload: JsonObject & { type: string }): Promise<T> {
    if (this.transportKind === "http") {
      return this.httpRequest<T>(payload);
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("MineLink runtime is not connected");
    }

    const id = `req_${Date.now()}_${++this.seq}`;
    const envelope = { id, ...payload };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MineLink request timed out: ${payload.type}`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      });
      this.socket?.send(JSON.stringify(envelope));
    });
  }

  close(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.socket = undefined;
    this.endpointValue = undefined;
    this.transportKind = undefined;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`MineLink client closed before ${id} completed`));
    }
    this.pending.clear();
  }

  private installHandlers(socket: WebSocket): void {
    socket.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch (error) {
        this.emit("protocol-error", error);
        return;
      }

      const envelope = MineLinkEnvelopeSchema.safeParse(parsed);
      if (!envelope.success) {
        this.emit("protocol-error", envelope.error);
        return;
      }

      const data = envelope.data as JsonObject & { id?: string };
      if (data.id && this.pending.has(data.id)) {
        const pending = this.pending.get(data.id)!;
        clearTimeout(pending.timer);
        this.pending.delete(data.id);
        pending.resolve(data);
        return;
      }

      this.emit("event", data);
    });

    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.endpointValue = undefined;
      this.transportKind = undefined;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("MineLink runtime connection closed"));
      }
      this.pending.clear();
      this.emit("close");
    });
  }

  private async httpRequest<T extends JsonObject = JsonObject>(payload: JsonObject & { type: string }): Promise<T> {
    if (!this.endpointValue) {
      throw new Error("MineLink runtime is not connected");
    }

    const id = `req_${Date.now()}_${++this.seq}`;
    const envelope = { id, ...payload };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(this.endpointValue, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`MineLink HTTP request failed: ${response.status} ${response.statusText}`);
      }
      const parsed = (await response.json()) as unknown;
      const envelopeResult = MineLinkEnvelopeSchema.safeParse(parsed);
      if (!envelopeResult.success) {
        throw new Error(`Invalid MineLink HTTP envelope: ${envelopeResult.error.message}`);
      }
      const data = envelopeResult.data as JsonObject & { id?: string };
      if (data.id !== id) {
        throw new Error(`MineLink HTTP response id mismatch: expected ${id}, got ${data.id ?? "<none>"}`);
      }
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

function detectTransport(endpoint: string): TransportKind {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) return "http";
  return "websocket";
}
