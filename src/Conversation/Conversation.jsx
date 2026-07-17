import {
  useMemo
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
        theme
      ]
    );

  return (
    <div
      className={rootClassName}
      data-testid="conversation-window"
      style={{
        "--conversation-accent":
          settings
            .appearance
            .accentColor
      }}
    >
      <ConversationTopbar
        title={currentTitle}
        isMaximized={
          isMaximized
        }
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
          currentConversationId={
            history.state
              .currentConversationId
          }
          busy={history.busy}
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
          <header className="conversation-main__header">
            <div>
              <span>当前会话</span>

              <h1
                data-testid="conversation-current-title"
              >
                {currentTitle}
              </h1>

              <p>
                {history.current
                  ? `${history.current.messages.length} 条消息`
                  : "选择一个会话查看完整记录"}
              </p>
            </div>

            <button
              type="button"
              className="conversation-continue"
              data-testid="conversation-open-input"
              onClick={() => {
                window.api
                  ?.openInput?.();
              }}
            >
              继续对话
            </button>
          </header>

          {history.error && (
            <div className="conversation-alert">
              {history.error}
            </div>
          )}

          <ConversationMessageList
            loading={
              history.loading
            }
            conversation={
              history.current
            }
          />
        </main>
      </div>
    </div>
  );
}
