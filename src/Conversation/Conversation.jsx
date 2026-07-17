import {
  useMemo,
  useState
} from "react";

import {
  ConversationMessageList
} from "./components/MessageList.jsx";

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

  const [
    sidebarCollapsed,
    setSidebarCollapsed
  ] = useState(false);

  const [
    query,
    setQuery
  ] = useState("");

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
              return [
                conversation.title,
                conversation.preview
              ]
                .filter(Boolean)
                .some(
                  (value) =>
                    String(value)
                      .toLowerCase()
                      .includes(
                        normalized
                      )
                );
            }
          );
      },
      [
        history.conversations,
        query
      ]
    );

  const currentTitle =
    history.current
      ?.title ??
    "会话记录";

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
          isMaximized
            ? "is-maximized"
            : ""
        ]
          .filter(Boolean)
          .join(" ");
      },
      [
        isMaximized,
        settings
          .appearance
          .reducedMotion,
        sidebarCollapsed,
        theme
      ]
    );

  const openInput = () => {
    window.api
      ?.openInput?.();
  };

  return (
    <div
      className={rootClassName}
      data-testid="conversation-window"
      style={{
        "--conversation-accent":
          settings
            .appearance
            .accentColor,

        "--conversation-sidebar-width":
          "288px",

        "--conversation-message-max-width":
          "780px",

        "--conversation-font-size":
          "15px"
      }}
    >
      <ConversationTopbar
        title={currentTitle}
        messageCount={
          history.current
            ?.messages
            .length ?? 0
        }
        sidebarCollapsed={
          sidebarCollapsed
        }
        isMaximized={
          isMaximized
        }
        onToggleSidebar={() => {
          setSidebarCollapsed(
            (current) =>
              !current
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
          totalConversations={
            history
              .conversations
              .length
          }
          currentConversationId={
            history.state
              .currentConversationId
          }
          busy={history.busy}
          query={query}
          showPreview={true}
          onQueryChange={setQuery}
          onCreate={() => {
            void history.create();
          }}
          onSelect={(
            conversationId
          ) => {
            void history.select(
              conversationId
            );
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
            conversation={
              history.current
            }
            assistantName={
              settings.personality
                .enabled
                ? settings.personality
                    .name
                : "Xixi"
            }
            onOpenInput={openInput}
          />
        </main>
      </div>
    </div>
  );
}
