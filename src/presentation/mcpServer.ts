import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectTools } from "./tools/projectTools.js";
import { registerMemoryTools } from "./tools/memoryTools.js";
import { registerEntityTools } from "./tools/entityTools.js";
import { registerFlowTools } from "./tools/flowTools.js";
import { registerEnterpriseTools } from "./tools/enterpriseTools.js";
import { registerSystemTools } from "./tools/systemTools.js";

export function registerTools(server: McpServer) {
  registerProjectTools(server);
  registerMemoryTools(server);
  registerEntityTools(server);
  registerFlowTools(server);
  registerEnterpriseTools(server);
  registerSystemTools(server);
}

// MCP SDK requires a single server instance; tools are registered before transport.start().
export const server = new McpServer(
  {
    name: "CodeAtlas",
    version: "2.2.3",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      logging: {},
    },
  }
);

registerTools(server);
