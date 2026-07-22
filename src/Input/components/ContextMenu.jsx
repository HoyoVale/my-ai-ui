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

function goalCriteriaFromLines(value, currentGoal) {
  const existing = new Map((currentGoal?.criteria ?? []).map((item) => [item.text, item]));
  return String(value ?? "")
    .split(/\n/gu)
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((text, index) => ({
      id: existing.get(text)?.id ?? `criterion-${index + 1}`,
      text,
      verificationKind: existing.get(text)?.verificationKind ?? "auto",
      manualSatisfied: existing.get(text)?.manualSatisfied === true
    }));
}

export const InputContextMenu = forwardRef(function InputContextMenu({
  context,
  disabled,
  closeToken = 0,
  onOpenChange,
  onPanelHeightChange,
  onSelectSession,
  onCreateSession,
  onAddWorkspace,
  onSkillChange,
  onGoalChange,
  onModelChange,
  onToggleMcp,
  onToggleMcpServer
}, ref) {
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const lastPanelHeightRef = useRef(0);
  const consumedCloseTokenRef = useRef(closeToken);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState("root");
  const [targetMode, setTargetMode] = useState("chat");
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(null);
  const [targetSkillIds, setTargetSkillIds] = useState([]);
  const targetSkillId = targetSkillIds[0] ?? "";
  const [targetRoutingMode, setTargetRoutingMode] = useState("manual");
  const [goalDraft, setGoalDraft] = useState("");
  const [goalCriteriaDraft, setGoalCriteriaDraft] = useState("");
  const [goalAutoContinue, setGoalAutoContinue] = useState(true);
  const [actionError, setActionError] = useState("");

  const currentMode = normalizeSessionMode(context?.mode, "chat");
  const currentWorkspaceId = context?.workspaceId ?? null;
  const currentConversationId = context?.currentConversationId ?? null;
  const currentConversationTitle =
    context?.currentConversationTitle ?? "新会话";
  const currentGoal = context?.currentGoal ?? null;

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
  const mcp = context?.mcp ?? { enabled: false, servers: [] };
  const mcpServers = Array.isArray(mcp.servers) ? mcp.servers : [];
  const enabledMcpServers = mcpServers.filter((server) => server.enabled !== false);
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
  const currentSkillIds = useMemo(
    () => Array.isArray(context?.currentSkillIds)
      ? context.currentSkillIds
      : context?.currentSkillId ? [context.currentSkillId] : [],
    [context?.currentSkillId, context?.currentSkillIds]
  );
  const currentRuntimeSkills = currentSkillIds
    .map((id) => allSkills.find((skill) => skill.id === id))
    .filter(Boolean);
  const displayedSkills = targetMatchesCurrent
    ? currentRuntimeSkills.length ? currentRuntimeSkills : context?.currentSkills ?? []
    : targetSkillIds.map((id) => targetSkills.find((skill) => skill.id === id)).filter(Boolean);
  const boundSkillChanged = Boolean(
    targetMatchesCurrent &&
    (context?.currentSkills ?? []).some((snapshot) => {
      const current = allSkills.find((skill) => skill.id === snapshot.id);
      return current && snapshot.packageHash && current.runtimeFingerprint &&
        snapshot.packageHash !== current.runtimeFingerprint;
    })
  );
  const boundSkillUnavailable = Boolean(
    targetMatchesCurrent &&
    currentSkillIds.length &&
    (currentRuntimeSkills.length !== currentSkillIds.length || boundSkillChanged)
  );


  const setMenuOpen = useCallback((nextOpen) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);

    if (nextOpen) {
      setPage("root");
      setTargetMode(currentMode);
      setTargetWorkspaceId(currentWorkspaceId);
      setTargetSkillIds(currentSkillIds);
      setTargetRoutingMode(context?.currentSkillRoutingMode === "auto" ? "auto" : "manual");
      setGoalDraft(currentGoal?.objective ?? "");
      setGoalCriteriaDraft((currentGoal?.criteria ?? []).map((item) => item.text).join("\n"));
      setGoalAutoContinue(currentGoal?.autoContinue !== false);
      setActionError("");
    } else if (lastPanelHeightRef.current !== 0) {
      lastPanelHeightRef.current = 0;
      onPanelHeightChange?.(0);
    }
  }, [
    context?.currentSkillRoutingMode,
    currentGoal?.autoContinue,
    currentGoal?.criteria,
    currentGoal?.objective,
    currentSkillIds,
    currentMode,
    currentWorkspaceId,
    onOpenChange,
    onPanelHeightChange
  ]);

  useImperativeHandle(ref, () => ({
    openPage(nextPage = "root") {
      if (disabled) return false;
      setMenuOpen(true);
      setPage(["root", "mode", "workspace", "session", "goal", "skill", "mcp", "model"]
        .includes(nextPage) ? nextPage : "root");
      return true;
    },
    close() {
      setMenuOpen(false);
    }
  }), [disabled, setMenuOpen]);

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
    // closeToken is an edge-triggered event, not a persistent "closed" flag.
    // Consuming the latest value while the menu is closed prevents every
    // future open from being immediately cancelled after Slash was used once.
    if (closeToken === consumedCloseTokenRef.current) return;
    consumedCloseTokenRef.current = closeToken;
    if (open) setMenuOpen(false);
  }, [closeToken, open, setMenuOpen]);

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
      const nextHeight = Math.max(
        0,
        Math.ceil(panel.offsetHeight)
      );

      if (nextHeight === lastPanelHeightRef.current) {
        return;
      }

      lastPanelHeightRef.current = nextHeight;
      onPanelHeightChange?.(nextHeight);
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
    mcpServers.length,
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
    setTargetSkillIds(
      normalized === currentMode
        ? currentSkillIds.filter((id) =>
            allSkills.some((skill) => skill.id === id && skill.modes?.includes(normalized))
          )
        : []
    );
    setTargetRoutingMode(
      normalized === currentMode && context?.currentSkillRoutingMode === "auto"
        ? "auto"
        : "manual"
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
      skillId: targetSkillId,
      skillIds: targetSkillIds,
      skillRoutingMode: targetRoutingMode
    });

    if (result?.ok === false) {
      setActionError(result.message ?? "无法创建会话。");
      return;
    }

    setMenuOpen(false);
  };

  const toggleSkill = (skillId) => {
    setActionError("");
    const normalizedSkillId = String(skillId ?? "").trim();
    if (!targetSkills.some((skill) => skill.id === normalizedSkillId)) {
      setActionError("该 Skill 不支持当前目标模式。");
      return;
    }
    setTargetRoutingMode("manual");
    setTargetSkillIds((current) => {
      if (current.includes(normalizedSkillId)) {
        return current.filter((id) => id !== normalizedSkillId);
      }
      if (current.length >= 4) {
        setActionError("一个会话最多组合 4 个 Skill。");
        return current;
      }
      return [...current, normalizedSkillId];
    });
  };

  const applySkillSelection = async () => {
    setActionError("");
    if (!targetMatchesCurrent) {
      setPage("root");
      return;
    }
    const result = await onSkillChange?.({
      skillId: targetSkillId,
      skillIds: targetSkillIds,
      skillRoutingMode: targetRoutingMode
    });
    if (result?.ok === false) {
      setActionError(result.message ?? "无法切换 Skill。");
      return;
    }
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

  const updateGoal = async ({
    objective = goalDraft,
    status = "active",
    criteria = goalCriteriaFromLines(goalCriteriaDraft, currentGoal),
    autoContinue = goalAutoContinue
  } = {}) => {
    setActionError("");
    const result = await onGoalChange?.({ objective, status, criteria, autoContinue });
    if (result?.ok === false) {
      setActionError(result.message ?? "无法更新 Goal。");
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
        label="Goal"
        value={
          currentGoal?.status === "active"
            ? "进行中"
            : currentGoal?.status === "paused"
              ? "已暂停"
              : currentGoal?.status === "completed"
                ? "已完成"
                : "未设置"
        }
        trailing={<Chevron />}
        onClick={() => setPage("goal")}
        testId="input-context-goal"
      />
      <MenuItem
        label="Skill"
        value={
          targetRoutingMode === "auto" && !displayedSkills.length
            ? "自动"
            : displayedSkills.length === 1
              ? `${displayedSkills[0].name}${boundSkillChanged ? "（需重新绑定）" : boundSkillUnavailable ? "（不可用）" : ""}`
              : displayedSkills.length > 1
                ? `${displayedSkills.length} 个组合`
                : "无"
        }
        trailing={<Chevron />}
        onClick={() => setPage("skill")}
        testId="input-context-skill"
      />
      <MenuItem
        label="MCP"
        value={
          mcp.enabled === false
            ? "关闭"
            : mcpServers.length
              ? `${enabledMcpServers.length}/${mcpServers.length}`
              : "无连接"
        }
        trailing={<Chevron />}
        onClick={() => setPage("mcp")}
        testId="input-context-mcp"
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
          label="自动选择"
          description="仅在没有手动选择时，根据任务关键词保守选择一个 Skill"
          selected={targetRoutingMode === "auto" && targetSkillIds.length === 0}
          onClick={() => {
            setTargetRoutingMode("auto");
            setTargetSkillIds([]);
          }}
          testId="input-skill-auto"
        />
        <MenuItem
          label="不使用 Skill"
          description="仅使用当前模式的默认工具与上下文"
          selected={targetRoutingMode === "manual" && targetSkillIds.length === 0}
          onClick={() => {
            setTargetRoutingMode("manual");
            setTargetSkillIds([]);
          }}
          testId="input-skill-none"
        />
        {boundSkillUnavailable && (
          <div className="input-context-menu__notice is-warning">
            {boundSkillChanged
              ? "当前 Skill 组合中有包已更新。重新应用组合以刷新会话绑定。"
              : "当前组合包含已禁用、卸载或完整性异常的 Skill。"}
          </div>
        )}
        <div className="input-context-menu__divider" />
        {targetSkills.map((skill) => (
          <MenuItem
            key={skill.id}
            label={skill.name}
            description={skill.description}
            value={`v${skill.version}`}
            selected={targetSkillIds.includes(skill.id)}
            onClick={() => toggleSkill(skill.id)}
            testId={`input-skill-${skill.id}`}
          />
        ))}
        {!targetSkills.length && (
          <div className="input-context-menu__empty">当前模式没有可用 Skill</div>
        )}
        <div className="input-context-menu__notice">
          可在消息开头使用 <code>/skill-id 任务</code> 临时调用；连续写多个命令可临时组合。
        </div>
        <div className="input-context-menu__divider" />
        <MenuItem
          label={targetMatchesCurrent ? "应用到当前会话" : "用于新会话"}
          value={targetSkillIds.length ? `${targetSkillIds.length} 个` : targetRoutingMode === "auto" ? "自动" : "无"}
          accent
          disabled={context?.busy}
          onClick={() => { void applySkillSelection(); }}
          testId="input-skill-apply"
        />
      </div>
    </>
  );

  const renderGoalPage = () => (
    <>
      {renderPageHeader("Goal")}
      <div className="input-goal-editor">
        <textarea
          data-testid="input-goal-objective"
          value={goalDraft}
          maxLength={4000}
          rows={5}
          placeholder="描述最终结果…"
          onChange={(event) => setGoalDraft(event.target.value)}
        />
        <textarea
          data-testid="input-goal-criteria"
          value={goalCriteriaDraft}
          maxLength={6000}
          rows={4}
          placeholder={"Done when（每行一条）\n例如：npm test 全部通过"}
          onChange={(event) => setGoalCriteriaDraft(event.target.value)}
        />
        <label className="input-goal-editor__toggle">
          <input
            type="checkbox"
            checked={goalAutoContinue}
            onChange={(event) => setGoalAutoContinue(event.target.checked)}
          />
          <span>证据不足且仍有进展时自动继续</span>
        </label>
        <div className="input-context-menu__notice">
          Goal 绑定当前会话。新消息会作为推进目标的补充指令；只有完成验证通过后才会自动标记完成。
        </div>
        <div className="input-goal-editor__actions">
          {currentGoal && (
            <button
              type="button"
              className="is-secondary"
              data-testid="input-goal-clear"
              onClick={() => { void updateGoal({ objective: "", criteria: [] }); }}
            >
              清除
            </button>
          )}
          {currentGoal?.status === "active" && (
            <button
              type="button"
              className="is-secondary"
              data-testid="input-goal-pause"
              onClick={() => { void updateGoal({ objective: goalDraft, status: "paused" }); }}
            >
              暂停
            </button>
          )}
          <button
            type="button"
            className="is-primary"
            data-testid="input-goal-save"
            disabled={!goalDraft.trim() || context?.busy}
            onClick={() => { void updateGoal({ status: "active" }); }}
          >
            {currentGoal?.status === "paused" || currentGoal?.status === "completed"
              ? "恢复并保存"
              : currentGoal
                ? "保存"
                : "设为 Goal"}
          </button>
        </div>
      </div>
    </>
  );

  const toggleMcp = async (enabled) => {
    setActionError("");
    const result = await onToggleMcp?.(enabled);
    if (result?.ok === false) setActionError(result.message ?? "无法更新 MCP。 ".trim());
  };

  const toggleMcpServer = async (serverId, enabled) => {
    setActionError("");
    const result = await onToggleMcpServer?.(serverId, enabled);
    if (result?.ok === false) setActionError(result.message ?? "无法更新 MCP 连接。 ".trim());
  };

  const renderMcpPage = () => (
    <>
      {renderPageHeader("MCP")}
      <div className="input-context-menu__items input-context-menu__items--scroll">
        <MenuItem
          label="启用 MCP"
          description="快速控制所有 MCP 连接是否可供新任务使用"
          selected={mcp.enabled !== false}
          onClick={() => { void toggleMcp(mcp.enabled === false); }}
          testId="input-mcp-enabled"
        />
        <div className="input-context-menu__divider" />
        {mcpServers.map((server) => (
          <MenuItem
            key={server.id}
            label={server.name || server.id}
            description={server.transport === "stdio" ? "本地 MCP" : "远程 MCP"}
            value={server.enabled === false ? "关闭" : "启用"}
            selected={server.enabled !== false}
            disabled={mcp.enabled === false}
            onClick={() => { void toggleMcpServer(server.id, server.enabled === false); }}
            testId={`input-mcp-${server.id}`}
          />
        ))}
        {!mcpServers.length && (
          <div className="input-context-menu__empty">请先在 Setting → MCP 添加连接</div>
        )}
        <div className="input-context-menu__notice">
          正在运行的任务继续使用启动时快照；切换仅影响后续任务。
        </div>
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
      {page === "goal" && renderGoalPage()}
      {page === "skill" && renderSkillPage()}
          {page === "mcp" && renderMcpPage()}
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
});
