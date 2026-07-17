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
                <strong>
                  <b data-testid="context-total-tokens">
                    {formatTokens(
                      budget.totalTokens
                    )}
                  </b>
                  <small>
                    / {formatTokens(
                      budget.contextTokenBudget
                    )} tokens
                  </small>
                </strong>
              </div>

              <div className="context-budget-card__ratio">
                {formatPercent(
                  budget.usageRatio
                )}
              </div>
            </div>

            <div
              className="context-budget-card__track"
              role="progressbar"
              aria-label="预计总 Token 占上下文上限"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={
                Math.round(
                  budget.usageRatio *
                    100
                )
              }
            >
              <span
                style={{
                  width:
                    `${Math.min(
                      100,
                      budget.usageRatio *
                        100
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
                输入剩余 {formatTokens(
                  budget.remaining
                )}
              </span>
            </div>

            <p>
              总进度条表示“预计总占用 ÷ 上下文上限”。Token 为本地估算值。
            </p>
          </section>

          <section className="context-section">
            <div className="context-section__title">
              <strong>输入组成</strong>
              <span>
                {budget.overflowTokens > 0
                  ? `超出约 ${formatTokens(
                      budget.overflowTokens
                    )}`
                  : `共 ${formatTokens(
                      budget.inputTokens
                    )} tokens`}
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
                        <span>{section.label}</span>

                        <div className="context-breakdown__value">
                          <strong>
                            {formatTokens(
                              section.tokens
                            )} tokens
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

            <p className="context-breakdown__note">
              每条长条表示该部分占当前输入 Token 的比例，右侧同时显示准确 Token 数与百分比。
            </p>
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
                  保留历史记录，但下一次请求不再携带当前消息之前的普通对话。固定消息仍然有效。
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
