import fs from "node:fs/promises";

import {
  BrowserWindow,
  dialog,
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
  getMcpAuthenticationStatus,
  getMcpSecretStatus,
  listMcpSecretStatuses,
  setMcpSecret
} from "../../mcp/mcpCredentialStore.js";

import {
  clearMcpOAuthCredentials
} from "../../mcp/McpOAuthFlow.js";

import {
  exportMcpConfiguration,
  importMcpConfiguration
} from "../../mcp/McpConfigPortability.js";

import {
  isSettingSender
} from "../../windows/setting/settingWindow.js";

const MAX_MCP_CONFIG_FILE_BYTES = 2 * 1024 * 1024;

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
  const developerMode = settings.general?.developerMode === true;
  const state = mcpClientManager.snapshot();
  return {
    ...state,
    servers: state.servers.map((item) => {
      const server = (settings.mcp?.servers ?? []).find(
        (candidate) => candidate.id === item.id
      );
      return {
        ...item,
        pid: developerMode ? item.pid : null,
        serverInfo: developerMode ? item.serverInfo : null,
        capabilities: developerMode ? item.capabilities : null,
        instructions: developerMode ? item.instructions : "",
        logs: developerMode ? item.logs : [],
        security: developerMode ? item.security : null,
        credentialStatuses: server
          ? listMcpSecretStatuses(server)
          : [],
        authentication: server
          ? getMcpAuthenticationStatus(server)
          : { mode: "none", configured: true, signedIn: true }
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
    IPC_CHANNELS.mcp.IMPORT_CONFIG,
    async (event) => {
      assertSettingSender(event);
      const owner = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(owner ?? undefined, {
        title: "导入 MCP 配置",
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false, canceled: true, servers: [], warnings: [] };
      }
      const filePath = result.filePaths[0];
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_MCP_CONFIG_FILE_BYTES) {
        throw new Error("MCP 配置文件必须是小于 2 MB 的 JSON 文件。");
      }
      const text = await fs.readFile(filePath, "utf8");
      const payload = JSON.parse(text);
      return { ok: true, canceled: false, ...importMcpConfiguration(payload) };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.mcp.EXPORT_CONFIG,
    async (event) => {
      assertSettingSender(event);
      const owner = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(owner ?? undefined, {
        title: "导出 MCP 备份",
        defaultPath: "my-ai-ui-mcp-backup.json",
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true };
      }
      const payload = exportMcpConfiguration(getSettings());
      await fs.writeFile(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
      return { ok: true, canceled: false };
    }
  );


  ipcMain.handle(
    IPC_CHANNELS.mcp.CLEAR_AUTH,
    async (event, request = {}) => {
      assertSettingSender(event);
      const server = currentServer(request.serverId);
      if (!server) {
        throw new Error("MCP Server 不存在。");
      }
      clearMcpOAuthCredentials(server.id);
      if ((server.secretEnvKeys ?? []).includes("MCP_REMOTE_TOKEN")) {
        clearMcpSecret(server.id, "MCP_REMOTE_TOKEN");
      }
      await mcpClientManager.disconnectServer(server.id, { forgetTools: false });
      broadcastState();
      return {
        ok: true,
        state: stateWithCredentials()
      };
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
