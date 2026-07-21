import {
  app,
  BrowserWindow
} from "electron";

import path from "node:path";

import IPC_CHANNELS from "../shared/ipcChannels.cjs";

import {
  SkillRegistry
} from "./SkillRegistry.js";

import {
  SkillStore
} from "./SkillStore.js";

function skillRoot() {
  return path.join(app.getPath("userData"), "skills");
}

function broadcastState(state) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send(IPC_CHANNELS.skills.CHANGED, state);
  }
}

const store = new SkillStore({
  getFilePath: () => path.join(skillRoot(), "registry.json")
});

export const skillRegistry = new SkillRegistry({
  store,
  getRootDirectory: skillRoot,
  onChange: broadcastState
});

export function getSkillRootPath() {
  return skillRoot();
}

export {
  resolveSkillRuntime,
  buildSkillPrompt,
  skillPermissionEnvelope,
  skillSupportsMode
} from "./SkillRuntime.js";

export {
  runSkillRuntimeTests
} from "./SkillTestRunner.js";
