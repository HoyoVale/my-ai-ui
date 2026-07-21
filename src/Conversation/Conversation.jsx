import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import {
  ConversationContextInspector
} from "./components/ContextInspector.jsx";

import {
  ConversationMessageList
} from "./components/MessageList.jsx";

import {
  ConversationPlanDock
} from "./components/PlanDock.jsx";

import {
  ConversationRecoveryPanel
} from "./components/RecoveryPanel.jsx";

import {
  ConversationTaskPanel
} from "./components/TaskPanel.jsx";

import {
  ToolApprovalPanel
} from "./components/ToolApprovalPanel.jsx";

import {
  ConversationSidebar
} from "./components/Sidebar.jsx";

import {
  ConversationTopbar
} from "./components/Topbar.jsx";

import {
  useConversationHistory
} from "./hooks/useConversationHistory.js";

import {
  useWindowMaximized
} from "./hooks/useWindowMaximized.js";

import {
  useAppSettings
} from "../shared/hooks/useAppSettings.js";

import {
  useResolvedTheme
} from "../shared/hooks/useResolvedTheme.js";

import {
  useAgentStatus
} from "../shared/hooks/useAgentStatus.js";

import {
  getWindowTypographyStyle
} from "../shared/typography.js";

import "./Conversation.css";

export default function Conversation() {
  const settings =
    useAppSettings();

  const theme =
    useResolvedTheme(
      settings
        .appearance
        .theme
    );

  const developerMode =
    settings.general?.developerMode === true;

  const isMaximized =
    useWindowMaximized();

  const history =
    useConversationHistory();

  const {
    status: agentStatus
  } = useAgentStatus();

  const [
    sidebarCollapsed,
    setSidebarCollapsed
  ] = useState(false);

  const [
    contextOpen,
    setContextOpen
  ] = useState(false);

  const [
    taskOpen,
    setTaskOpen
  ] = useState(false);

  const [
    recoveryOpen,
    setRecoveryOpen
  ] = useState(false);

  const [recoveryHistory, setRecoveryHistory] = useState(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState("");
  const [recoveryError, setRecoveryError] = useState("");

  const [
    taskTargetMessageId,
    setTaskTargetMessageId
  ] = useState(null);

  const [query, setQuery] =
    useState("");

  const [sidebarMode, setSidebarMode] =
    useState("chat");

  const workspaces =
    Array.isArray(settings.workspaces?.items)
      ? settings.workspaces.items
      : [];

  const currentConversationId =
    history.current?.id ?? "";

  const currentLiveActivity =
    agentStatus.conversationId ===
      history.current?.id &&
    ["running", "stopping", "cancelling"].includes(
      agentStatus.state
    )
      ? agentStatus
      : null;

  useEffect(() => {
    if (history.current?.mode) {
      setSidebarMode(
        history.current.mode === "coding"
          ? "coding"
          : "chat"
      );
    }
  }, [history.current?.id, history.current?.mode]);

  useEffect(() => {
    setTaskOpen(false);
    setTaskTargetMessageId(null);
  }, [
    currentConversationId
  ]);

  const refreshRecoveryHistory = useCallback(async () => {
    if (!developerMode) {
      setRecoveryHistory(null);
      setRecoveryError("");
      return null;
    }

    setRecoveryLoading(true);
    setRecoveryError("");
    try {
      const result = await window.api?.getToolRuntimeRecoveryHistory?.();
      if (!result?.ok) {
        throw new Error(result?.message ?? "读取恢复记录失败。");
      }
      setRecoveryHistory(result.history ?? null);
      return result.history ?? null;
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setRecoveryLoading(false);
    }
  }, [developerMode]);

  useEffect(() => {
    if (!developerMode) {
      setRecoveryOpen(false);
      setRecoveryHistory(null);
      setRecoveryError("");
      return;
    }
    void refreshRecoveryHistory();
  }, [developerMode, refreshRecoveryHistory]);

  useEffect(() => {
    if (
      developerMode &&
      (agentStatus.toolRuntime?.unresolvedCount > 0 || recoveryOpen)
    ) {
      void refreshRecoveryHistory();
    }
  }, [
    agentStatus.toolRuntime?.unresolvedCount,
    developerMode,
    recoveryOpen,
    refreshRecoveryHistory
  ]);

  const handleRecoveryHistoryAction = useCallback(async (request) => {
    if (!request?.taskId || !request?.callId || !request?.action || recoveryBusy) {
      return;
    }

    const confirmations = {
      confirm_applied: "确认该工具操作已经生效？确认后不会再次执行。",
      confirm_not_applied: "确认该工具操作没有生效？之后继续任务时允许重新执行。",
      abandon: "放弃该工具操作？该调用会被记为已取消。"
    };
    if (
      confirmations[request.action] &&
      !window.confirm(confirmations[request.action])
    ) {
      return;
    }

    const token = `${request.taskId}:${request.callId}:${request.action}`;
    setRecoveryBusy(token);
    setRecoveryError("");
    try {
      const result = await window.api?.resolveToolRuntimeRecovery?.(request);
      if (!result?.ok) {
        throw new Error(result?.message ?? "恢复操作失败。");
      }
      await refreshRecoveryHistory();
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : String(error));
    } finally {
      setRecoveryBusy("");
    }
  }, [recoveryBusy, refreshRecoveryHistory]);

  const rootClassName =
    useMemo(
      () => {
        return [
          "conversation-shell",
          theme === "dark"
            ? "theme-dark"
            : "",
          settings
            .appearance
            .reducedMotion
            ? "reduce-motion"
            : "",
          sidebarCollapsed
            ? "is-sidebar-collapsed"
            : "",
          contextOpen || taskOpen || recoveryOpen
            ? "is-context-open"
            : "",
          isMaximized
            ? "is-maximized"
            : ""
        ]
          .filter(Boolean)
          .join(" ");
      },
      [
        contextOpen,
        recoveryOpen,
        isMaximized,
        settings
          .appearance
          .reducedMotion,
        sidebarCollapsed,
        taskOpen,
        theme
      ]
    );

  const openInput = () => {
    window.api
      ?.openInput?.();
  };

  const resetContext = async () => {
    if (!history.current) {
      return;
    }

    const confirmed =
      window.confirm(
        "重置当前短期上下文？历史消息仍会保留，固定消息不受影响。"
      );

    if (!confirmed) {
      return;
    }

    await history.resetContext(
      history.current.id
    );
  };

  return (
    <div
      className={rootClassName}
      data-testid="conversation-window"
      style={{
        ...getWindowTypographyStyle(
          settings,
          "conversation"
        ),

        "--conversation-accent":
          settings
            .appearance
            .accentColor
      }}
    >
      <ConversationTopbar
        sidebarCollapsed={
          sidebarCollapsed
        }
        contextOpen={contextOpen}
        taskOpen={taskOpen}
        recoveryOpen={developerMode && recoveryOpen}
        showRecovery={developerMode}
        recoveryCount={recoveryHistory?.unresolvedCount ?? 0}
        skill={history.current?.skillSnapshot ?? null}
        skills={history.current?.skillSnapshots ?? []}
        skillRoutingMode={history.current?.skillRoutingMode ?? "manual"}
        isMaximized={isMaximized}
        onToggleSidebar={() => {
          setSidebarCollapsed(
            (current) =>
              !current
          );
        }}
        onToggleContext={() => {
          setTaskOpen(false);
          setRecoveryOpen(false);
          setContextOpen(
            (current) =>
              !current
          );
        }}
        onToggleTask={() => {
          setContextOpen(false);
          setRecoveryOpen(false);
          setTaskOpen(
            (current) =>
              !current
          );
          setTaskTargetMessageId(
            (current) =>
              current ??
              (agentStatus.conversationId ===
                history.current?.id &&
              ["running", "stopping", "cancelling"].includes(
                agentStatus.state
              )
                ? "live"
                : null)
          );
        }}
        onToggleRecovery={() => {
          if (!developerMode) return;
          setContextOpen(false);
          setTaskOpen(false);
          setRecoveryOpen((current) => !current);
        }}
        onCreate={() => {
          void history.create({
            mode: history.current?.mode ?? "chat",
            workspaceId:
              history.current?.workspaceId ?? null,
            modelSelection:
              history.current?.modelSelection ?? undefined
          });
        }}
        onOpenInput={openInput}
        onMinimize={() => {
          window.api
            ?.minimizeWindow?.();
        }}
        onMaximize={() => {
          window.api
            ?.maximizeWindow?.();
        }}
        onClose={() => {
          window.api
            ?.closeWindow?.();
        }}
      />

      <div className="conversation-layout">
        <ConversationSidebar
          conversations={
            history.conversations
          }
          workspaces={workspaces}
          activeMode={sidebarMode}
          onModeChange={setSidebarMode}
          currentConversationId={
            history.state
              .currentConversationId
          }
          busy={history.busy}
          query={query}
          onQueryChange={setQuery}
          onSelect={(
            conversationId
          ) => {
            void history.select(
              conversationId
            );
          }}
          onRename={(
            conversationId,
            title
          ) => {
            return history.rename({
              conversationId,
              title
            });
          }}
          onDelete={(
            conversationId
          ) => {
            void history.remove(
              conversationId
            );
          }}
        />

        <main className="conversation-main">
          {history.error && (
            <div className="conversation-alert">
              {history.error}
            </div>
          )}

          <ConversationMessageList
            loading={history.loading}
            developerMode={
              settings.general
                .developerMode
            }
            conversation={
              history.current
            }
            liveActivity={currentLiveActivity}
            busy={history.busy}
            onOpenTaskPanel={(
              messageId
            ) => {
              setContextOpen(false);
              setRecoveryOpen(false);
              setTaskTargetMessageId(
                messageId
              );
              setTaskOpen(true);
            }}
            onOpenInput={openInput}
            onRegenerate={(
              messageId
            ) => {
              if (!history.current) {
                return;
              }

              void history.regenerate({
                conversationId:
                  history.current.id,
                messageId
              });
            }}
            onUpdateMessageContext={(
              messageId,
              patch
            ) => {
              if (!history.current) {
                return;
              }

              void history
                .updateMessageContext({
                  conversationId:
                    history.current.id,
                  messageId,
                  ...patch
                });
            }}
          />

          <ConversationPlanDock
            activity={currentLiveActivity}
          />

          <ToolApprovalPanel
            approval={
              agentStatus.conversationId === history.current?.id
                ? agentStatus.pendingApproval
                : null
            }
          />
        </main>

        <ConversationRecoveryPanel
          open={developerMode && recoveryOpen}
          history={recoveryHistory}
          loading={recoveryLoading}
          busy={recoveryBusy}
          error={recoveryError}
          developerMode={developerMode}
          onRefresh={refreshRecoveryHistory}
          onAction={handleRecoveryHistoryAction}
          onOpenTask={async (item) => {
            if (item.conversationId) {
              await history.select(item.conversationId);
            }
            setRecoveryOpen(false);
            setContextOpen(false);
            setTaskTargetMessageId(item.messageId || null);
            setTaskOpen(true);
          }}
          onClose={() => setRecoveryOpen(false)}
        />

        <ConversationTaskPanel
          open={taskOpen}
          conversation={history.current}
          liveActivity={currentLiveActivity}
          targetMessageId={
            taskTargetMessageId
          }
          developerMode={
            settings.general
              .developerMode
          }
          onLoadRecovery={(taskId) =>
            window.api?.getToolRuntimeRecovery?.(taskId)
          }
          onLoadDeveloperDetails={(request) =>
            window.api?.getAgentRunDetails?.(request)
          }
          onRecoveryAction={(request) =>
            window.api?.resolveToolRuntimeRecovery?.(request)
          }
          onClose={() => {
            setTaskOpen(false);
          }}
        />

        <ConversationContextInspector
          open={contextOpen}
          conversation={history.current}
          inspection={
            history.inspection
          }
          busy={history.busy}
          onClose={() => {
            setContextOpen(false);
          }}
          onResetContext={
            resetContext
          }
        />
      </div>
    </div>
  );
}
