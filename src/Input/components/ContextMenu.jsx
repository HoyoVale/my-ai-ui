import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  filterSessionsForContext,
  normalizeSessionMode
} from "../../shared/sessionNavigation.js";

function Chevron({ direction = "right" }) {
  const rotation = direction === "left" ? 180 : 0;

  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function PlusIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function MenuItem({
  label,
  description = "",
  value = "",
  selected = false,
  disabled = false,
  accent = false,
  trailing = null,
  onClick,
  testId
}) {
  return (
    <button
      type="button"
      className={`input-context-menu__item${selected ? " is-selected" : ""}${accent ? " is-accent" : ""}`}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="input-context-menu__item-copy">
        <span className="input-context-menu__item-label" title={label}>
          {label}
        </span>
        {description && (
          <span className="input-context-menu__item-description">
            {description}
          </span>
        )}
      </span>
      <span className="input-context-menu__item-end">
        {value && (
          <span className="input-context-menu__item-value" title={value}>
            {value}
          </span>
        )}
        <span className="input-context-menu__item-mark">
          {selected ? <CheckMark /> : trailing}
        </span>
      </span>
    </button>
  );
}


function recentWorkspaceForMode(conversations, mode) {
  const recent = (Array.isArray(conversations) ? conversations : [])
    .filter((conversation) =>
      normalizeSessionMode(conversation?.mode) === mode
    )
    .sort(
      (left, right) =>
        Number(right?.updatedAt ?? 0) -
        Number(left?.updatedAt ?? 0)
    )[0];

  return recent?.workspaceId ?? null;
}

export function InputContextMenu({
  context,
  disabled,
  onOpenChange,
  onPanelHeightChange,
  onSelectSession,
  onCreateSession,
  onAddWorkspace,
  onSkillChange,
  onModelChange
}) {
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState("root");
  const [targetMode, setTargetMode] = useState("chat");
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(null);
  const [targetSkillId, setTargetSkillId] = useState(null);
  const [actionError, setActionError] = useState("");

  const currentMode = normalizeSessionMode(context?.mode, "chat");
  const currentWorkspaceId = context?.workspaceId ?? null;
  const currentConversationId = context?.currentConversationId ?? null;
  const currentConversationTitle =
    context?.currentConversationTitle ?? "新会话";

  const workspaces = useMemo(
    () => Array.isArray(context?.workspaces)
      ? context.workspaces
      : [],
    [context?.workspaces]
  );
  const conversations = useMemo(
    () => Array.isArray(context?.conversations)
      ? context.conversations
      : [],
    [context?.conversations]
  );
  const models = useMemo(
    () => Array.isArray(context?.models)
      ? context.models
      : [],
    [context?.models]
  );
  const allSkills = useMemo(
    () => Array.isArray(context?.skills) ? context.skills : [],
    [context?.skills]
  );
  const targetSkills = useMemo(
    () => allSkills.filter((skill) => skill.modes?.includes(targetMode)),
    [allSkills, targetMode]
  );

  const workspaceMap = useMemo(
    () => new Map(
      workspaces.map((workspace) => [workspace.id, workspace])
    ),
    [workspaces]
  );

  const matchingSessions = useMemo(
    () => filterSessionsForContext(
      conversations,
      {
        mode: targetMode,
        workspaceId: targetWorkspaceId
      }
    ),
    [conversations, targetMode, targetWorkspaceId]
  );

  const targetWorkspaceLabel = targetWorkspaceId
    ? workspaceMap.get(targetWorkspaceId)?.name ?? "不可用"
    : targetMode === "chat"
      ? "无"
      : "选择";

  const targetMatchesCurrent =
    targetMode === currentMode &&
    targetWorkspaceId === currentWorkspaceId;

  const currentModel = models.find(
    (model) => model.value === context?.modelValue
  ) ?? null;
  const currentRuntimeSkill = allSkills.find(
    (skill) => skill.id === context?.currentSkillId
  ) ?? null;
  const targetSkill = targetSkills.find(
    (skill) => skill.id === targetSkillId
  ) ?? null;
  const displayedSkill = targetMatchesCurrent
    ? currentRuntimeSkill ?? context?.currentSkill ?? null
    : targetSkill;
  const boundSkillChanged = Boolean(
    targetMatchesCurrent &&
    currentRuntimeSkill &&
    context?.currentSkill?.packageHash &&
    currentRuntimeSkill.runtimeFingerprint &&
    context.currentSkill.packageHash !== currentRuntimeSkill.runtimeFingerprint
  );
  const boundSkillUnavailable = Boolean(
    targetMatchesCurrent &&
    context?.currentSkillId &&
    (!currentRuntimeSkill || boundSkillChanged)
  );


  const setMenuOpen = useCallback((nextOpen) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);

    if (nextOpen) {
      setPage("root");
      setTargetMode(currentMode);
      setTargetWorkspaceId(currentWorkspaceId);
      setTargetSkillId(context?.currentSkillId ?? null);
      setActionError("");
    } else {
      onPanelHeightChange?.(0);
    }
  }, [
    context?.currentSkillId,
    currentMode,
    currentWorkspaceId,
    onOpenChange,
    onPanelHeightChange
  ]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();

      if (page !== "root") {
        setPage("root");
      } else {
        setMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, page, setMenuOpen]);

  useEffect(() => {
    if (disabled && open) {
      setMenuOpen(false);
    }
  }, [disabled, open, setMenuOpen]);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) {
      return undefined;
    }

    const panel = panelRef.current;
    const publishHeight = () => {
      onPanelHeightChange?.(
        Math.ceil(
          panel.offsetHeight
        )
      );
    };

    publishHeight();

    if (typeof ResizeObserver !== "function") {
      return undefined;
    }

    const observer =
      new ResizeObserver(publishHeight);

    observer.observe(panel);

    return () => {
      observer.disconnect();
    };
  }, [
    open,
    page,
    models.length,
    matchingSessions.length,
    targetSkills.length,
    workspaces.length,
    onPanelHeightChange
  ]);

  const selectMode = (mode) => {
    const normalized = normalizeSessionMode(mode);
    setTargetMode(normalized);

    const nextWorkspaceId = normalized === currentMode
      ? currentWorkspaceId
      : recentWorkspaceForMode(conversations, normalized);

    setTargetWorkspaceId(
      normalized === "coding"
        ? nextWorkspaceId
        : nextWorkspaceId ?? null
    );
    setTargetSkillId(
      normalized === currentMode &&
      allSkills.some((skill) =>
        skill.id === context?.currentSkillId &&
        skill.modes?.includes(normalized)
      )
        ? context?.currentSkillId ?? null
        : null
    );
    setActionError("");
    setPage("workspace");
  };

  const addWorkspace = async () => {
    setActionError("");
    const result = await onAddWorkspace?.();

    if (result?.ok === false) {
      setActionError(result.message ?? "无法添加工作区。");
      return;
    }

    if (result?.workspace?.id) {
      setTargetWorkspaceId(result.workspace.id);
      setPage("session");
    }
  };

  const selectSession = async (conversationId) => {
    setActionError("");
    const result = await onSelectSession?.(conversationId);

    if (result?.ok === false) {
      setActionError(result.message ?? "无法打开会话。");
      return;
    }

    setMenuOpen(false);
  };

  const createSession = async () => {
    if (targetMode === "coding" && !targetWorkspaceId) {
      setActionError("Coding 会话需要工作区。");
      setPage("workspace");
      return;
    }

    setActionError("");
    const result = await onCreateSession?.({
      mode: targetMode,
      workspaceId: targetWorkspaceId,
      modelSelection: context?.currentModelSelection ?? undefined,
      skillId: targetSkillId
    });

    if (result?.ok === false) {
      setActionError(result.message ?? "无法创建会话。");
      return;
    }

    setMenuOpen(false);
  };

  const selectSkill = async (skillId) => {
    setActionError("");
    const normalizedSkillId = skillId ? String(skillId) : null;
    if (
      normalizedSkillId &&
      !targetSkills.some((skill) => skill.id === normalizedSkillId)
    ) {
      setActionError("该 Skill 不支持当前目标模式。");
      return;
    }

    if (!targetMatchesCurrent) {
      setTargetSkillId(normalizedSkillId);
      setPage("root");
      return;
    }

    const result = await onSkillChange?.(normalizedSkillId);
    if (result?.ok === false) {
      setActionError(result.message ?? "无法切换 Skill。");
      return;
    }

    setTargetSkillId(normalizedSkillId);
    setMenuOpen(false);
  };

  const selectModel = async (value) => {
    setActionError("");
    const result = await onModelChange?.(value);

    if (result?.ok === false) {
      setActionError(result.message ?? "无法切换模型。");
      return;
    }

    setMenuOpen(false);
  };

  const renderRoot = () => (
    <div className="input-context-menu__items">
      <MenuItem
        label="模式"
        value={targetMode === "coding" ? "Coding" : "Chat"}
        trailing={<Chevron />}
        onClick={() => setPage("mode")}
        testId="input-context-mode"
      />
      <MenuItem
        label="工作区"
        value={targetWorkspaceLabel}
        trailing={<Chevron />}
        onClick={() => setPage("workspace")}
        testId="input-context-workspace"
      />
      <MenuItem
        label="会话"
        value={targetMatchesCurrent ? currentConversationTitle : "选择"}
        trailing={<Chevron />}
        onClick={() => setPage("session")}
        testId="input-context-session"
      />
      <MenuItem
        label="Skill"
        value={
          displayedSkill?.name
            ? `${displayedSkill.name}${boundSkillChanged ? "（需重新绑定）" : boundSkillUnavailable ? "（不可用）" : ""}`
            : "无"
        }
        trailing={<Chevron />}
        onClick={() => setPage("skill")}
        testId="input-context-skill"
      />
      <MenuItem
        label="模型"
        value={currentModel?.label ?? "未配置"}
        trailing={<Chevron />}
        disabled={!models.length}
        onClick={() => setPage("model")}
        testId="input-context-model"
      />
    </div>
  );

  const renderPageHeader = (title) => (
    <div className="input-context-menu__subhead">
      <button
        type="button"
        aria-label="返回"
        onClick={() => setPage("root")}
      >
        <Chevron direction="left" />
      </button>
      <span>{title}</span>
    </div>
  );

  const renderModePage = () => (
    <>
      {renderPageHeader("模式")}
      <div className="input-context-menu__items">
        <MenuItem
          label="Chat"
          selected={targetMode === "chat"}
          onClick={() => selectMode("chat")}
        />
        <MenuItem
          label="Coding"
          selected={targetMode === "coding"}
          onClick={() => selectMode("coding")}
        />
      </div>
    </>
  );

  const chooseWorkspace = (workspaceId) => {
    setTargetWorkspaceId(workspaceId);
    setActionError("");
    setPage("session");
  };

  const renderWorkspacePage = () => (
    <>
      {renderPageHeader("工作区")}
      <div className="input-context-menu__items input-context-menu__items--scroll">
        {targetMode === "chat" && (
          <MenuItem
            label="无"
            selected={targetWorkspaceId === null}
            onClick={() => chooseWorkspace(null)}
            testId="input-workspace-none"
          />
        )}
        {workspaces.map((workspace) => (
          <MenuItem
            key={workspace.id}
            label={workspace.name}
            selected={targetWorkspaceId === workspace.id}
            onClick={() => chooseWorkspace(workspace.id)}
          />
        ))}
        <div className="input-context-menu__divider" />
        <MenuItem
          label="添加工作区"
          accent
          disabled={context?.busy}
          onClick={() => {
            void addWorkspace();
          }}
          testId="input-add-workspace"
          trailing={<PlusIcon size={15} />}
        />
      </div>
    </>
  );

  const renderSessionPage = () => (
    <>
      {renderPageHeader("会话")}
      <div className="input-context-menu__items input-context-menu__items--scroll">
        {targetMode === "coding" && !targetWorkspaceId ? (
          <MenuItem
            label="先选择工作区"
            onClick={() => setPage("workspace")}
            trailing={<Chevron />}
          />
        ) : (
          <>
            {matchingSessions.map((conversation) => (
              <MenuItem
                key={conversation.id}
                label={conversation.title}
                selected={conversation.id === currentConversationId}
                onClick={() => {
                  void selectSession(conversation.id);
                }}
              />
            ))}
            {!matchingSessions.length && (
              <div className="input-context-menu__empty">
                暂无会话
              </div>
            )}
            <div className="input-context-menu__divider" />
            <MenuItem
              label="新建会话"
              accent
              disabled={context?.busy}
              onClick={() => {
                void createSession();
              }}
              testId="input-create-session"
              trailing={<PlusIcon size={15} />}
            />
          </>
        )}
      </div>
    </>
  );

  const renderSkillPage = () => (
    <>
      {renderPageHeader("Skill")}
      <div className="input-context-menu__items input-context-menu__items--scroll">
        <MenuItem
          label="无 Skill"
          description="仅使用当前模式下的默认工具与上下文"
          selected={!targetSkillId}
          onClick={() => {
            void selectSkill(null);
          }}
          testId="input-skill-none"
        />
        {boundSkillUnavailable && (
          <div className="input-context-menu__notice is-warning">
            {boundSkillChanged
              ? "当前 Skill 已更新。重新选择它以刷新会话绑定，旧任务不会静默使用新版本。"
              : "当前绑定的 Skill 已禁用、卸载或完整性异常。请选择其他 Skill，或清除绑定。"}
          </div>
        )}
        {targetSkills.map((skill) => (
          <MenuItem
            key={skill.id}
            label={skill.name}
            description={skill.description}
            value={`v${skill.version}`}
            selected={skill.id === targetSkillId}
            onClick={() => {
              void selectSkill(skill.id);
            }}
            testId={`input-skill-${skill.id}`}
          />
        ))}
        {!targetSkills.length && (
          <div className="input-context-menu__empty">
            当前模式没有可用 Skill
          </div>
        )}
      </div>
    </>
  );

  const renderModelPage = () => (
    <>
      {renderPageHeader("模型")}
      <div className="input-context-menu__items input-context-menu__items--scroll">
        {models.map((model) => (
          <MenuItem
            key={model.value}
            label={model.label}
            selected={model.value === context?.modelValue}
            onClick={() => {
              void selectModel(model.value);
            }}
          />
        ))}
        {!models.length && (
          <div className="input-context-menu__empty">
            尚未添加模型
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="input-context-menu" ref={rootRef}>
      <button
        className={`input-context-menu__trigger${open ? " is-open" : ""}`}
        type="button"
        data-testid="input-context-menu-trigger"
        aria-label="会话与模型"
        title="会话与模型"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setMenuOpen(!open)}
      >
        <PlusIcon />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="input-context-menu__panel"
          data-testid="input-context-menu-panel"
        >
          {page === "root" && renderRoot()}
          {page === "mode" && renderModePage()}
          {page === "workspace" && renderWorkspacePage()}
          {page === "session" && renderSessionPage()}
          {page === "skill" && renderSkillPage()}
          {page === "model" && renderModelPage()}

          {(actionError || context?.error) && (
            <div className="input-context-menu__error">
              {actionError || context.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
