import {
  MemoryIcon
} from "./Icon.jsx";

const FILTERS = [
  {
    value: "all",
    label: "全部"
  },
  {
    value: "enabled",
    label: "启用"
  },
  {
    value: "disabled",
    label: "停用"
  }
];

export function MemorySidebar({
  memories,
  selectedId,
  query,
  filter,
  loading,
  onQueryChange,
  onFilterChange,
  onSelect
}) {
  return (
    <aside className="memory-sidebar">
      <div className="memory-sidebar__heading">
        Memory
      </div>

      <label className="memory-search">
        <MemoryIcon
          name="search"
          size={15}
        />
        <input
          value={query}
          placeholder="搜索描述或标签"
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
              {option.label}
            </button>
          )
        )}
      </nav>

      <div className="memory-list">
        {loading && (
          <div className="memory-list-state">
            正在读取…
          </div>
        )}

        {!loading &&
          memories.length === 0 && (
            <div className="memory-list-state memory-list-state--empty">
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
            <span className="memory-list-item__description-row">
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

              <span className="memory-list-item__description">
                {memory.description ||
                  "未添加适用说明"}
              </span>
            </span>

            {memory.tags.length > 0 && (
              <span className="memory-list-item__tags">
                {memory.tags
                  .slice(0, 3)
                  .map((tag) => (
                    <span key={tag}>
                      {tag}
                    </span>
                  ))}
              </span>
            )}
          </button>
        ))}
      </div>
    </aside>
  );
}
