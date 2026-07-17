import {
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  agentRuntime
} from "../../agent/AgentRuntime.js";

import {
  conversationManager
} from "../../conversation/index.js";

import {
  clearResponseWindow
} from "../../windows/response/index.js";

import {
  openConversationWindow
} from "../../windows/conversation/conversationWindow.js";

import {
  inspectConversationContext
} from "../../context/contextInspector.js";

function isAgentBusy() {
  const state =
    agentRuntime
      .getStatus()
      .state;

  return (
    state === "running" ||
    state === "stopping"
  );
}

function rejectWhenBusy() {
  if (!isAgentBusy()) {
    return null;
  }

  return {
    ok: false,
    code: "agent-busy",
    message:
      "请先等待当前回复结束，或停止生成。"
  };
}

export function registerConversationIpc() {
  ipcMain.on(
    IPC_CHANNELS
      .navigation
      .OPEN_CONVERSATION,
    () => {
      openConversationWindow();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .conversation
      .GET_STATE,
    () => {
      return conversationManager
        .getState();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .conversation
      .GET,
    (_event, id) => {
      return conversationManager
        .getConversation(
          String(id ?? "")
        );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .conversation
      .LIST,
    () => {
      return conversationManager
        .list();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .conversation
      .CREATE,
    () => {
      const busy =
        rejectWhenBusy();

      if (busy) {
        return busy;
      }

      const conversation =
        conversationManager
          .create();

      clearResponseWindow();

      return {
        ok: true,
        conversation
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .conversation
      .SELECT,
    (_event, id) => {
      const busy =
        rejectWhenBusy();

      if (busy) {
        return busy;
      }

      const result =
        conversationManager
          .select(
            String(id ?? "")
          );

      if (result.ok) {
        clearResponseWindow();
      }

      return result;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .conversation
      .DELETE,
    (_event, id) => {
      const busy =
        rejectWhenBusy();

      if (busy) {
        return busy;
      }

      const result =
        conversationManager
          .delete(
            String(id ?? "")
          );

      if (result.ok) {
        clearResponseWindow();
      }

      return result;
    }
  );


  ipcMain.handle(
    IPC_CHANNELS
      .conversation
      .RESET_CONTEXT,
    (_event, conversationId) => {
      const busy =
        rejectWhenBusy();

      if (busy) {
        return busy;
      }

      return conversationManager
        .resetContext(
          String(
            conversationId ?? ""
          )
        );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .conversation
      .UPDATE_MESSAGE_CONTEXT,
    (_event, input = {}) => {
      const busy =
        rejectWhenBusy();

      if (busy) {
        return busy;
      }

      return conversationManager
        .updateMessageContext({
          conversationId:
            String(
              input.conversationId ?? ""
            ),
          messageId:
            String(
              input.messageId ?? ""
            ),
          includeInContext:
            input.includeInContext,
          pinnedToContext:
            input.pinnedToContext
        });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .conversation
      .REGENERATE_MESSAGE,
    (_event, input = {}) => {
      return agentRuntime
        .regenerateMessage({
          conversationId:
            String(
              input.conversationId ?? ""
            ),
          messageId:
            String(
              input.messageId ?? ""
            )
        });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .conversation
      .INSPECT_CONTEXT,
    (_event, conversationId) => {
      return inspectConversationContext(
        String(
          conversationId ?? ""
        )
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .conversation
      .CLEAR,
    () => {
      const busy =
        rejectWhenBusy();

      if (busy) {
        return busy;
      }

      const result =
        conversationManager
          .clearAll();

      clearResponseWindow();

      return result;
    }
  );
}
