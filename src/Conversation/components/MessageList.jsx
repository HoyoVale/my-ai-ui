import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  ConversationIcon
} from "./Icon.jsx";

import {
  MarkdownContent
} from "./MarkdownContent.jsx";

function formatDuration(
  milliseconds
) {
  const numeric =
    Math.max(
      0,
      Number(milliseconds) || 0
    );

  if (numeric < 1000) {
    return `${Math.max(1, Math.round(numeric))} 毫秒`;
  }

  const seconds =
    numeric / 1000;

  return seconds < 10
    ? `${seconds.toFixed(1)} 秒`
    : `${Math.round(seconds)} 秒`;
}

function stringifyToolValue(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (
    typeof value === "string"
  ) {
    return value;
  }

  try {
    return JSON.stringify(
      value,
      null,
      2
    );
  } catch {
    return String(value);
  }
}

export function ConversationMessageList({
  loading,
  conversation,
  busy = false,
  onOpenInput,
  onUpdateMessageContext,
  onRegenerate
}) {
  const endRef =
    useRef(null);

  const [copiedId, setCopiedId] =
    useState(null);

  useEffect(() => {
    endRef.current
      ?.scrollIntoView?.({
        block: "end"
      });
  }, [
    conversation?.id,
    conversation?.messages.length
  ]);

  const lastAssistantId =
    useMemo(() => {
      return conversation
        ?.messages
        ?.findLast?.(
          (message) =>
            message.role ===
              "assistant"
        )
        ?.id ?? null;
    }, [conversation]);

  const copyMessage =
    async (message) => {
      try {
        await navigator.clipboard
          .writeText(
            message.content
          );
        setCopiedId(message.id);
        setTimeout(() => {
          setCopiedId((current) =>
            current === message.id
              ? null
              : current
          );
        }, 1400);
      } catch {
        // 剪贴板权限不可用时保持界面安静。
      }
    };

  if (loading) {
    return (
      <div className="conversation-state">
        <span className="conversation-state__spinner" />
        <strong>正在读取会话</strong>
      </div>
    );
  }

  if (!conversation) {
    return (
      <EmptyState
        title="选择一个会话"
        description="从左侧打开历史记录，或创建一个新会话。"
        onOpenInput={onOpenInput}
      />
    );
  }

  if (
    conversation.messages.length ===
    0
  ) {
    return (
      <EmptyState
        title="开始新的对话"
        description="打开输入框，第一条消息会自动保存在这里。"
        onOpenInput={onOpenInput}
        testId="conversation-empty"
      />
    );
  }

  return (
    <div
      className="conversation-messages"
      data-testid="conversation-message-list"
    >
      <div className="conversation-messages__canvas">
        {conversation.messages.map(
          (message) => {
            const isAssistant =
              message.role ===
                "assistant";

            const copied =
              copiedId === message.id;

            const included =
              message.includeInContext !==
                false;

            const pinned =
              message.pinnedToContext ===
                true;

            return (
              <article
                className={[
                  "conversation-message",
                  `conversation-message--${message.role}`,
                  included
                    ? ""
                    : "is-context-excluded",
                  pinned
                    ? "is-context-pinned"
                    : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-testid="conversation-message"
                data-message-id={message.id}
                data-role={message.role}
                data-context-included={included}
                data-context-pinned={pinned}
                key={message.id}
              >
                <div className="conversation-message__content">
                  {isAssistant && (
                    <AssistantActivity
                      message={message}
                    />
                  )}

                  <div className="conversation-message__body">
                    <MarkdownContent
                      content={message.content}
                      compact={!isAssistant}
                    />
                  </div>

                  <div className="conversation-message__actions">
                    <div className="conversation-message__status-group">
                      {pinned && (
                        <span className="conversation-message__status-chip">
                          已固定
                        </span>
                      )}

                      {!included && (
                        <span className="conversation-message__status-chip">
                          不加入上下文
                        </span>
                      )}

                      {message.status ===
                        "aborted" && (
                        <span className="conversation-message__status-chip">
                          回复已中止
                        </span>
                      )}
                    </div>

                    <div className="conversation-message__action-group">
                      <MessageAction
                        label={
                          copied
                            ? "已复制"
                            : "复制"
                        }
                        onClick={() => {
                          void copyMessage(
                            message
                          );
                        }}
                        icon={
                          copied
                            ? "check"
                            : "copy"
                        }
                      />

                      {isAssistant &&
                        message.id ===
                          lastAssistantId && (
                        <MessageAction
                          label="重新生成"
                          testId="message-regenerate"
                          disabled={busy}
                          onClick={() => {
                            void onRegenerate?.(
                              message.id
                            );
                          }}
                          icon="refresh"
                        />
                      )}

                      <MessageAction
                        label={
                          included
                            ? "不加入上下文"
                            : "重新加入上下文"
                        }
                        testId="message-context-toggle"
                        active={!included}
                        onClick={() => {
                          onUpdateMessageContext?.(
                            message.id,
                            {
                              includeInContext:
                                !included
                            }
                          );
                        }}
                        icon={
                          included
                            ? "eyeOff"
                            : "eye"
                        }
                      />

                      <MessageAction
                        label={
                          pinned
                            ? "取消固定"
                            : "固定到本会话"
                        }
                        testId="message-pin-toggle"
                        active={pinned}
                        disabled={!included}
                        onClick={() => {
                          onUpdateMessageContext?.(
                            message.id,
                            {
                              pinnedToContext:
                                !pinned
                            }
                          );
                        }}
                        icon="pin"
                      />
                    </div>
                  </div>
                </div>
              </article>
            );
          }
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
}

function AssistantActivity({
  message
}) {
  const reasoning =
    String(
      message.reasoningSummary ?? ""
    ).trim();

  const toolCalls =
    Array.isArray(
      message.toolCalls
    )
      ? message.toolCalls
      : [];

  const duration =
    Number(message.durationMs) || 0;

  if (
    !duration &&
    !reasoning &&
    toolCalls.length === 0
  ) {
    return null;
  }

  return (
    <details className="conversation-activity">
      <summary>
        <ConversationIcon
          name="clock"
          size={14}
        />
        <span>
          {duration
            ? `思考了 ${formatDuration(duration)}`
            : "思考与工具"}
        </span>
        <ConversationIcon
          name="chevron"
          size={13}
        />
      </summary>

      <div className="conversation-activity__content">
        {reasoning ? (
          <section className="conversation-reasoning">
            <strong>思考摘要</strong>
            <MarkdownContent
              content={reasoning}
              compact
            />
          </section>
        ) : (
          <p className="conversation-activity__empty">
            当前回复没有可展示的思考摘要。
          </p>
        )}

        {toolCalls.map(
          (toolCall, index) => (
            <details
              className="conversation-tool-call"
              key={
                toolCall.id ??
                `${toolCall.name}-${index}`
              }
            >
              <summary>
                <ConversationIcon
                  name="tool"
                  size={14}
                />
                <span>
                  {toolCall.name ||
                    "工具调用"}
                </span>
                <em>
                  {toolCall.status ||
                    "完成"}
                </em>
              </summary>

              <div className="conversation-tool-call__content">
                {toolCall.input !==
                  undefined && (
                  <ToolCallSection
                    title="输入"
                    value={toolCall.input}
                  />
                )}

                {toolCall.output !==
                  undefined && (
                  <ToolCallSection
                    title="输出"
                    value={toolCall.output}
                  />
                )}
              </div>
            </details>
          )
        )}
      </div>
    </details>
  );
}

function ToolCallSection({
  title,
  value
}) {
  const text =
    stringifyToolValue(value);

  return (
    <section>
      <div>
        <strong>{title}</strong>
        <button
          type="button"
          title={`复制${title}`}
          aria-label={`复制${title}`}
          onClick={() => {
            void navigator.clipboard
              .writeText(text);
          }}
        >
          <ConversationIcon
            name="copy"
            size={13}
          />
        </button>
      </div>
      <pre>{text}</pre>
    </section>
  );
}

function MessageAction({
  label,
  icon,
  active = false,
  disabled = false,
  testId,
  onClick
}) {
  return (
    <button
      type="button"
      className={
        `conversation-message-action${
          active
            ? " is-active"
            : ""
        }`
      }
      data-testid={testId}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <ConversationIcon
        name={icon}
        size={14}
      />
      <span>{label}</span>
    </button>
  );
}

function EmptyState({
  title,
  description,
  onOpenInput,
  testId
}) {
  return (
    <div
      className="conversation-state conversation-state--empty"
      data-testid={testId}
    >
      <strong>{title}</strong>
      <span>{description}</span>

      <button
        type="button"
        onClick={onOpenInput}
      >
        打开输入框
      </button>
    </div>
  );
}
