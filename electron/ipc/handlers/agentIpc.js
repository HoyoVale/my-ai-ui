import {
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  agentRuntime
} from "../../agent/AgentRuntime.js";

import {
  normalizeAgentMessageRequest
} from "../../agent/messageTarget.js";

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

function requireConversationSender(event) {
  if (!isConversationSender(event.sender)) {
    throw new Error(
      "Only the Conversation window can manage Tool Runtime recovery."
    );
  }
}

export function registerAgentIpc() {
  ipcMain.handle(
    IPC_CHANNELS
      .agent
      .SEND_MESSAGE,
    (event, input) => {
      requireInputSender(event);

      const request =
        normalizeAgentMessageRequest(input);

      return agentRuntime
        .startMessage(
          request.content,
          {
            expectedConversationId:
              request.expectedConversationId,
            continueTask:
              request.continueTask
          }
        );
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
    IPC_CHANNELS.agent.GET_SNAPSHOT,
    (event) => {
      return agentRuntime.getSnapshotForWebContents(event.sender);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.GET_RUN_DETAILS,
    (event, request = {}) => {
      requireConversationSender(event);
      return agentRuntime.getDeveloperRunDetails(request);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.GET_RUNTIME_RECOVERY,
    (event, request = {}) => {
      requireConversationSender(event);
      return agentRuntime.getToolRuntimeRecovery(request);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.RESOLVE_RUNTIME_RECOVERY,
    (event, request = {}) => {
      requireConversationSender(event);
      return agentRuntime.resolveToolRuntimeRecovery(request);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.GET_RUNTIME_RECOVERY_HISTORY,
    (event) => {
      requireConversationSender(event);
      return agentRuntime.getRuntimeRecoveryHistory();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.GET_CIRCUIT_BREAKERS,
    (event) => {
      requireSettingSender(event);
      return agentRuntime.getCircuitBreakers();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.RESET_CIRCUIT_BREAKER,
    (event, request = {}) => {
      requireSettingSender(event);
      return agentRuntime.resetCircuitBreaker(request);
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
