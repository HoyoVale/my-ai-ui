import { ConversationContextInspector } from "./components/ContextInspector.jsx";
import { ConversationMessageList } from "./components/MessageList.jsx";
import { ConversationGoalPanel } from "./components/GoalPanel.jsx";
import { ConversationPlanDock } from "./components/PlanDock.jsx";
import { ConversationPlatformDock } from "./components/PlatformDock.jsx";
import { ConversationTaskPanel } from "./components/TaskPanel.jsx";
import { ToolApprovalPanel } from "./components/ToolApprovalPanel.jsx";
import { ConversationSidebar } from "./components/Sidebar.jsx";
import { ConversationTopbar } from "./components/Topbar.jsx";
import { useConversationHistory } from "./hooks/useConversationHistory.js";
import { useConversationViewController } from "./hooks/useConversationViewController.js";
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
  const workspaces = Array.isArray(settings.workspaces?.items)
    ? settings.workspaces.items
    : [];

  const view = useConversationViewController({
    settings,
    theme,
    isMaximized,
    history,
    agentStatus
  });

  const {
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
  } = view;

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
        goalOpen={goalOpen}
        goal={history.current?.goal ?? null}
        skill={history.current?.skillSnapshot ?? null}
        skills={history.current?.skillSnapshots ?? []}
        skillRoutingMode={history.current?.skillRoutingMode ?? "manual"}
        isMaximized={isMaximized}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        onToggleContext={toggleContext}
        onToggleTask={toggleTask}
        onToggleGoal={toggleGoal}
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
            onOpenTaskPanel={openTaskPanel}
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
          <ConversationPlatformDock
            conversation={history.current}
            developerMode={developerMode}
          />
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

        <ConversationGoalPanel
          open={goalOpen}
          conversation={history.current}
          busy={history.busy || Boolean(currentLiveActivity)}
          developerMode={developerMode}
          onUpdate={({ objective, status, criteria, autoContinue }) => history.setGoal({
            conversationId: history.current?.id ?? "",
            objective,
            status,
            criteria,
            autoContinue
          })}
          onClose={() => setGoalOpen(false)}
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
