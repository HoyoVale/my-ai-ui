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

import {
  TOOL_METADATA
} from "../../Setting/tools/toolPanelOptions.js";

const TIME_FORMATTER =
  new Intl.DateTimeFormat(
    "zh-CN",
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }
  );

const FULL_TIME_FORMATTER =
  new Intl.DateTimeFormat(
    "zh-CN",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }
  );

function formatMessageTime(
  timestamp
) {
  const date =
    new Date(
      Number(timestamp) || 0
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return {
      short: "",
      full: ""
    };
  }

  return {
    short:
      TIME_FORMATTER.format(
        date
      ),
    full:
      FULL_TIME_FORMATTER.format(
        date
      )
  };
}

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
  developerMode = false,
  toolDetailLevel = "compact",
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

            const messageTime =
              formatMessageTime(
                message.createdAt
              );

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
                  {!isAssistant &&
                    messageTime.short && (
                    <time
                      className="conversation-message__time"
                      dateTime={
                        new Date(
                          Number(
                            message.createdAt
                          ) || 0
                        ).toISOString()
                      }
                      title={messageTime.full}
                    >
                      {messageTime.short}
                    </time>
                  )}

                  {isAssistant && (
                    <AssistantActivity
                      message={message}
                      developerMode={developerMode}
                      detailLevel={toolDetailLevel}
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
                      {isAssistant &&
                        pinned && (
                        <span className="conversation-message__status-chip">
                          已固定
                        </span>
                      )}

                      {isAssistant &&
                        !included && (
                        <span className="conversation-message__status-chip">
                          已排除上下文
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

                      {isAssistant && (
                        <>
                          {message.id ===
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

                          <MessageAction
                            label={
                              included
                                ? "排除上下文"
                                : "加入上下文"
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
                        </>
                      )}
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

function toolTitle(toolCall) {
  return (
    TOOL_METADATA[
      toolCall.name
    ]?.title ??
    toolCall.title ??
    toolCall.name ??
    "工具调用"
  );
}

function toolStatusLabel(status) {
  if (status === "error") {
    return "失败";
  }

  if (status === "running") {
    return "进行中";
  }

  return "完成";
}

function toolStatusMark(status) {
  if (status === "error") {
    return "!";
  }

  if (status === "running") {
    return "…";
  }

  return "✓";
}

function describeToolCall(
  toolCall
) {
  const input =
    toolCall.input ?? {};

  const path =
    input.path ??
    input.directory ??
    input.root ??
    input.query ??
    input.expression ??
    input.timezone ??
    input.targetTimezone;

  if (!path) {
    return "";
  }

  const normalized =
    String(path);

  return normalized.length > 72
    ? `${normalized.slice(0, 34)}…${normalized.slice(-30)}`
    : normalized;
}

function AgentPlan({ plan }) {
  if (!Array.isArray(plan) || plan.length === 0) {
    return null;
  }

  const completed =
    plan.filter(
      (item) =>
        item.status === "completed"
    ).length;

  const active =
    plan.find(
      (item) =>
        item.status === "in_progress"
    );

  return (
    <details className="conversation-plan">
      <summary>
        <span>
          {active
            ? "任务计划"
            : `已完成 ${completed} 个步骤`}
        </span>
      </summary>

      <div className="conversation-plan__items">
        {plan.map((item) => (
          <div
            className={`conversation-plan__item is-${item.status}`}
            key={item.id}
          >
            <span>
              {item.status === "completed"
                ? "✓"
                : item.status === "in_progress"
                  ? "●"
                  : item.status === "blocked"
                    ? "!"
                    : "○"}
            </span>
            <strong>{item.title}</strong>
          </div>
        ))}
      </div>
    </details>
  );
}

function AssistantActivity({
  message,
  developerMode,
  detailLevel
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

  const plan =
    Array.isArray(message.plan)
      ? message.plan
      : [];

  const duration =
    Number(message.durationMs) || 0;

  if (
    !duration &&
    !reasoning &&
    toolCalls.length === 0 &&
    plan.length === 0
  ) {
    return null;
  }

  const showDetails =
    developerMode ||
    detailLevel === "detailed";

  return (
    <div className="conversation-agent-activity">
      <AgentPlan plan={plan} />

      {toolCalls.length > 0 && (
        <details className="conversation-activity">
          <summary>
            <span>
              已使用 {toolCalls.length} 个工具
            </span>
            {duration > 0 && (
              <small>
                {formatDuration(duration)}
              </small>
            )}
          </summary>

          <div className="conversation-activity__content">
            <div className="conversation-tool-list">
              {toolCalls.map(
                (toolCall, index) => {
                  const title =
                    toolTitle(toolCall);
                  const description =
                    describeToolCall(
                      toolCall
                    );
                  const key =
                    toolCall.id ??
                    `${toolCall.name}-${index}`;

                  if (developerMode) {
                    return (
                      <details
                        className="conversation-tool-call conversation-tool-call--developer"
                        key={key}
                      >
                        <summary>
                          <span className={`conversation-tool-mark is-${toolCall.status ?? "complete"}`}>
                            {toolStatusMark(toolCall.status)}
                          </span>
                          <span>
                            <strong>{title}</strong>
                            <code>{toolCall.name}</code>
                          </span>
                          <em>
                            {toolStatusLabel(toolCall.status)}
                            {toolCall.durationMs
                              ? ` · ${formatDuration(toolCall.durationMs)}`
                              : ""}
                          </em>
                        </summary>

                        <div className="conversation-tool-call__content">
                          {toolCall.input !== undefined && (
                            <ToolCallSection
                              title="输入"
                              value={toolCall.input}
                            />
                          )}

                          {toolCall.output !== undefined && (
                            <ToolCallSection
                              title="输出"
                              value={toolCall.output}
                            />
                          )}
                        </div>
                      </details>
                    );
                  }

                  return (
                    <div
                      className="conversation-tool-row"
                      key={key}
                    >
                      <span className={`conversation-tool-mark is-${toolCall.status ?? "complete"}`}>
                        {toolStatusMark(toolCall.status)}
                      </span>
                      <div>
                        <strong>{title}</strong>
                        {showDetails && description && (
                          <small>{description}</small>
                        )}
                      </div>
                      {showDetails && toolCall.durationMs > 0 && (
                        <em>
                          {formatDuration(toolCall.durationMs)}
                        </em>
                      )}
                    </div>
                  );
                }
              )}
            </div>

            {reasoning && (
              <details className="conversation-reasoning">
                <summary>思考摘要</summary>
                <MarkdownContent
                  content={reasoning}
                  compact
                />
              </details>
            )}
          </div>
        </details>
      )}

      {toolCalls.length === 0 && reasoning && (
        <details className="conversation-activity">
          <summary>
            <span>
              {duration
                ? `思考了 ${formatDuration(duration)}`
                : "思考摘要"}
            </span>
          </summary>
          <div className="conversation-activity__content">
            <MarkdownContent
              content={reasoning}
              compact
            />
          </div>
        </details>
      )}
    </div>
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
