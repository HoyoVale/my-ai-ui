import {
  mcpClientManager
} from "./McpClientManager.js";

import {
  getMcpServerSecretEnvironment
} from "./mcpCredentialStore.js";

import {
  createMcpOAuthFlow
} from "./McpOAuthFlow.js";

mcpClientManager.setCredentialProvider(
  async (server) => getMcpServerSecretEnvironment(server)
);

mcpClientManager.setOAuthFlowFactory(
  (options) => createMcpOAuthFlow(options)
);

export {
  mcpClientManager
};
