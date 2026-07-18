import {
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  agentRuntime
} from "../../agent/AgentRuntime.js";

import {
  clearProviderApiKey,
  getProviderCredentialStatus,
  setProviderApiKey
} from "../../agent/credentialStore.js";

import {
  isInputSender
} from "../../windows/input/inputWindow.js";

import {
  isSettingSender
} from "../../windows/setting/settingWindow.js";

import {
  isConversationSender
} from "../../windows/conversation/conversationWindow.js";

function requireInputSender(
  event
) {
  if (
    !isInputSender(
      event.sender
    )
  ) {
    throw new Error(
      "Only the Input window can send agent messages."
    );
  }
}

function requireConversationSender(
  event
) {
  if (
    !isConversationSender(
      event.sender
    )
  ) {
    throw new Error(
      "Only the Conversation window can answer agent questions."
    );
  }
}

function requireSettingSender(
  event
) {
  if (
    !isSettingSender(
      event.sender
    )
  ) {
    throw new Error(
      "Only the Setting window can manage model credentials."
    );
  }
}

export function registerAgentIpc() {
  ipcMain.handle(
    IPC_CHANNELS
      .agent
      .SEND_MESSAGE,
    (event, content) => {
      requireInputSender(event);

      return agentRuntime
        .startMessage(content);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .agent
      .RESUME_QUESTION,
    (event, response = {}) => {
      requireConversationSender(event);

      return agentRuntime
        .resumeQuestion(response);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .agent
      .STOP,
    (event) => {
      requireInputSender(event);

      return agentRuntime.stop();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .agent
      .GET_STATUS,
    () => {
      return agentRuntime
        .getStatus();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .agent
      .GET_CREDENTIAL_STATUS,
    (event, descriptor = {}) => {
      requireSettingSender(event);

      return getProviderCredentialStatus(
        descriptor
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .agent
      .SET_API_KEY,
    (event, descriptor = {}) => {
      requireSettingSender(event);

      return setProviderApiKey(
        descriptor.providerId,
        descriptor.apiKey,
        descriptor.environmentKey
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .agent
      .CLEAR_API_KEY,
    (event, descriptor = {}) => {
      requireSettingSender(event);

      return clearProviderApiKey(
        descriptor.providerId,
        descriptor.environmentKey
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .agent
      .TEST_CONNECTION,
    (event, modelSettings) => {
      requireSettingSender(event);

      return agentRuntime
        .testConnection(
          modelSettings
        );
    }
  );
}
