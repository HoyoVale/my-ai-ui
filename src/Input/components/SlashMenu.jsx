import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  normalizeSessionMode
} from "../../shared/sessionNavigation.js";

import {
  filterSlashSkillSuggestions,
  findSlashCommand
} from "../utils/slashCommand.js";

export const SlashMenu = forwardRef(function SlashMenu({
  value,
  cursorPosition,
  skills = [],
  skillsReady = false,
  skillsError = "",
  mode = "chat",
  disabled = false,
  suppressed = false,
  onChange,
  onOpenChange,
  onPanelHeightChange
}, ref) {
  const panelRef = useRef(null);
  const lastPanelHeightRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const command = useMemo(
    () => findSlashCommand(value, cursorPosition),
    [cursorPosition, value]
  );

  const compatibleSkills = useMemo(() =>
    filterSlashSkillSuggestions(skills, { mode, limit: 20 }),
  [mode, skills]);

  const suggestions = useMemo(() => {
    if (!command || disabled || suppressed) return [];
    return filterSlashSkillSuggestions(compatibleSkills, {
      mode,
      query: command.query,
      limit: 8
    });
  }, [command, compatibleSkills, disabled, mode, suppressed]);

  const open = Boolean(command && !disabled && !suppressed);

  useEffect(() => {
    setActiveIndex(0);
  }, [command?.query, open]);

  useEffect(() => {
    onOpenChange?.(open);
    if (!open && lastPanelHeightRef.current !== 0) {
      lastPanelHeightRef.current = 0;
      onPanelHeightChange?.(0);
    }
  }, [onOpenChange, onPanelHeightChange, open]);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) return undefined;
    const panel = panelRef.current;
    const publish = () => {
      const nextHeight = Math.max(0, Math.ceil(panel.offsetHeight));
      if (nextHeight === lastPanelHeightRef.current) return;
      lastPanelHeightRef.current = nextHeight;
      onPanelHeightChange?.(nextHeight);
    };
    publish();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(publish);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [onPanelHeightChange, open, suggestions.length, skillsError, skillsReady]);

  const select = useCallback((skill) => {
    if (!command || !skill) return false;
    const nextValue = `${String(value).slice(0, command.start)}/${skill.id} ${String(value).slice(command.end)}`;
    const nextCursor = command.start + skill.id.length + 2;
    onChange?.(nextValue, nextCursor);
    return true;
  }, [command, onChange, value]);

  useImperativeHandle(ref, () => ({
    handleKeyDown(event) {
      if (!open) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        onChange?.(value, cursorPosition, { suppressSlash: true });
        return true;
      }
      if (!suggestions.length) return false;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % suggestions.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
        return true;
      }
      if (["Enter", "Tab"].includes(event.key)) {
        event.preventDefault();
        return select(suggestions[activeIndex]);
      }
      return false;
    }
  }), [activeIndex, cursorPosition, onChange, open, select, suggestions, value]);

  if (!open) return null;

  const emptyMessage = skillsError
    ? skillsError
    : !skillsReady
      ? "正在读取可用 Skill…"
      : compatibleSkills.length === 0
        ? `当前 ${normalizeSessionMode(mode) === "coding" ? "Coding" : "Chat"} 模式没有可用 Skill。请先在 Setting → Skills 中安装并启用。`
        : "没有匹配当前命令的 Skill。";

  return (
    <div
      ref={panelRef}
      className="input-slash-menu"
      data-testid="input-slash-menu"
      data-skill-count={suggestions.length}
      role="listbox"
      aria-label="Skill 命令"
    >
      <div className="input-slash-menu__header">
        <span>临时调用 Skill</span>
        {suggestions.length > 0 && <><kbd>↑↓</kbd><kbd>Enter</kbd></>}
      </div>
      {suggestions.length > 0 ? (
        <div className="input-slash-menu__items">
          {suggestions.map((skill, index) => (
            <button
              key={skill.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`input-slash-menu__item${index === activeIndex ? " is-active" : ""}`}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => select(skill)}
            >
              <span><code>/{skill.id}</code><strong>{skill.name}</strong></span>
              <small>{skill.description}</small>
            </button>
          ))}
        </div>
      ) : (
        <div
          className={`input-slash-menu__empty${skillsError ? " is-error" : ""}`}
          role="status"
        >
          {emptyMessage}
        </div>
      )}
    </div>
  );
});
