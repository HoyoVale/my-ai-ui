import {
  MemoryIcon
} from "./Icon.jsx";

import {
  MEMORY_CATEGORY_LABELS,
  MEMORY_CATEGORY_OPTIONS
} from "../constants/categories.js";

export function MemorySidebar({
  memories,
  selectedId,
  query,
  category,
  loading,
  onQueryChange,
  onCategoryChange,
  onSelect,
  onNew
}) {
  return (
    <aside className="memory-sidebar">
      <button
        type="button"
        className="memory-new"
        data-testid="memory-new"
        onClick={onNew}
      >
        <MemoryIcon
          name="plus"
          size={16}
        />
        添加记忆
      </button>

      <label className="memory-search">
        <MemoryIcon
          name="search"
          size={15}
        />
        <input
          value={query}
          placeholder="搜索记忆"
          aria-label="搜索记忆"
          onChange={(event) => {
            onQueryChange(
              event.target.value
            );
          }}
        />
      </label>

      <div className="memory-filters">
        {MEMORY_CATEGORY_OPTIONS.map(
          (option) => (
            <button
              key={option.value}
              type="button"
              className={
                category ===
                option.value
                  ? "is-active"
                  : ""
              }
              onClick={() => {
                onCategoryChange(
                  option.value
                );
              }}
            >
              {option.label}
            </button>
          )
        )}
      </div>

      <div className="memory-list">
        {loading && (
          <div className="memory-list-state">
            正在读取…
          </div>
        )}

        {!loading &&
          memories.length === 0 && (
            <div className="memory-list-state">
              没有匹配的记忆
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
            <span className="memory-list-item__meta">
              <span>
                {MEMORY_CATEGORY_LABELS[
                  memory.category
                ] ?? "其他"}
              </span>
              <span>
                {Math.round(
                  memory.importance *
                    100
                )}%
              </span>
            </span>
            <strong>
              {memory.content}
            </strong>
          </button>
        ))}
      </div>
    </aside>
  );
}
