import {
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  longRunningAgentService,
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

  ipcMain.handle(
    IPC_CHANNELS.platform.RESOLVE_APPROVAL,
    (event, request = {}) => {
      requireConversationSender(event);
      return longRunningAgentService.resolveApproval(
        String(request.approvalId ?? ""),
        String(request.decision ?? ""),
        { note: String(request.note ?? "") }
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.platform.PROVIDE_INPUT,
    (event, request = {}) => {
      requireConversationSender(event);
      return longRunningAgentService.provideInput(
        String(request.jobId ?? ""),
        request.value ?? ""
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.platform.SIGNAL_EXTERNAL,
    (event, request = {}) => {
      requireConversationSender(event);
      return longRunningAgentService.signalExternal(
        String(request.jobId ?? ""),
        {
          key: String(request.key ?? ""),
          payload: request.payload && typeof request.payload === "object"
            ? request.payload
            : null
        }
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.platform.CONTROL_NOTIFICATION,
    (event, request = {}) => {
      requireConversationSender(event);
      const notificationId = String(request.notificationId ?? "");
      return String(request.action ?? "") === "clear"
        ? platformKernel.clearNotification(notificationId)
        : platformKernel.markNotificationRead(notificationId);
    }
  );

}
