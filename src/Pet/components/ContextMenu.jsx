export function PetContextMenu({
  open,
  x,
  y,
  onClose,
  onOpenInput,
  onOpenResponse,
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
          onClick={onOpenInput}
        />

        <MenuItem
          icon="◌"
          label="测试回复"
          onClick={onOpenResponse}
        />

        <MenuItem
          icon="⚙"
          label="设置"
          onClick={onOpenSetting}
        />
      </nav>
    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick
}) {
  return (
    <button
      className="pet-menu__item"
      type="button"
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
