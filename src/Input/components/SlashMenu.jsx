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
  filterSlashCommandSuggestions,
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
  onExecuteCommand,
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

  const suggestions = useMemo(() => {
    if (!command || disabled || suppressed) return [];
    return filterSlashCommandSuggestions({
      skills,
      mode,
      query: command.query,
      limit: 16
    });
  }, [command, disabled, mode, skills, suppressed]);

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

  const select = useCallback((item) => {
    if (!command || !item) return false;
    if (item.kind === "command") {
      const nextValue = `${String(value).slice(0, command.start)}${String(value).slice(command.end)}`;
      onChange?.(nextValue, command.start);
      onExecuteCommand?.(item);
      return true;
    }
    const nextValue = `${String(value).slice(0, command.start)}/${item.id} ${String(value).slice(command.end)}`;
    const nextCursor = command.start + item.id.length + 2;
    onChange?.(nextValue, nextCursor);
    return true;
  }, [command, onChange, onExecuteCommand, value]);

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

  return (
    <div
      ref={panelRef}
      className="input-slash-menu"
      data-testid="input-slash-menu"
      data-command-count={suggestions.filter((item) => item.kind === "command").length}
      data-skill-count={suggestions.filter((item) => item.kind === "skill").length}
      role="listbox"
      aria-label="命令与 Skill"
    >
      <div className="input-slash-menu__header">
        <span>命令与 Skills</span>
        {suggestions.length > 0 && <><kbd>↑↓</kbd><kbd>Enter</kbd></>}
      </div>
      {suggestions.length > 0 ? (
        <div className="input-slash-menu__items">
          {suggestions.map((item, index) => (
            <button
              key={`${item.kind}:${item.id}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`input-slash-menu__item${index === activeIndex ? " is-active" : ""}`}
              onPointerDown={(event) => event.preventDefault()}
              data-kind={item.kind}
              data-testid={`input-slash-${item.kind}-${item.id}`}
              onClick={() => select(item)}
            >
              <span>
                <code>/{item.id}</code>
                <strong>{item.name}</strong>
                <em>{item.kind === "skill" ? "Skill" : "命令"}</em>
              </span>
              <small>{item.description}</small>
            </button>
          ))}
        </div>
      ) : (
        <div
          className={`input-slash-menu__empty${skillsError ? " is-error" : ""}`}
          role="status"
        >
          {skillsError || (skillsReady ? "没有匹配的命令或 Skill。" : "正在读取命令与 Skills…")}
        </div>
      )}
    </div>
  );
});
