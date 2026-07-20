import {
  McpConnectionManager
} from "./McpConnectionManager.js";

export class McpClientManager extends McpConnectionManager {}

export const mcpClientManager = new McpClientManager();
