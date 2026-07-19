import {
  ResponseActivityFlow
} from "./ActivityFlow.jsx";

import {
  StreamingMarkdown
} from "./StreamingMarkdown.jsx";

export function ResponseBubble({
  shellRef,
  contentRef,
  answerText,
  liveText,
  agentStatus,
  streaming,
  side,
  theme,
  reducedMotion,
  style,
  onScroll,
  onDismiss
}) {
  const hasAnswer =
    Boolean(String(answerText).trim());

  return (
    <div
      ref={shellRef}
      className={
        [
          "response-shell",
          `response-shell--${side}`,
          theme === "dark"
            ? "theme-dark"
            : "",
          reducedMotion
            ? "reduce-motion"
            : ""
        ]
          .filter(Boolean)
          .join(" ")
      }
      style={style}
    >
      <article
        data-testid="response-bubble"
        className={
          `response-bubble${
            streaming
              ? " is-streaming"
              : ""
          }${
            agentStatus?.runId
              ? " has-activity"
              : ""
          }`
        }
        aria-live="polite"
      >
        <button
          className="response-bubble__close"
          data-testid="response-close"
          type="button"
          title="关闭"
          aria-label="关闭回复"
          onClick={onDismiss}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 2L10 10M10 2L2 10"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div
          ref={contentRef}
          className="response-bubble__content"
          onScroll={onScroll}
        >
          <ResponseActivityFlow
            status={agentStatus}
            streaming={streaming}
            liveText={liveText}
          />

          {hasAnswer && (
            <div
              className={`response-bubble__answer${agentStatus?.runId ? " has-activity" : ""}`}
              data-testid="response-text"
            >
              <StreamingMarkdown
                content={answerText}
                compact
                cursor={streaming}
              />
            </div>
          )}
        </div>
      </article>
    </div>
  );
}
