import {
  useEffect,
  useMemo,
  useState
} from "react";

import { ConversationContextInspector } from "./components/ContextInspector.jsx";
import { ConversationMessageList } from "./components/MessageList.jsx";
import { ConversationPlanDock } from "./components/PlanDock.jsx";
import { ConversationTaskPanel } from "./components/TaskPanel.jsx";
import { ToolApprovalPanel } from "./components/ToolApprovalPanel.jsx";
import { ConversationSidebar } from "./components/Sidebar.jsx";
import { ConversationTopbar } from "./components/Topbar.jsx";
import { useConversationHistory } from "./hooks/useConversationHistory.js";
import { useWindowMaximized } from "../shared/hooks/useWindowMaximized.js";
import { useAppSettings } from "../shared/hooks/useAppSettings.js";
import { useResolvedTheme } from "../shared/hooks/useResolvedTheme.js";
import { useAgentStatus } from "../shared/hooks/useAgentStatus.js";
import { getWindowTypographyStyle } from "../shared/typography.js";

import "./Conversation.css";

export default function Conversation() {
  const settings = useAppSettings();
  const theme = useResolvedTheme(settings.appearance.theme);
  const developerMode = settings.general?.developerMode === true;
  const isMaximized = useWindowMaximized();
  const history = useConversationHistory();
  const { status: agentStatus } = useAgentStatus();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskTargetMessageId, setTaskTargetMessageId] = useState(null);
  const [query, setQuery] = useState("");
  const [sidebarMode, setSidebarMode] = useState("chat");

  const workspaces = Array.isArray(settings.workspaces?.items)
    ? settings.workspaces.items
    : [];
  const currentConversationId = history.current?.id ?? "";
  const currentLiveActivity =
    agentStatus.conversationId === history.current?.id &&
    ["running", "stopping", "cancelling"].includes(agentStatus.state)
      ? agentStatus
      : null;

  useEffect(() => {
    if (history.current?.mode) {
      setSidebarMode(history.current.mode === "coding" ? "coding" : "chat");
    }
  }, [history.current?.id, history.current?.mode]);

  useEffect(() => {
    setTaskOpen(false);
    setTaskTargetMessageId(null);
  }, [currentConversationId]);

  const rootClassName = useMemo(() => [
    "conversation-shell",
    theme === "dark" ? "theme-dark" : "",
    settings.appearance.reducedMotion ? "reduce-motion" : "",
    sidebarCollapsed ? "is-sidebar-collapsed" : "",
    contextOpen || taskOpen ? "is-context-open" : "",
    isMaximized ? "is-maximized" : ""
  ].filter(Boolean).join(" "), [
    contextOpen,
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

  return (
    <div
      className={rootClassName}
      data-testid="conversation-window"
      style={{
        ...getWindowTypographyStyle(settings, "conversation"),
        "--conversation-accent": settings.appearance.accentColor
      }}
    >
      <ConversationTopbar
        sidebarCollapsed={sidebarCollapsed}
        contextOpen={contextOpen}
        taskOpen={taskOpen}
        skill={history.current?.skillSnapshot ?? null}
        skills={history.current?.skillSnapshots ?? []}
        skillRoutingMode={history.current?.skillRoutingMode ?? "manual"}
        isMaximized={isMaximized}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        onToggleContext={() => {
          setTaskOpen(false);
          setContextOpen((current) => !current);
        }}
        onToggleTask={() => {
          setContextOpen(false);
          setTaskOpen((current) => !current);
          setTaskTargetMessageId((current) => current ?? (
            agentStatus.conversationId === history.current?.id &&
            ["running", "stopping", "cancelling"].includes(agentStatus.state)
              ? "live"
              : null
          ));
        }}
        onOpenInput={openInput}
        onMinimize={() => window.api?.minimizeWindow?.()}
        onMaximize={() => window.api?.maximizeWindow?.()}
        onClose={() => window.api?.closeWindow?.()}
      />

      <div className="conversation-layout">
        <ConversationSidebar
          conversations={history.conversations}
          workspaces={workspaces}
          activeMode={sidebarMode}
          onModeChange={setSidebarMode}
          currentConversationId={history.state.currentConversationId}
          busy={history.busy}
          query={query}
          onQueryChange={setQuery}
          onCreate={createForWorkspace}
          onSelect={(conversationId) => void history.select(conversationId)}
          onRename={(conversationId, title) => history.rename({ conversationId, title })}
          onDelete={(conversationId) => void history.remove(conversationId)}
        />

        <main className="conversation-main">
          {history.error && <div className="conversation-alert">{history.error}</div>}

          <ConversationMessageList
            loading={history.loading}
            developerMode={developerMode}
            conversation={history.current}
            liveActivity={currentLiveActivity}
            busy={history.busy}
            onOpenTaskPanel={(messageId) => {
              setContextOpen(false);
              setTaskTargetMessageId(messageId);
              setTaskOpen(true);
            }}
            onOpenInput={openInput}
            onRegenerate={(messageId) => {
              if (!history.current) return;
              void history.regenerate({ conversationId: history.current.id, messageId });
            }}
            onUpdateMessageContext={(messageId, patch) => {
              if (!history.current) return;
              void history.updateMessageContext({
                conversationId: history.current.id,
                messageId,
                ...patch
              });
            }}
          />

          <ConversationPlanDock activity={currentLiveActivity} />
          <ToolApprovalPanel
            approval={
              agentStatus.conversationId === history.current?.id
                ? agentStatus.pendingApproval
                : null
            }
          />
        </main>

        <ConversationTaskPanel
          open={taskOpen}
          conversation={history.current}
          liveActivity={currentLiveActivity}
          targetMessageId={taskTargetMessageId}
          developerMode={developerMode}
          onLoadDeveloperDetails={(request) => window.api?.getAgentRunDetails?.(request)}
          onClose={() => setTaskOpen(false)}
        />

        <ConversationContextInspector
          open={contextOpen}
          conversation={history.current}
          inspection={history.inspection}
          busy={history.busy}
          onClose={() => setContextOpen(false)}
          onResetContext={resetContext}
        />
      </div>
    </div>
  );
}
