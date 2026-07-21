import {
  dialog,
  ipcMain
} from "electron";

import IPC_CHANNELS from "../../shared/ipcChannels.cjs";

import {
  getSettings
} from "../../settings/settingsStore.js";

import {
  conversationManager
} from "../../conversation/index.js";

import {
  resolveConversationExecutionContext
} from "../../conversation/executionContext.js";

import {
  runSkillRuntimeTests,
  skillRegistry
} from "../../skills/index.js";

import {
  getSettingWindow,
  isSettingSender
} from "../../windows/setting/settingWindow.js";

function requireSettingSender(event) {
  if (!isSettingSender(event.sender)) {
    throw new Error("Only the Setting window can manage Skills.");
  }
}

function developerMode() {
  return getSettings().general.developerMode === true;
}

function state() {
  return skillRegistry.getState({ developerMode: developerMode() });
}

function showOpenDialog(options) {
  const parent = getSettingWindow();
  return parent
    ? dialog.showOpenDialog(parent, options)
    : dialog.showOpenDialog(options);
}

export function registerSkillIpc() {
  ipcMain.handle(
    IPC_CHANNELS.skills.GET_STATE,
    (event) => {
      requireSettingSender(event);
      return state();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.skills.GET,
    (event, skillId) => {
      requireSettingSender(event);
      return skillRegistry.get(String(skillId ?? ""), {
        developerMode: developerMode()
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.skills.GET_RUNTIME_STATE,
    (_event, input = {}) => {
      return skillRegistry.getRuntimeState({
        mode: String(input.mode ?? "")
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.skills.TEST_RUNTIME,
    (event, input = {}) => {
      requireSettingSender(event);
      const conversation = conversationManager.getCurrentConversation();
      const execution = resolveConversationExecutionContext({
        settings: getSettings(),
        conversation
      });
      return runSkillRuntimeTests({
        registry: skillRegistry,
        skillId: String(input.skillId ?? ""),
        settings: execution.settings,
        conversation: execution.conversation
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.skills.IMPORT_DIRECTORY,
    async (event) => {
      requireSettingSender(event);
      const result = await showOpenDialog({
        title: "选择 Skill 文件夹",
        properties: ["openDirectory", "dontAddToRecent"]
      });
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false, canceled: true, state: state() };
      }
      const installed = skillRegistry.installFromDirectory(result.filePaths[0]);
      return { ...installed, state: state() };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.skills.IMPORT_ZIP,
    async (event) => {
      requireSettingSender(event);
      const result = await showOpenDialog({
        title: "选择 Skill ZIP",
        properties: ["openFile", "dontAddToRecent"],
        filters: [{ name: "Skill ZIP", extensions: ["zip"] }]
      });
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false, canceled: true, state: state() };
      }
      const installed = skillRegistry.installFromZip(result.filePaths[0]);
      return { ...installed, state: state() };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.skills.SET_ENABLED,
    (event, input = {}) => {
      requireSettingSender(event);
      const result = skillRegistry.setEnabled(
        String(input.skillId ?? ""),
        input.enabled === true
      );
      return { ...result, state: state() };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.skills.UNINSTALL,
    (event, skillId) => {
      requireSettingSender(event);
      const result = skillRegistry.uninstall(String(skillId ?? ""));
      return { ...result, state: state() };
    }
  );
}
