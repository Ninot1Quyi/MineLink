import {
  BirthArgsSchema,
  ConnectServerArgsSchema,
  DYNAMIC_TOOLS,
  MINELINK_HOST_VERSION,
  MINELINK_PROTOCOL_VERSION,
  ToolExecuteArgsSchema,
  ToolListArgsSchema,
  ToolQueryArgsSchema,
  fail,
  filterDynamicTools,
  findDynamicTool,
  ok,
  type BirthArgs,
  type ConnectServerArgs,
  type JsonObject,
  type ToolExecuteArgs,
  type ToolListArgs,
  type ToolQueryArgs,
  type ToolResult
} from "@minelink/protocol";
import { EventStore } from "../logs/EventStore.js";
import { MineLinkClient } from "../protocol/MineLinkClient.js";

interface HostSession {
  endpoint?: string;
  ownerId?: string;
  agentId?: string;
  displayName?: string;
  server?: JsonObject;
  capabilities?: JsonObject;
}

export interface HostControllerOptions {
  eventStore?: EventStore;
  client?: MineLinkClient;
}

export class HostController {
  private readonly eventStore: EventStore;
  private readonly client: MineLinkClient;
  private session: HostSession = {};

  constructor(options: HostControllerOptions = {}) {
    this.eventStore =
      options.eventStore ??
      new EventStore({
        logDir: process.env.MINELINK_LOG_DIR,
        tracePath: process.env.MINELINK_TRACE
      });
    this.client = options.client ?? new MineLinkClient();
  }

  async ping(): Promise<ToolResult> {
    return ok({
      host: "minelink-host",
      version: MINELINK_HOST_VERSION,
      protocol_version: MINELINK_PROTOCOL_VERSION,
      connected: this.client.connected,
      session: this.session as JsonObject
    });
  }

  async connectServer(rawArgs: Partial<ConnectServerArgs>): Promise<ToolResult> {
    const parsed = ConnectServerArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return fail("invalid_arguments", parsed.error.message);
    }

    const args = parsed.data;
    try {
      if (this.client.connected && this.session.endpoint && this.session.endpoint !== args.endpoint) {
        this.session = {};
      }
      await this.client.connect(args.endpoint);
      const hello = await this.client.request({
        type: "hello",
        protocol_version: MINELINK_PROTOCOL_VERSION,
        client: { kind: "minelink-host", version: MINELINK_HOST_VERSION }
      });

      const connect = await this.client.request({
        type: "connect",
        server_address: args.serverAddress,
        owner: { kind: "offline_agent", name: args.ownerName },
        admission_token: args.admissionToken ?? null
      });

      if (connect.ok === false) {
        return connect as unknown as ToolResult;
      }

      this.session = {
        endpoint: args.endpoint,
        ownerId: String(connect.owner_id ?? ""),
        server: (hello.server as JsonObject | undefined) ?? {},
        capabilities: (hello.capabilities as JsonObject | undefined) ?? {}
      };
      this.eventStore.log("connected runtime", { endpoint: args.endpoint, ownerId: this.session.ownerId });
      this.eventStore.trace({ type: "connect_server", endpoint: args.endpoint, result: connect });
      return ok({ hello, connect });
    } catch (error) {
      return fail("runtime_unavailable", error instanceof Error ? error.message : String(error));
    }
  }

  async birth(rawArgs: Partial<BirthArgs>): Promise<ToolResult> {
    if (!this.client.connected || !this.session.ownerId) {
      return fail("not_connected", "Call minelink.connect_server before minelink.birth.");
    }

    const parsed = BirthArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return fail("invalid_arguments", parsed.error.message);
    }

    try {
      const response = await this.client.request({
        type: "agent.birth",
        seed_prompt: parsed.data.seedPrompt,
        body_type: parsed.data.bodyType,
        owner_id: this.session.ownerId
      });
      if (response.ok === false) {
        return response as unknown as ToolResult;
      }

      this.session.agentId = String(response.agent_id ?? "");
      this.session.displayName = String(response.display_name ?? "");
      this.eventStore.log("agent born", {
        agentId: this.session.agentId,
        displayName: this.session.displayName
      });
      this.eventStore.trace({ type: "agent.birth", result: response });
      return ok(response);
    } catch (error) {
      return fail("runtime_unavailable", error instanceof Error ? error.message : String(error));
    }
  }

  async toolList(rawArgs: Partial<ToolListArgs>): Promise<ToolResult> {
    const parsed = ToolListArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return fail("invalid_arguments", parsed.error.message);
    }

    if (!this.client.connected) {
      return ok({ tools: summarizeTools(filterDynamicTools(parsed.data)), next_cursor: null });
    }

    try {
      const response = await this.client.request({
        type: "tool.list",
        ...parsed.data
      });
      if (response.ok === false) {
        return response as unknown as ToolResult;
      }
      return ok(response);
    } catch (error) {
      return fail("runtime_unavailable", error instanceof Error ? error.message : String(error));
    }
  }

  async toolQuery(rawArgs: ToolQueryArgs): Promise<ToolResult> {
    const parsed = ToolQueryArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return fail("invalid_arguments", parsed.error.message);
    }

    if (this.client.connected) {
      try {
        const response = await this.client.request({
          type: "tool.query",
          name: parsed.data.name
        });
        if (response.ok === false) {
          return response as unknown as ToolResult;
        }
        return ok(response);
      } catch (error) {
        return fail("runtime_unavailable", error instanceof Error ? error.message : String(error));
      }
    }

    const local = findDynamicTool(parsed.data.name);
    if (!local) {
      return fail("unknown_tool", `Unknown dynamic tool: ${parsed.data.name}`);
    }
    return ok(local as unknown as JsonObject);
  }

  async toolExecute(rawArgs: ToolExecuteArgs): Promise<ToolResult> {
    const parsed = ToolExecuteArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return fail("invalid_arguments", parsed.error.message);
    }
    const args = parsed.data;

    if (!this.client.connected || !this.session.agentId) {
      const local = findDynamicTool(args.name);
      if (!local) {
        return fail("unknown_tool", `Unknown dynamic tool: ${args.name}`);
      }
      return fail("agent_not_born", "Call minelink.connect_server and minelink.birth first.");
    }

    try {
      const response = await this.client.request({
        type: "tool.execute",
        agent_id: this.session.agentId,
        name: args.name,
        mode: args.mode,
        arguments: args.arguments
      });
      this.eventStore.trace({ type: "tool.execute", name: args.name, mode: args.mode, response });
      if (response.ok === false) {
        return response as unknown as ToolResult;
      }
      return ok(response);
    } catch (error) {
      return fail("runtime_unavailable", error instanceof Error ? error.message : String(error));
    }
  }

  close(): void {
    this.client.close();
  }
}

function summarizeTools(tools = DYNAMIC_TOOLS): JsonObject[] {
  return tools.map((tool) => ({
    name: tool.name,
    summary: tool.summary,
    tags: tool.tags
  }));
}
