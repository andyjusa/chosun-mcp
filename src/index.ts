import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerChosunTools } from "./tools/chosun.js";

const server = new McpServer({
  name: "chosun-mcp",
  version: "0.1.0",
});

registerChosunTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("chosun-mcp MCP server running on stdio");
}

main().catch((error: unknown) => {
  console.error("Fatal error starting MCP server:", error);
  process.exit(1);
});
