import {
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  platformKernel
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
      return platformKernel.getSnapshot();
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
}
