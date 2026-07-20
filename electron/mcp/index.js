import {
  mcpClientManager
} from "./McpClientManager.js";

import {
  getMcpServerSecretEnvironment
} from "./mcpCredentialStore.js";

mcpClientManager.setCredentialProvider(
  async (server) => getMcpServerSecretEnvironment(server)
);

export {
  mcpClientManager
};
