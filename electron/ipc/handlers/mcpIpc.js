import {
  BrowserWindow,
  ipcMain
} from "electron";

import IPC_CHANNELS from "../../shared/ipcChannels.cjs";

import {
  getSettings
} from "../../settings/settingsStore.js";

import {
  mcpClientManager
} from "../../mcp/index.js";

import {
  clearMcpSecret,
  getMcpSecretStatus,
  listMcpSecretStatuses,
  setMcpSecret
} from "../../mcp/mcpCredentialStore.js";

import {
  isSettingSender
} from "../../windows/setting/settingWindow.js";

function assertSettingSender(event) {
  if (!isSettingSender(event.sender)) {
    throw new Error("Only the Setting window can manage MCP servers.");
  }
}

function currentServer(serverId) {
  return (getSettings().mcp?.servers ?? []).find(
    (server) => server.id === String(serverId ?? "")
  ) ?? null;
}

function stateWithCredentials() {
  const settings = getSettings();
  const state = mcpClientManager.snapshot();
  return {
    ...state,
    servers: state.servers.map((item) => {
      const server = (settings.mcp?.servers ?? []).find(
        (candidate) => candidate.id === item.id
      );
      return {
        ...item,
        credentialStatuses: server
          ? listMcpSecretStatuses(server)
          : []
      };
    })
  };
}

function broadcastState() {
  const state = stateWithCredentials();
  for (const window of BrowserWindow.getAllWindows()) {
    if (
      window.isDestroyed() ||
      window.webContents.isDestroyed() ||
      !isSettingSender(window.webContents)
    ) {
      continue;
    }
    window.webContents.send(
      IPC_CHANNELS.mcp.CHANGED,
      state
    );
  }
}

let changeListenerInstalled = false;

export function registerMcpIpc() {
  if (!changeListenerInstalled) {
    changeListenerInstalled = true;
    mcpClientManager.on("changed", broadcastState);
  }

  ipcMain.handle(
    IPC_CHANNELS.mcp.GET_STATE,
    (event) => {
      assertSettingSender(event);
      mcpClientManager.syncSettings(getSettings());
      return stateWithCredentials();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.mcp.CONNECT,
    async (event, request = {}) => {
      assertSettingSender(event);
      mcpClientManager.syncSettings(getSettings());
      const server = await mcpClientManager.connectServer(request.serverId, {
        force: request.force === true
      });
      return {
        ok: true,
        server,
        state: stateWithCredentials()
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.mcp.DISCONNECT,
    async (event, request = {}) => {
      assertSettingSender(event);
      const server = await mcpClientManager.disconnectServer(request.serverId);
      return {
        ok: true,
        server,
        state: stateWithCredentials()
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.mcp.REFRESH,
    async (event, request = {}) => {
      assertSettingSender(event);
      mcpClientManager.syncSettings(getSettings());
      const server = await mcpClientManager.refreshServer(request.serverId);
      return {
        ok: true,
        server,
        state: stateWithCredentials()
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.mcp.PING,
    async (event, request = {}) => {
      assertSettingSender(event);
      mcpClientManager.syncSettings(getSettings());
      const result = await mcpClientManager.pingServer(request.serverId);
      return {
        ...result,
        state: stateWithCredentials()
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.mcp.GET_SECRET_STATUS,
    (event, request = {}) => {
      assertSettingSender(event);
      return getMcpSecretStatus(request.serverId, request.envName);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.mcp.SET_SECRET,
    async (event, request = {}) => {
      assertSettingSender(event);
      const server = currentServer(request.serverId);
      if (!server || !(server.secretEnvKeys ?? []).includes(String(request.envName ?? "").toUpperCase())) {
        throw new Error("该环境变量未被当前 MCP Server 声明为凭据。");
      }
      const status = setMcpSecret(
        request.serverId,
        request.envName,
        request.value
      );
      await mcpClientManager.disconnectServer(request.serverId, { forgetTools: false });
      broadcastState();
      return status;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.mcp.CLEAR_SECRET,
    async (event, request = {}) => {
      assertSettingSender(event);
      const status = clearMcpSecret(request.serverId, request.envName);
      await mcpClientManager.disconnectServer(request.serverId, { forgetTools: false });
      broadcastState();
      return status;
    }
  );
}
