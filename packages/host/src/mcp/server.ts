import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  BirthArgsSchema,
  ConnectServerArgsSchema,
  MINELINK_HOST_VERSION,
  ToolExecuteArgsSchema,
  ToolListArgsSchema,
  ToolQueryArgsSchema,
  jsonText
} from "@minelink/protocol";
import { z } from "zod";
import { HostController } from "../session/HostController.js";

export function createMineLinkMcpServer(controller = new HostController()): McpServer {
  const server = new McpServer({
    name: "minelink-host",
    version: MINELINK_HOST_VERSION
  });

  server.registerTool(
    "minelink.ping",
    {
      description: "Return MineLink Host status and current session.",
      inputSchema: z.object({})
    },
    async () => jsonText(await controller.ping())
  );

  server.registerTool(
    "minelink.connect_server",
    {
      description: "Connect the Host to a MineLink runtime endpoint.",
      inputSchema: ConnectServerArgsSchema
    },
    async (args) => jsonText(await controller.connectServer(args))
  );

  server.registerTool(
    "minelink.birth",
    {
      description: "Create or restore a server_agent body for the current owner session.",
      inputSchema: BirthArgsSchema
    },
    async (args) => jsonText(await controller.birth(args))
  );

  server.registerTool(
    "minelink.tool_list",
    {
      description: "List lazy game capability tools for the current runtime/session.",
      inputSchema: ToolListArgsSchema
    },
    async (args) => jsonText(await controller.toolList(args))
  );

  server.registerTool(
    "minelink.tool_query",
    {
      description: "Fetch full schema and preconditions for one dynamic MineLink tool.",
      inputSchema: ToolQueryArgsSchema
    },
    async (args) => jsonText(await controller.toolQuery(args))
  );

  server.registerTool(
    "minelink.tool_execute",
    {
      description: "Execute a lazy game capability tool through MineLink Protocol.",
      inputSchema: ToolExecuteArgsSchema
    },
    async (args) => jsonText(await controller.toolExecute(args))
  );

  return server;
}

export async function startMcpServer(controller = new HostController()): Promise<void> {
  const server = createMineLinkMcpServer(controller);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
