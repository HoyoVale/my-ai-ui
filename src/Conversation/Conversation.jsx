import {
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
  ConversationTaskPanel
} from "./components/TaskPanel.jsx";

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
    taskTargetMessageId,
    setTaskTargetMessageId
  ] = useState(null);

  const [query, setQuery] =
    useState("");

  const [workspaceScope, setWorkspaceScope] =
    useState("all");

  const workspaces =
    Array.isArray(settings.workspaces?.items)
      ? settings.workspaces.items
      : [];

  const currentConversationId =
    history.current?.id ?? "";
  const currentWorkspaceId =
    history.current?.workspaceId ?? "";

  useEffect(() => {
    if (!currentConversationId) {
      return;
    }

    setWorkspaceScope(
      currentWorkspaceId || "none"
    );
  }, [currentConversationId, currentWorkspaceId]);

  const filteredConversations =
    useMemo(
      () => {
        const normalized =
          query
            .trim()
            .toLowerCase();

        return history
          .conversations
          .filter((conversation) => {
            if (workspaceScope === "all") {
              return true;
            }

            if (workspaceScope === "none") {
              return !conversation.workspaceId;
            }

            return conversation.workspaceId === workspaceScope;
          })
          .filter((conversation) => {
            if (!normalized) {
              return true;
            }

            return String(
              conversation.title ?? ""
            )
              .toLowerCase()
              .includes(normalized);
          });
      },
      [
        history.conversations,
        query,
        workspaceScope
      ]
    );

  useEffect(() => {
    setTaskOpen(false);
    setTaskTargetMessageId(null);
  }, [
    currentConversationId
  ]);

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
          contextOpen || taskOpen
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
        isMaximized={isMaximized}
        onToggleSidebar={() => {
          setSidebarCollapsed(
            (current) =>
              !current
          );
        }}
        onToggleContext={() => {
          setTaskOpen(false);
          setContextOpen(
            (current) =>
              !current
          );
        }}
        onToggleTask={() => {
          setContextOpen(false);
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
        onCreate={() => {
          const workspaceId =
            workspaceScope === "all"
              ? history.current?.workspaceId ?? null
              : workspaceScope === "none"
                ? null
                : workspaceScope;

          void history.create(workspaceId);
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
            filteredConversations
          }
          workspaces={workspaces}
          workspaceScope={workspaceScope}
          onWorkspaceScopeChange={(nextScope) => {
            setWorkspaceScope(nextScope);

            if (nextScope === "all") {
              return;
            }

            void history.switchWorkspace(
              nextScope === "none"
                ? null
                : nextScope
            );
          }}
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
            liveActivity={
              agentStatus.conversationId ===
                history.current?.id &&
              ["running", "stopping", "cancelling"].includes(
                agentStatus.state
              )
                ? agentStatus
                : null
            }
            busy={history.busy}
            onOpenTaskPanel={(
              messageId
            ) => {
              setContextOpen(false);
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
        </main>

        <ConversationTaskPanel
          open={taskOpen}
          conversation={history.current}
          liveActivity={
            agentStatus.conversationId ===
              history.current?.id &&
            ["running", "stopping", "cancelling"].includes(
              agentStatus.state
            )
              ? agentStatus
              : null
          }
          targetMessageId={
            taskTargetMessageId
          }
          developerMode={
            settings.general
              .developerMode
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
