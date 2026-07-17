export function PetContextMenu({
  open,
  x,
  y,
  onClose,
  onOpenInput,
  onOpenResponse,
  onOpenConversation,
  onOpenMemory,
  onOpenSetting
}) {
  if (!open) {
    return null;
  }

  return (
    <>
      <button
        className="pet-menu__backdrop"
        type="button"
        aria-label="Close menu"
        onClick={onClose}
      />

      <nav
        className="pet-menu"
        style={{
          left: x,
          top: y
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
      >
        <MenuItem
          icon="✦"
          label="输入消息"
          testId="pet-menu-input"
          onClick={onOpenInput}
        />

        <MenuItem
          icon="◌"
          label="测试回复"
          testId="pet-menu-response"
          onClick={onOpenResponse}
        />

        <MenuItem
          icon="☰"
          label="会话记录"
          testId="pet-menu-conversation"
          onClick={onOpenConversation}
        />

        <MenuItem
          icon="◈"
          label="记忆管理"
          testId="pet-menu-memory"
          onClick={onOpenMemory}
        />

        <MenuItem
          icon="⚙"
          label="设置"
          testId="pet-menu-setting"
          onClick={onOpenSetting}
        />
      </nav>
    </>
  );
}

function MenuItem({
  icon,
  label,
  testId,
  onClick
}) {
  return (
    <button
      className="pet-menu__item"
      type="button"
      data-testid={testId}
      onClick={onClick}
    >
      <span
        className="pet-menu__icon"
        aria-hidden="true"
      >
        {icon}
      </span>

      <span>{label}</span>
    </button>
  );
}
