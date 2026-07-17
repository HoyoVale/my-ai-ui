import {
  MemoryIcon
} from "./Icon.jsx";

const FILTERS = [
  {
    value: "all",
    label: "全部",
    countKey: "totalMemories"
  },
  {
    value: "enabled",
    label: "启用",
    countKey: "enabledMemories"
  },
  {
    value: "disabled",
    label: "停用",
    countKey: "disabledMemories"
  }
];

function priorityLabel(
  priority
) {
  if (priority >= 0.8) {
    return "高";
  }

  if (priority >= 0.45) {
    return "中";
  }

  return "低";
}

export function MemorySidebar({
  memories,
  selectedId,
  query,
  filter,
  state,
  loading,
  onNew,
  onQueryChange,
  onFilterChange,
  onSelect
}) {
  return (
    <aside className="memory-sidebar">
      <button
        type="button"
        className="memory-new-button"
        data-testid="memory-new-topbar"
        onClick={onNew}
      >
        <MemoryIcon
          name="plus"
          size={16}
        />
        新建记忆
      </button>

      <label className="memory-search">
        <MemoryIcon
          name="search"
          size={15}
        />
        <input
          value={query}
          placeholder="搜索标题、正文或标签"
          aria-label="搜索记忆"
          onChange={(event) => {
            onQueryChange(
              event.target.value
            );
          }}
        />
      </label>

      <nav
        className="memory-filters"
        aria-label="记忆筛选"
      >
        {FILTERS.map(
          (option) => (
            <button
              key={option.value}
              type="button"
              data-testid={
                `memory-filter-${option.value}`
              }
              className={
                filter ===
                  option.value
                  ? "is-active"
                  : ""
              }
              onClick={() => {
                onFilterChange(
                  option.value
                );
              }}
            >
              <span>{option.label}</span>
              <small>
                {state[
                  option.countKey
                ] ?? 0}
              </small>
            </button>
          )
        )}
      </nav>

      <div className="memory-list-heading">
        <span>记忆</span>
        <span>{memories.length}</span>
      </div>

      <div className="memory-list">
        {loading && (
          <div className="memory-list-state">
            正在读取…
          </div>
        )}

        {!loading &&
          memories.length === 0 && (
            <div className="memory-list-state memory-list-state--empty">
              <MemoryIcon
                name="brain"
                size={20}
              />
              <span>
                没有匹配的记忆
              </span>
            </div>
          )}

        {memories.map((memory) => (
          <button
            key={memory.id}
            type="button"
            data-testid="memory-list-item"
            className={
              `memory-list-item${
                selectedId ===
                memory.id
                  ? " is-active"
                  : ""
              }${
                !memory.enabled
                  ? " is-disabled"
                  : ""
              }`
            }
            onClick={() => {
              onSelect(memory.id);
            }}
          >
            <span className="memory-list-item__title-row">
              <strong>
                {memory.title}
              </strong>
              <span
                className={
                  `memory-status-dot${
                    memory.enabled
                      ? " is-enabled"
                      : ""
                  }`
                }
                aria-label={
                  memory.enabled
                    ? "已启用"
                    : "已停用"
                }
              />
            </span>

            <span className="memory-list-item__preview">
              {memory.content}
            </span>

            <span className="memory-list-item__footer">
              <span>
                {priorityLabel(
                  memory.priority
                )}优先级
              </span>
              {memory.tags.length > 0 && (
                <span className="memory-list-item__tag">
                  {memory.tags[0]}
                  {memory.tags.length > 1
                    ? ` +${memory.tags.length - 1}`
                    : ""}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
