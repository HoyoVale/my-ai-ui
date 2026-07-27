import * as internals from "../ConversationManagerInternals.js";

import {
  projectConversationForRead,
  projectMessageForRead
} from "../conversationSchema.js";

function messageTaskId(message) {
  return String(
    message?.metadata?.taskId ??
    message?.activity?.taskId ??
    ""
  ).trim();
}

export const ConversationToolRecoveryService = {
  getTaskRuntimeRecord(taskId) {
    const normalizedTaskId = String(taskId ?? "").trim();
    if (!normalizedTaskId) {
      return null;
    }
  
    const data = this.ensureLoaded();
    let latest = null;
    for (const conversation of data.conversations) {
      for (const message of conversation.messages) {
        if (
          message.role !== "assistant" ||
          messageTaskId(message) !== normalizedTaskId
        ) {
          continue;
        }
  
        const updatedAt = Math.max(
          Number(message.activity?.checkpoint?.updatedAt ?? 0),
          Number(message.activity?.endedAt ?? 0),
          Number(message.createdAt ?? 0)
        );
        if (!latest || updatedAt >= latest.updatedAt) {
          latest = { conversation, message, updatedAt };
        }
      }
    }
  
    return latest
      ? {
          conversation: projectConversationForRead(latest.conversation),
          message: projectMessageForRead(latest.message)
        }
      : null;
  },

  listToolRuntimeRecoveryHistory() {
    const data = this.ensureLoaded();
    const byTask = new Map();
  
    for (const conversation of data.conversations) {
      for (const message of conversation.messages) {
        if (message.role !== "assistant" || !messageTaskId(message)) {
          continue;
        }
  
        const recovery =
          message.activity?.checkpoint?.toolRuntime ??
          message.toolRuntime ??
          null;
        if (!recovery || typeof recovery !== "object") {
          continue;
        }
  
        const calls = Array.isArray(recovery.calls)
          ? recovery.calls
          : [];
        if (calls.length === 0 && !recovery.unresolvedCount) {
          continue;
        }
  
        const updatedAt = Math.max(
          Number(message.activity?.checkpoint?.updatedAt ?? 0),
          Number(message.activity?.endedAt ?? 0),
          Number(message.createdAt ?? 0)
        );
        const taskId = messageTaskId(message);
        const previous = byTask.get(taskId);
        if (previous && previous.updatedAt > updatedAt) {
          continue;
        }
  
        const checkpoint =
          message.activity?.checkpoint &&
          typeof message.activity.checkpoint === "object"
            ? message.activity.checkpoint
            : null;
  
        byTask.set(taskId, {
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          mode: checkpoint?.mode === "coding"
            ? "coding"
            : conversation.mode === "coding"
              ? "coding"
              : "chat",
          workspaceId:
            checkpoint?.workspaceId ?? conversation.workspaceId ?? null,
          workspaceName:
            checkpoint?.workspaceSnapshot?.name ??
            conversation.workspaceSnapshot?.name ??
            null,
          messageId: message.id,
          taskId,
          runId: String(message.activity?.runId ?? ""),
          messageStatus: String(message.status ?? ""),
          stopReason: String(message.stopReason ?? ""),
          updatedAt,
          recovery: internals.clone(recovery)
        });
      }
    }
  
    const items = [...byTask.values()];
    items.sort((left, right) => {
      const unresolvedDifference =
        Number(right.recovery?.unresolvedCount ?? 0) -
        Number(left.recovery?.unresolvedCount ?? 0);
      return unresolvedDifference || right.updatedAt - left.updatedAt;
    });
  
    return {
      version: 1,
      unresolvedCount: items.reduce(
        (total, item) =>
          total + Number(item.recovery?.unresolvedCount ?? 0),
        0
      ),
      taskCount: items.length,
      items: internals.clone(items)
    };
  },

  updateToolRuntimeRecovery({
    taskId,
    recovery
  } = {}) {
    const normalizedTaskId = String(taskId ?? "").trim();
    if (!normalizedTaskId || !recovery || typeof recovery !== "object") {
      return {
        ok: false,
        code: "invalid-runtime-recovery",
        message: "工具恢复状态无效。"
      };
    }
  
    const data = this.ensureLoaded();
    let target = null;
  
    for (const conversation of data.conversations) {
      for (const message of conversation.messages) {
        if (
          message.role !== "assistant" ||
          messageTaskId(message) !== normalizedTaskId
        ) {
          continue;
        }
        const updatedAt = Math.max(
          Number(message.activity?.checkpoint?.updatedAt ?? 0),
          Number(message.activity?.endedAt ?? 0),
          Number(message.createdAt ?? 0)
        );
        if (!target || updatedAt >= target.updatedAt) {
          target = { conversation, message, updatedAt };
        }
      }
    }
  
    const updatedMessage = target?.message ?? null;
    if (target) {
      const timestamp = this.now();
      updatedMessage.activity = {
        ...(updatedMessage.activity ?? {}),
        checkpoint: {
          ...(updatedMessage.activity?.checkpoint ?? {}),
          toolRuntime: internals.clone(recovery),
          updatedAt: timestamp
        }
      };
      target.conversation.updatedAt = timestamp;
    }
  
    if (!updatedMessage) {
      return {
        ok: false,
        code: "task-message-not-found",
        message: "找不到该任务对应的会话记录。"
      };
    }
  
    this.commit();
    return {
      ok: true,
      message: projectMessageForRead(updatedMessage)
    };
  }
};
