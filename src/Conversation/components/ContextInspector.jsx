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

function formatPercent(
  ratio
) {
  const percent =
    Math.max(
      0,
      Number(ratio) || 0
    ) * 100;

  if (percent === 0) {
    return "0%";
  }

  if (percent < 10) {
    return `${percent.toFixed(1)}%`;
  }

  return `${Math.round(percent)}%`;
}

export function ConversationContextInspector({
  open,
  conversation,
  inspection,
  busy,
  onClose,
  onResetContext
}) {
  if (!open) {
    return null;
  }

  const budget =
    inspection?.budget;

  const sections =
    budget?.sections ?? [];

  return (
    <aside
      className="conversation-context"
      data-testid="conversation-context-inspector"
    >
      <header className="conversation-context__header">
        <strong>Context</strong>

        <button
          type="button"
          className="conversation-context__close"
          aria-label="关闭上下文"
          title="关闭"
          onClick={onClose}
        >
          <ConversationIcon
            name="close"
            size={15}
          />
        </button>
      </header>

      {!conversation || !budget ? (
        <div className="conversation-context__empty">
          选择一个会话后查看上下文。
        </div>
      ) : (
        <div className="conversation-context__scroll">
          <section
            className={
              `context-budget-card${
                budget.overflowTokens > 0
                  ? " is-overflow"
                  : ""
              }`
            }
          >
            <div className="context-budget-card__top">
              <div>
                <span>当前输入占用（估算）</span>
                <strong>
                  <b data-testid="context-total-tokens">
                    {formatTokens(
                      budget.inputTokens
                    )}
                  </b>
                  <small>
                    / {formatTokens(
                      budget.contextTokenBudget
                    )}
                  </small>
                </strong>
              </div>

              <em>
                {formatPercent(
                  budget.currentInputRatio ??
                  (
                    budget.contextTokenBudget > 0
                      ? budget.inputTokens /
                        budget.contextTokenBudget
                      : 0
                  )
                )}
              </em>
            </div>

            <div
              className="context-budget-card__track"
              role="progressbar"
              aria-label="当前输入 Token 占上下文上限"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={
                Math.round(
                  (budget.currentInputRatio ?? 0) *
                    100
                )
              }
            >
              <span
                style={{
                  width:
                    `${Math.min(
                      100,
                      (budget.currentInputRatio ?? 0) *
                        100
                    )}%`
                }}
              />
            </div>

            <div className="context-budget-card__meta">
              <span>
                最大输出 {formatTokens(
                  budget.outputReserve
                )}
              </span>
              <span>
                可用空间 {formatTokens(
                  budget.availableTokens ??
                  Math.max(
                    0,
                    budget.contextTokenBudget -
                    budget.inputTokens
                  )
                )}
              </span>
            </div>

            <div className="context-budget-card__worst">
              <span>最坏情况请求预算</span>
              <strong>
                {formatTokens(
                  budget.totalTokens
                )}
                <small>
                  / {formatTokens(
                    budget.contextTokenBudget
                  )}
                </small>
              </strong>
              <em>
                {formatPercent(
                  budget.worstCaseRatio ??
                  budget.usageRatio
                )}
              </em>
            </div>
          </section>

          <section className="context-section">
            <div className="context-section__title">
              <strong>输入组成</strong>
              <span>
                {formatTokens(
                  budget.inputTokens
                )} tokens
              </span>
            </div>

            <div className="context-breakdown">
              {sections.map(
                (section) => {
                  const share =
                    section
                      .inputShareRatio ??
                    (
                      budget.inputTokens >
                      0
                        ? section.tokens /
                          budget.inputTokens
                        : 0
                    );

                  return (
                    <div
                      className="context-breakdown__row"
                      key={section.id}
                    >
                      <div className="context-breakdown__label">
                        <span>
                          {section.label}
                        </span>
                        <div className="context-breakdown__value">
                          <strong>
                            {formatTokens(
                              section.tokens
                            )}
                          </strong>
                          <em>
                            {formatPercent(
                              share
                            )}
                          </em>
                        </div>
                      </div>

                      <div
                        className="context-breakdown__track"
                        role="progressbar"
                        aria-label={`${section.label}占输入 Token`}
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-valuenow={
                          Math.round(
                            share * 100
                          )
                        }
                      >
                        <span
                          style={{
                            width:
                              `${Math.min(
                                100,
                                share * 100
                              )}%`
                          }}
                        />
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </section>

          <section className="context-section context-facts">
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
          </section>

          <section className="context-reset-card">
            <div>
              <strong>重置短期上下文</strong>
              <span>
                保留历史与固定消息，从下一条消息重新开始。
              </span>
            </div>

            <button
              type="button"
              data-testid="conversation-context-reset"
              disabled={busy}
              onClick={() => {
                void onResetContext?.();
              }}
            >
              重置
            </button>
          </section>
        </div>
      )}
    </aside>
  );
}
