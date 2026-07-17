import {
  useEffect,
  useRef,
  useState
} from "react";

import {
  MemoryIcon
} from "./Icon.jsx";

import {
  MEMORY_CATEGORY_OPTIONS
} from "../constants/categories.js";

const EMPTY_FORM = {
  category: "preference",
  content: "",
  importance: 0.6,
  enabled: true
};

function formatDate(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "zh-CN",
    {
      dateStyle: "medium",
      timeStyle: "short"
    }
  ).format(new Date(value));
}

export function MemoryEditor({
  memory,
  creating,
  busy,
  onCreate,
  onUpdate,
  onDelete,
  onCancelCreate
}) {
  const [form, setForm] =
    useState(EMPTY_FORM);
  const [savedMessage, setSavedMessage] =
    useState("");

  const lastIdentity =
    useRef("");

  useEffect(() => {
    const identity =
      `${creating}:${memory?.id ?? ""}`;

    if (
      lastIdentity.current ===
      identity
    ) {
      return;
    }

    lastIdentity.current =
      identity;

    setSavedMessage("");

    if (memory) {
      setForm({
        category:
          memory.category,
        content:
          memory.content,
        importance:
          memory.importance,
        enabled:
          memory.enabled
      });
      return;
    }

    setForm(EMPTY_FORM);
  }, [memory, creating]);

  if (!memory && !creating) {
    return (
      <main
        className="memory-editor memory-editor--empty"
        data-testid="memory-empty"
      >
        <div className="memory-empty-icon">
          <MemoryIcon
            name="brain"
            size={28}
          />
        </div>
        <h2>建立可控的长期记忆</h2>
        <p>
          手动保存稳定的资料、偏好、项目和约束。只有已启用且达到重要度阈值的记忆才会参与回复。
        </p>
      </main>
    );
  }

  const handleSave = async () => {
    const input = {
      ...form,
      content:
        form.content.trim()
    };

    const result = memory
      ? await onUpdate(
          memory.id,
          input
        )
      : await onCreate(input);

    if (result?.ok) {
      setSavedMessage(
        result.deduplicated ||
        result.merged
          ? "已与重复记忆合并"
          : "已保存"
      );
    }
  };

  const handleDelete = async () => {
    if (
      !memory ||
      !window.confirm(
        "确定删除这条记忆吗？"
      )
    ) {
      return;
    }

    await onDelete(memory.id);
  };

  return (
    <main
      className="memory-editor"
      data-testid="memory-editor"
    >
      <div className="memory-editor__header">
        <div>
          <span className="memory-eyebrow">
            {memory
              ? "编辑记忆"
              : "新建记忆"}
          </span>
          <h1>
            {memory
              ? "更新长期信息"
              : "添加长期信息"}
          </h1>
          <p>
            内容应当简短、稳定，并且在未来对话中仍然有用。
          </p>
        </div>

        {memory && (
          <button
            type="button"
            className="memory-danger-button"
            disabled={busy}
            data-testid="memory-delete"
            onClick={() => {
              void handleDelete();
            }}
          >
            <MemoryIcon
              name="trash"
              size={15}
            />
            删除
          </button>
        )}
      </div>

      <div className="memory-form-card">
        <label className="memory-field memory-field--wide">
          <span>记忆内容</span>
          <textarea
            value={form.content}
            placeholder="例如：用户喜欢简洁、接近 ChatGPT 的界面。"
            data-testid="memory-content"
            maxLength={2000}
            onChange={(event) => {
              setForm((current) => ({
                ...current,
                content:
                  event.target.value
              }));
              setSavedMessage("");
            }}
          />
          <small>
            {form.content.length}/2000
          </small>
        </label>

        <div className="memory-form-grid">
          <label className="memory-field">
            <span>类别</span>
            <select
              value={form.category}
              data-testid="memory-category"
              onChange={(event) => {
                setForm((current) => ({
                  ...current,
                  category:
                    event.target.value
                }));
              setSavedMessage("");
              }}
            >
              {MEMORY_CATEGORY_OPTIONS
                .filter(
                  (option) =>
                    option.value !==
                    "all"
                )
                .map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
            </select>
          </label>

          <div className="memory-field">
            <span>状态</span>
            <button
              type="button"
              role="switch"
              aria-checked={
                form.enabled
              }
              data-testid="memory-enabled"
              className={
                `memory-switch${
                  form.enabled
                    ? " is-on"
                    : ""
                }`
              }
              onClick={() => {
                setForm((current) => ({
                  ...current,
                  enabled:
                    !current.enabled
                }));
                setSavedMessage("");
              }}
            >
              <span />
              {form.enabled
                ? "已启用"
                : "已停用"}
            </button>
          </div>
        </div>

        <label className="memory-field memory-field--importance">
          <span>
            重要度
            <strong>
              {Math.round(
                form.importance *
                  100
              )}%
            </strong>
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={form.importance}
            data-testid="memory-importance"
            onChange={(event) => {
              setForm((current) => ({
                ...current,
                importance:
                  Number(
                    event.target.value
                  )
              }));
              setSavedMessage("");
            }}
          />
          <small>
            重要度越高，在检索结果中越优先。
          </small>
        </label>
      </div>

      {memory && (
        <div className="memory-metadata">
          <span>
            创建：{formatDate(
              memory.createdAt
            )}
          </span>
          <span>
            更新：{formatDate(
              memory.updatedAt
            )}
          </span>
        </div>
      )}

      <div className="memory-editor__footer">
        <span className="memory-save-status">
          {savedMessage}
        </span>
        <div>
          {creating && (
            <button
              type="button"
              className="memory-secondary"
              disabled={busy}
              onClick={onCancelCreate}
            >
              取消
            </button>
          )}
          <button
            type="button"
            className="memory-primary"
            data-testid="memory-save"
            disabled={
              busy ||
              !form.content.trim()
            }
            onClick={() => {
              void handleSave();
            }}
          >
            <MemoryIcon
              name="save"
              size={15}
            />
            {busy
              ? "保存中…"
              : "保存记忆"}
          </button>
        </div>
      </div>
    </main>
  );
}
