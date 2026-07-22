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

import {
  resolveSkillRuntime,
  skillRegistry
} from "../../skills/index.js";

function isAgentBusy() {
  const state =
    agentRuntime
      .getStatus()
      .state;

  return (
    state === "running" ||
    ["stopping", "cancelling"].includes(state)
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
    (_event, input = {}) => {
      const busy =
        rejectWhenBusy();

      if (busy) {
        return busy;
      }

      let conversation;

      try {
        const mode = input.mode === "coding" ? "coding" : "chat";
        const requestedSkillIds = [
          ...new Set(
            (Array.isArray(input.skillIds)
              ? input.skillIds
              : input.skillId == null
                ? []
                : [input.skillId])
              .map((value) => String(value ?? "").trim())
              .filter(Boolean)
          )
        ].slice(0, 4);
        const runtimeSkill = requestedSkillIds.length
          ? resolveSkillRuntime({
              registry: skillRegistry,
              skillIds: requestedSkillIds,
              mode,
              source: "manual"
            })
          : { ok: true, active: false, skill: null, skills: [], rootSkillIds: [] };
        if (!runtimeSkill.ok) {
          return runtimeSkill;
        }

        conversation = conversationManager.create({
          mode: input.mode || undefined,
          workspaceId:
            input.workspaceId === null
              ? null
              : input.workspaceId || undefined,
          modelSelection:
            input.modelSelection && typeof input.modelSelection === "object"
              ? input.modelSelection
              : undefined,
          skillId: runtimeSkill.skill?.id ?? null,
          skillSnapshot: runtimeSkill.skill ?? null,
          skillIds: runtimeSkill.rootSkillIds ?? [],
          skillSnapshots: runtimeSkill.skills ?? [],
          skillRoutingMode: input.skillRoutingMode === "auto" ? "auto" : "manual"
        });
      } catch (error) {
        return {
          ok: false,
          code: error?.code ?? "conversation-create-failed",
          message: error instanceof Error
            ? error.message
            : "无法创建会话。"
        };
      }

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
      .SWITCH_WORKSPACE,
    (_event, workspaceId) => {
      const busy =
        rejectWhenBusy();

      if (busy) {
        return busy;
      }

      const result =
        conversationManager
          .switchWorkspace(
            workspaceId === null
              ? null
              : String(workspaceId ?? "")
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
      .NAVIGATE_CONTEXT,
    (_event, input = {}) => {
      const busy =
        rejectWhenBusy();

      if (busy) {
        return busy;
      }

      const result = conversationManager.navigateContext({
        mode: String(input.mode ?? ""),
        workspaceId: input.workspaceId === undefined
          ? undefined
          : input.workspaceId === null
            ? null
            : String(input.workspaceId ?? "")
      });

      if (result.ok) {
        clearResponseWindow();
      }

      return result;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .conversation
      .SET_MODEL,
    (_event, input = {}) => {
      const busy =
        rejectWhenBusy();

      if (busy) {
        return busy;
      }

      return conversationManager.setModelSelection({
        conversationId: String(input.conversationId ?? ""),
        providerId: String(input.providerId ?? ""),
        modelConfigId: String(input.modelConfigId ?? "")
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversation.SET_SKILL,
    (_event, input = {}) => {
      const busy = rejectWhenBusy();
      if (busy) return busy;

      const conversation = conversationManager.getConversation(
        String(input.conversationId ?? "") ||
        conversationManager.getState().currentConversationId
      );
      if (!conversation) {
        return { ok: false, code: "conversation-not-found", message: "会话不存在。" };
      }

      const skillIds = [
        ...new Set(
          (Array.isArray(input.skillIds)
            ? input.skillIds
            : input.skillId == null
              ? []
              : [input.skillId])
            .map((value) => String(value ?? "").trim())
            .filter(Boolean)
        )
      ].slice(0, 4);
      const routingMode = input.skillRoutingMode === "auto" ? "auto" : "manual";
      if (!skillIds.length) {
        return conversationManager.setSkillSelection({
          conversationId: conversation.id,
          skills: [],
          skillIds: [],
          skillRoutingMode: routingMode
        });
      }

      const runtimeSkill = resolveSkillRuntime({
        registry: skillRegistry,
        skillIds,
        mode: conversation.mode,
        source: "manual"
      });
      if (!runtimeSkill.ok) return runtimeSkill;

      return conversationManager.setSkillSelection({
        conversationId: conversation.id,
        skills: runtimeSkill.skills,
        skillIds: runtimeSkill.rootSkillIds,
        skillRoutingMode: routingMode
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversation.SET_GOAL,
    (_event, input = {}) => {
      const busy = rejectWhenBusy();
      if (busy) return busy;

      return conversationManager.setGoal({
        conversationId: String(input.conversationId ?? ""),
        objective: String(input.objective ?? ""),
        criteria: Array.isArray(input.criteria) ? input.criteria : [],
        autoContinue: input.autoContinue !== false,
        status: String(input.status ?? "active")
      });
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
      .RENAME,
    (_event, input = {}) => {
      const busy =
        rejectWhenBusy();

      if (busy) {
        return busy;
      }

      return conversationManager
        .rename({
          conversationId:
            String(
              input.conversationId ?? ""
            ),
          title:
            String(
              input.title ?? ""
            )
        });
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
