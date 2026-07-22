import {
  useEffect,
  useMemo,
  useState
} from "react";

const ACTIVE_AGENT_STATES = new Set([
  "running",
  "stopping",
  "cancelling"
]);

export function useConversationViewController({
  settings,
  theme,
  isMaximized,
  history,
  agentStatus
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [taskTargetMessageId, setTaskTargetMessageId] = useState(null);
  const [query, setQuery] = useState("");
  const [sidebarMode, setSidebarMode] = useState("chat");

  const currentConversationId = history.current?.id ?? "";
  const currentLiveActivity =
    agentStatus.conversationId === currentConversationId &&
    ACTIVE_AGENT_STATES.has(agentStatus.state)
      ? agentStatus
      : null;

  useEffect(() => {
    if (history.current?.mode) {
      setSidebarMode(history.current.mode === "coding" ? "coding" : "chat");
    }
  }, [history.current?.id, history.current?.mode]);

  useEffect(() => {
    setTaskOpen(false);
    setGoalOpen(false);
    setTaskTargetMessageId(null);
  }, [currentConversationId]);

  const rootClassName = useMemo(() => [
    "conversation-shell",
    theme === "dark" ? "theme-dark" : "",
    settings.appearance.reducedMotion ? "reduce-motion" : "",
    sidebarCollapsed ? "is-sidebar-collapsed" : "",
    contextOpen || taskOpen || goalOpen ? "is-context-open" : "",
    isMaximized ? "is-maximized" : ""
  ].filter(Boolean).join(" "), [
    contextOpen,
    goalOpen,
    isMaximized,
    settings.appearance.reducedMotion,
    sidebarCollapsed,
    taskOpen,
    theme
  ]);

  const openInput = () => window.api?.openInput?.();

  const resetContext = async () => {
    if (!history.current) return;
    if (!window.confirm("重置当前短期上下文？历史消息仍会保留，固定消息不受影响。")) return;
    await history.resetContext(history.current.id);
  };

  const createForWorkspace = ({ mode, workspaceId }) => {
    const normalizedMode = mode === "coding" ? "coding" : "chat";
    if (normalizedMode === "coding" && !workspaceId) return;
    void history.create({
      mode: normalizedMode,
      workspaceId: workspaceId ?? null,
      modelSelection:
        history.current?.mode === normalizedMode &&
        (history.current?.workspaceId ?? null) === (workspaceId ?? null)
          ? history.current?.modelSelection ?? undefined
          : undefined
    });
  };

  const toggleContext = () => {
    setTaskOpen(false);
    setGoalOpen(false);
    setContextOpen((current) => !current);
  };

  const toggleTask = () => {
    setContextOpen(false);
    setGoalOpen(false);
    setTaskOpen((current) => !current);
    setTaskTargetMessageId((current) => current ?? (currentLiveActivity ? "live" : null));
  };

  const toggleGoal = () => {
    setContextOpen(false);
    setTaskOpen(false);
    setGoalOpen((current) => !current);
  };

  const openTaskPanel = (messageId) => {
    setContextOpen(false);
    setGoalOpen(false);
    setTaskTargetMessageId(messageId);
    setTaskOpen(true);
  };

  return {
    sidebarCollapsed,
    contextOpen,
    taskOpen,
    goalOpen,
    taskTargetMessageId,
    query,
    sidebarMode,
    currentLiveActivity,
    rootClassName,
    setSidebarCollapsed,
    setContextOpen,
    setTaskOpen,
    setGoalOpen,
    setQuery,
    setSidebarMode,
    openInput,
    resetContext,
    createForWorkspace,
    toggleContext,
    toggleTask,
    toggleGoal,
    openTaskPanel
  };
}
