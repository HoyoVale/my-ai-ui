import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  MemoryIcon
} from "./Icon.jsx";

const EMPTY_FORM = {
  title: "",
  content: "",
  description: "",
  tags: "",
  priority: 0.6,
  enabled: true
};

function formatCreatedAt(
  value
) {
  if (!value) {
    return "尚未创建";
  }

  return new Intl.DateTimeFormat(
    "zh-CN",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(new Date(value));
}

function tagsToText(tags) {
  return Array.isArray(tags)
    ? tags.join(", ")
    : "";
}

function formFromMemory(memory) {
  return {
    title:
      memory.title ?? "",
    content:
      memory.content ?? "",
    description:
      memory.description ?? "",
    tags:
      tagsToText(
        memory.tags
      ),
    priority:
      memory.priority ?? 0.5,
    enabled:
      memory.enabled ?? true
  };
}

function formSignature(form) {
  return JSON.stringify({
    ...form,
    title: form.title.trim(),
    content: form.content.trim(),
    description:
      form.description.trim(),
    tags:
      form.tags
        .split(/[,，]/u)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .join(",")
  });
}

function priorityText(value) {
  if (value >= 0.8) {
    return "高";
  }

  if (value >= 0.45) {
    return "中";
  }

  return "低";
}

export function MemoryEditor({
  memory,
  creating,
  busy,
  onDirtyChange,
  onCreate,
  onUpdate,
  onDelete,
  onCancelCreate
}) {
  const [form, setForm] =
    useState(EMPTY_FORM);
  const [baseline, setBaseline] =
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

    const nextForm =
      memory
        ? formFromMemory(memory)
        : EMPTY_FORM;

    setForm(nextForm);
    setBaseline(nextForm);
  }, [memory, creating]);

  const dirty =
    useMemo(
      () =>
        formSignature(form) !==
        formSignature(baseline),
      [form, baseline]
    );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const tags =
    useMemo(
      () =>
        form.tags
          .split(/[,，]/u)
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 12),
      [form.tags]
    );

  if (!memory && !creating) {
    return (
      <main
        className="memory-editor memory-editor--empty"
        data-testid="memory-empty"
      >
        <h2>选择或新建记忆</h2>
        <p>
          只保存未来会话仍然需要使用的信息。
        </p>
      </main>
    );
  }

  const setField = (
    field,
    value
  ) => {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
    setSavedMessage("");
  };

  const handleSave = async () => {
    const input = {
      ...form,
      title:
        form.title.trim(),
      content:
        form.content.trim(),
      description:
        form.description.trim(),
      tags
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

      if (result.memory) {
        const nextForm =
          formFromMemory(
            result.memory
          );

        setForm(nextForm);
        setBaseline(nextForm);
      }
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
      onKeyDown={(event) => {
        if (
          (event.ctrlKey ||
            event.metaKey) &&
          event.key.toLowerCase() ===
            "s"
        ) {
          event.preventDefault();

          if (
            !busy &&
            form.content.trim()
          ) {
            void handleSave();
          }
        }
      }}
    >
      <div className="memory-editor__scroll">
        <div className="memory-editor__content">
          <label className="memory-field memory-field--title">
            <span className="memory-field__label">
              标题
            </span>
            <input
              type="text"
              value={form.title}
              placeholder="例如：开发环境"
              data-testid="memory-title"
              maxLength={120}
              onChange={(event) => {
                setField(
                  "title",
                  event.target.value
                );
              }}
            />
          </label>

          <label className="memory-field memory-field--content">
            <span className="memory-field__label-row">
              <span className="memory-field__label">
                记忆正文
              </span>
              <small>
                {form.content.length}/2000
              </small>
            </span>
            <span className="memory-field__description">
              这部分会在相关问题中提供给模型。
            </span>
            <textarea
              value={form.content}
              placeholder="例如：用户主要使用 Windows 10 和 PowerShell。"
              data-testid="memory-content"
              maxLength={2000}
              onChange={(event) => {
                setField(
                  "content",
                  event.target.value
                );
              }}
            />
          </label>

          <label className="memory-field memory-field--description">
            <span className="memory-field__label">
              适用说明
            </span>
            <span className="memory-field__description">
              帮助你识别用途，也参与本地检索匹配。
            </span>
            <textarea
              value={form.description}
              placeholder="说明这条记忆在什么情况下有用"
              data-testid="memory-description"
              maxLength={500}
              onChange={(event) => {
                setField(
                  "description",
                  event.target.value
                );
              }}
            />
          </label>

          <label className="memory-field">
            <span className="memory-field__label">
              标签
            </span>
            <input
              type="text"
              value={form.tags}
              placeholder="Windows, Electron, UI"
              data-testid="memory-tags"
              maxLength={300}
              onChange={(event) => {
                setField(
                  "tags",
                  event.target.value
                );
              }}
            />

            {tags.length > 0 && (
              <span className="memory-tag-preview">
                {tags.map((tag) => (
                  <span key={tag}>
                    {tag}
                  </span>
                ))}
              </span>
            )}
          </label>

          <label className="memory-field memory-field--priority">
            <span className="memory-field__label-row">
              <span className="memory-field__label">
                检索优先级
              </span>
              <strong>
                {priorityText(
                  form.priority
                )} · {Math.round(
                  form.priority * 100
                )}%
              </strong>
            </span>
            <span className="memory-field__description">
              相关程度接近时，优先级更高的记忆更容易被选中。
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={form.priority}
              data-testid="memory-priority"
              onChange={(event) => {
                setField(
                  "priority",
                  Number(
                    event.target.value
                  )
                );
              }}
            />
          </label>
        </div>
      </div>

      <footer className="memory-editor__footer">
        <div className="memory-editor__footer-left">
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
              setField(
                "enabled",
                !form.enabled
              );
            }}
          >
            <span />
            {form.enabled
              ? "参与回答"
              : "暂不使用"}
          </button>

          <span className="memory-created-at">
            创建于 {formatCreatedAt(
              memory?.createdAt
            )}
          </span>

          <span
            className={
              `memory-save-status${
                dirty
                  ? " is-dirty"
                  : ""
              }`
            }
          >
            {savedMessage ||
              (dirty
                ? "有未保存的修改"
                : "已保存")}
          </span>
        </div>

        <div className="memory-editor__footer-actions">
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

          {!memory && (
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
            disabled={
              busy ||
              !form.content.trim() ||
              !dirty
            }
            data-testid="memory-save"
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
              : "保存"}
          </button>
        </div>
      </footer>
    </main>
  );
}
