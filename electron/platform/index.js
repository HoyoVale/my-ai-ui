import {
  app,
  BrowserWindow
} from "electron";

import path from "node:path";

import IPC_CHANNELS
  from "../shared/ipcChannels.cjs";

import {
  PlatformKernel
} from "./PlatformKernel.js";

import {
  WorktreeRuntime
} from "./WorktreeRuntime.js";

import {
  ModelWorkerRuntime
} from "./ModelWorkerRuntime.js";

import {
  MultiAgentSupervisor
} from "./MultiAgentSupervisor.js";

import {
  getSettings
} from "../settings/settingsStore.js";

import {
  getWorkspaceById
} from "../workspace/workspaceRegistry.js";

function broadcastPlatformState(state) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (
      window.isDestroyed() ||
      window.webContents.isDestroyed()
    ) {
      continue;
    }
    window.webContents.send(
      IPC_CHANNELS.platform.CHANGED,
      state
    );
  }
}

export const platformKernel = new PlatformKernel({
  getStorageDirectory: () => path.join(
    app.getPath("userData"),
    "platform"
  ),
  onChange: broadcastPlatformState
});

export const completionAuthority = platformKernel.completionAuthority;

export const worktreeRuntime = new WorktreeRuntime({
  getStorageDirectory: () => path.join(
    app.getPath("userData"),
    "platform",
    "worktrees"
  ),
  platformKernel
});

export const modelWorkerRuntime = new ModelWorkerRuntime({
  getSettings,
  getResultDirectory: (platformRunId, agentRunId) => path.join(
    app.getPath("userData"),
    "platform",
    "worker-results",
    String(platformRunId),
    String(agentRunId)
  )
});

export const multiAgentSupervisor = new MultiAgentSupervisor({
  platformKernel,
  worktreeRuntime,
  workerRuntime: modelWorkerRuntime,
  getWorkspaceRoot: (run) => {
    const workspace = getWorkspaceById(run?.workspaceId, getSettings());
    return workspace && !workspace.missing
      ? workspace.canonicalPath || workspace.rootPath
      : "";
  },
  maxConcurrency: 2,
  getMaxConcurrency: () =>
    getSettings().model?.runtimeAssignments?.maxConcurrency ?? 2
});
