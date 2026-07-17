import {
  MarkdownContent
} from "../../Conversation/components/MarkdownContent.jsx";

export function ResponseBubble({
  shellRef,
  contentRef,
  text,
  streaming,
  side,
  theme,
  reducedMotion,
  style,
  onScroll,
  onDismiss
}) {
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
          <div
            className="response-bubble__text"
            data-testid="response-text"
          >
            <MarkdownContent
              content={text}
              compact
            />
          </div>

          {streaming && (
            <span
              className="response-bubble__cursor"
              aria-hidden="true"
            />
          )}
        </div>
      </article>
    </div>
  );
}
