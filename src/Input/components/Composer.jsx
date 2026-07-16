export function InputComposer({
  textareaRef,
  value,
  canSend,
  onChange,
  onKeyDown,
  onSend,
  onClose
}) {
  return (
    <div className="input-bar">
      <textarea
        ref={textareaRef}
        className="input-bar__field"
        rows={1}
        placeholder="Type a message..."
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
        autoFocus
      />

      <button
        className="input-bar__send"
        type="button"
        onClick={onSend}
        disabled={!canSend}
        title="Send"
        aria-label="Send"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>

      <button
        className="input-bar__close"
        type="button"
        onClick={onClose}
        title="Close"
        aria-label="Close"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
