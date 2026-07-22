import {
  ConversationIcon
} from "./Icon.jsx";

export function MessageAction({
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

export function EmptyState({
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
