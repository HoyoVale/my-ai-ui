import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  ConversationIcon
} from "./Icon.jsx";

function formatTokens(
  value
) {
  const numeric =
    Math.max(
      0,
      Number(value) || 0
    );

  if (numeric >= 1000000) {
    return `${(
      numeric / 1000000
    ).toFixed(1)}M`;
  }

  if (numeric >= 1000) {
    return `${(
      numeric / 1000
    ).toFixed(
      numeric >= 10000
        ? 0
        : 1
    )}K`;
  }

  return String(
    Math.round(numeric)
  );
}

export function ConversationContextInspector({
  open,
  conversation,
  inspection,
  busy,
  onClose,
  onSaveSummary,
  onResetContext
}) {
  const [summary, setSummary] =
    useState("");

  useEffect(() => {
    setSummary(
      conversation?.summary ?? ""
    );
  }, [
    conversation?.id,
    conversation?.summary
  ]);

  const budget =
    inspection?.budget;

  const sections =
    budget?.sections ?? [];

  const maxSectionTokens =
    useMemo(
      () =>
        Math.max(
          1,
          ...sections.map(
            (section) =>
              section.tokens
          )
        ),
      [sections]
    );

  const summaryChanged =
    summary.trim() !==
    String(
      conversation?.summary ?? ""
    ).trim();

  if (!open) {
    return null;
  }

  return (
    <aside
      className="conversation-context"
      data-testid="conversation-context-inspector"
    >
      <header className="conversation-context__header">
        <div>
          <strong>上下文</strong>
          <span>下一次请求的预计组成</span>
        </div>

        <button
          type="button"
          className="conversation-context__close"
          aria-label="关闭上下文"
          title="关闭"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {!conversation || !budget ? (
        <div className="conversation-context__empty">
          选择一个会话后查看上下文。
        </div>
      ) : (
        <div className="conversation-context__scroll">
          <section
            className={`context-budget-card${
              budget.overflowTokens > 0
                ? " is-overflow"
                : ""
            }`}
          >
            <div className="context-budget-card__top">
              <div>
                <span>预计总占用</span>
                <strong data-testid="context-total-tokens">
                  {formatTokens(
                    budget.totalTokens
                  )}
                  <small> tokens</small>
                </strong>
              </div>

              <div className="context-budget-card__ratio">
                {Math.round(
                  budget.usageRatio * 100
                )}%
              </div>
            </div>

            <div className="context-budget-card__track">
              <span
                style={{
                  width:
                    `${Math.max(
                      1,
                      Math.min(
                        100,
                        budget.usageRatio *
                          100
                      )
                    )}%`
                }}
              />
            </div>

            <div className="context-budget-card__meta">
              <span>
                输入 {formatTokens(
                  budget.inputTokens
                )}
              </span>
              <span>
                输出预留 {formatTokens(
                  budget.outputReserve
                )}
              </span>
              <span>
                上限 {formatTokens(
                  budget.contextTokenBudget
                )}
              </span>
            </div>

            <p>
              Token 为本地估算值，实际用量以模型返回为准。
            </p>
          </section>

          <section className="context-section">
            <div className="context-section__title">
              <strong>组成</strong>
              <span>
                {budget.overflowTokens > 0
                  ? `超出约 ${formatTokens(
                      budget.overflowTokens
                    )}`
                  : `输入剩余约 ${formatTokens(
                      budget.remaining
                    )}`}
              </span>
            </div>

            <div className="context-breakdown">
              {sections.map(
                (section) => (
                  <div
                    className="context-breakdown__row"
                    key={section.id}
                  >
                    <div className="context-breakdown__label">
                      <span>{section.label}</span>
                      <strong>
                        {formatTokens(
                          section.tokens
                        )}
                      </strong>
                    </div>

                    <div className="context-breakdown__track">
                      <span
                        style={{
                          width:
                            `${Math.max(
                              section.tokens > 0
                                ? 3
                                : 0,
                              section.tokens /
                                maxSectionTokens *
                                100
                            )}%`
                        }}
                      />
                    </div>
                  </div>
                )
              )}
            </div>
          </section>

          <section className="context-section">
            <div className="context-section__title">
              <strong>会话摘要</strong>
              <span>
                {summary.length}/12000
              </span>
            </div>

            <textarea
              className="context-summary"
              data-testid="conversation-summary-input"
              value={summary}
              maxLength={12000}
              placeholder="手动记录当前会话的目标、已完成事项和下一步。摘要会持续加入本会话上下文。"
              onChange={(event) => {
                setSummary(
                  event.target.value
                );
              }}
            />

            <button
              type="button"
              className="context-secondary-button"
              data-testid="conversation-summary-save"
              disabled={
                busy ||
                !summaryChanged
              }
              onClick={() => {
                void onSaveSummary?.(
                  summary
                );
              }}
            >
              保存摘要
            </button>
          </section>

          <section className="context-section">
            <div className="context-section__title">
              <strong>当前策略</strong>
            </div>

            <div className="context-facts">
              <div>
                <span>最近消息</span>
                <strong data-testid="context-recent-count">
                  {inspection
                    .metadata
                    .messageCount}
                </strong>
              </div>
              <div>
                <span>固定消息</span>
                <strong data-testid="context-pinned-count">
                  {inspection
                    .metadata
                    .pinnedMessageCount}
                </strong>
              </div>
              <div>
                <span>长期记忆</span>
                <strong data-testid="context-memory-count">
                  {inspection
                    .metadata
                    .memoryCount}
                </strong>
              </div>
            </div>
          </section>

          <section className="context-reset-card">
            <div>
              <ConversationIcon
                name="reset"
                size={17}
              />
              <div>
                <strong>从这里开始新上下文</strong>
                <span>
                  保留历史记录，但下一次请求不再携带当前消息之前的普通对话。固定消息和摘要仍然有效。
                </span>
              </div>
            </div>

            <button
              type="button"
              data-testid="conversation-context-reset"
              disabled={busy}
              onClick={() => {
                void onResetContext?.();
              }}
            >
              清除当前上下文
            </button>
          </section>
        </div>
      )}
    </aside>
  );
}
