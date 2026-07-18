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

  const filteredConversations =
    useMemo(
      () => {
        const normalized =
          query
            .trim()
            .toLowerCase();

        if (!normalized) {
          return history
            .conversations;
        }

        return history
          .conversations
          .filter(
            (conversation) => {
              return String(
                conversation.title ?? ""
              )
                .toLowerCase()
                .includes(
                  normalized
                );
            }
          );
      },
      [
        history.conversations,
        query
      ]
    );

  useEffect(() => {
    setTaskOpen(false);
    setTaskTargetMessageId(null);
  }, [
    history.current?.id
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
              ["running", "stopping"].includes(
                agentStatus.state
              )
                ? "live"
                : null)
          );
        }}
        onCreate={() => {
          void history.create();
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
            toolDetailLevel={
              settings.tools
                .display
                .detailLevel
            }
            conversation={
              history.current
            }
            liveActivity={
              agentStatus.conversationId ===
                history.current?.id &&
              ["running", "stopping"].includes(
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
            onAnswerQuestion={async (
              response
            ) => {
              return window.api
                ?.answerAgentQuestion?.({
                  conversationId:
                    history.current?.id ?? "",
                  ...response
                });
            }}
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
            ["running", "stopping"].includes(
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
          detailLevel={
            settings.tools
              .display
              .detailLevel
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
