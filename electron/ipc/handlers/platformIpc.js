import {
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  platformKernel,
  platformJobScheduler,
  worktreeRuntime
} from "../../platform/index.js";

import {
  isConversationSender
} from "../../windows/conversation/conversationWindow.js";

function requireConversationSender(event) {
  if (!isConversationSender(event.sender)) {
    throw new Error(
      "Only the Conversation window can inspect Platform runs."
    );
  }
}

export function registerPlatformIpc() {
  ipcMain.handle(
    IPC_CHANNELS.platform.GET_STATE,
    (event) => {
      requireConversationSender(event);
      return {
        ...platformKernel.getSnapshot(),
        worktrees: worktreeRuntime.getSnapshot().worktrees
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.platform.GET_RUN,
    (event, request = {}) => {
      requireConversationSender(event);
      return platformKernel.getRun(
        String(request.platformRunId ?? "")
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.platform.CONTROL_JOB,
    (event, request = {}) => {
      requireConversationSender(event);
      const jobId = String(request.jobId ?? "");
      const actions = {
        pause: () => platformJobScheduler.pause(jobId),
        resume: () => platformJobScheduler.resume(jobId),
        cancel: () => platformJobScheduler.cancel(jobId),
        retry: () => platformJobScheduler.retry(jobId)
      };
      return actions[String(request.action ?? "")]?.() ?? {
        ok: false,
        code: "platform-job-action-invalid"
      };
    }
  );
}
