const {
  contextBridge,
  ipcRenderer
} = require("electron");

/*
 * 当前项目没有单独的 preload bundler。
 * Electron renderer sandbox 下 preload 保持单文件，
 * 避免 require 本地模块导致 window.api 注入失败。
 */

const CHANNELS = Object.freeze({
  OPEN_INPUT:
    "open-input",

  OPEN_RESPONSE:
    "open-response",

  OPEN_SETTING:
    "open-setting",

  OPEN_CONVERSATION:
    "open-conversation",

  OPEN_MEMORY:
    "open-memory",

  PET_DRAG_START:
    "pet-drag-start",

  PET_DRAG_MOVE:
    "pet-drag-move",

  PET_DRAG_END:
    "pet-drag-end",

  RESIZE_INPUT_WINDOW:
    "resize-input-window",

  DISMISS_RESPONSE_WINDOW:
    "dismiss-response-window",

  RESIZE_RESPONSE_WINDOW:
    "resize-response-window",

  RESPONSE_STREAM_START:
    "response-stream-start",

  RESPONSE_STREAM_CHUNK:
    "response-stream-chunk",

  RESPONSE_STREAM_END:
    "response-stream-end",

  RESPONSE_STREAM_CLEAR:
    "response-stream-clear",

  RESPONSE_SIDE_CHANGED:
    "response-side-changed",

  RESPONSE_RENDERER_READY:
    "response-renderer-ready",

  AGENT_SEND_MESSAGE:
    "agent-send-message",

  AGENT_STOP:
    "agent-stop",

  AGENT_GET_STATUS:
    "agent-get-status",

  AGENT_STATUS_CHANGED:
    "agent-status-changed",

  AGENT_GET_SNAPSHOT:
    "agent-get-snapshot",

  AGENT_SNAPSHOT_CHANGED:
    "agent-snapshot-changed",

  AGENT_STATUS_PATCH:
    "agent-status-patch",

  AGENT_TEXT_CHUNK:
    "agent-text-chunk",

  AGENT_GET_RUN_DETAILS:
    "agent-get-run-details",

  AGENT_GET_CREDENTIAL_STATUS:
    "agent-get-credential-status",

  AGENT_SET_API_KEY:
    "agent-set-api-key",

  AGENT_CLEAR_API_KEY:
    "agent-clear-api-key",

  AGENT_TEST_CONNECTION:
    "agent-test-connection",

  AGENT_GET_RUNTIME_RECOVERY:
    "agent-get-runtime-recovery",

  AGENT_RESOLVE_RUNTIME_RECOVERY:
    "agent-resolve-runtime-recovery",

  AGENT_GET_RUNTIME_RECOVERY_HISTORY:
    "agent-get-runtime-recovery-history",

  AGENT_RESOLVE_TOOL_APPROVAL:
    "agent-resolve-tool-approval",

  AGENT_GET_CIRCUIT_BREAKERS:
    "agent-get-circuit-breakers",

  AGENT_RESET_CIRCUIT_BREAKER:
    "agent-reset-circuit-breaker",

  PLATFORM_GET_STATE:
    "platform-get-state",

  PLATFORM_GET_RUN:
    "platform-get-run",

  PLATFORM_CONTROL_JOB:
    "platform-control-job",

  PLATFORM_RESOLVE_APPROVAL:
    "platform-resolve-approval",

  PLATFORM_PROVIDE_INPUT:
    "platform-provide-input",

  PLATFORM_SIGNAL_EXTERNAL:
    "platform-signal-external",

  PLATFORM_CONTROL_NOTIFICATION:
    "platform-control-notification",

  PLATFORM_VIEW_REQUESTED:
    "platform-view-requested",

  PLATFORM_CHANGED:
    "platform-changed",

  CONVERSATION_GET_STATE:
    "conversation-get-state",

  CONVERSATION_GET:
    "conversation-get",

  CONVERSATION_LIST:
    "conversation-list",

  CONVERSATION_CREATE:
    "conversation-create",

  CONVERSATION_SWITCH_WORKSPACE:
    "conversation-switch-workspace",

  CONVERSATION_NAVIGATE_CONTEXT:
    "conversation-navigate-context",

  CONVERSATION_SET_MODEL:
    "conversation-set-model",

  CONVERSATION_SET_SKILL:
    "conversation-set-skill",

  CONVERSATION_SET_GOAL:
    "conversation-set-goal",

  CONVERSATION_SELECT:
    "conversation-select",

  CONVERSATION_RENAME:
    "conversation-rename",

  CONVERSATION_DELETE:
    "conversation-delete",

  CONVERSATION_CLEAR:
    "conversation-clear",


  CONVERSATION_RESET_CONTEXT:
    "conversation-reset-context",

  CONVERSATION_UPDATE_MESSAGE_CONTEXT:
    "conversation-update-message-context",

  CONVERSATION_REGENERATE_MESSAGE:
    "conversation-regenerate-message",

  CONVERSATION_INSPECT_CONTEXT:
    "conversation-inspect-context",

  CONVERSATION_CHANGED:
    "conversation-changed",

  TOOLS_GET_MANIFEST:
    "tools-get-manifest",

  SKILLS_GET_STATE:
    "skills-get-state",

  SKILLS_GET:
    "skills-get",

  SKILLS_GET_RUNTIME_STATE:
    "skills-get-runtime-state",

  SKILLS_TEST_RUNTIME:
    "skills-test-runtime",

  SKILLS_IMPORT_DIRECTORY:
    "skills-import-directory",

  SKILLS_IMPORT_ZIP:
    "skills-import-zip",

  SKILLS_SET_ENABLED:
    "skills-set-enabled",

  SKILLS_UNINSTALL:
    "skills-uninstall",

  SKILLS_CHANGED:
    "skills-changed",

  MCP_GET_STATE:
    "mcp-get-state",

  MCP_CONNECT:
    "mcp-connect",

  MCP_DISCONNECT:
    "mcp-disconnect",

  MCP_REFRESH:
    "mcp-refresh",

  MCP_PING:
    "mcp-ping",

  MCP_QUICK_SET_ENABLED:
    "mcp-quick-set-enabled",

  MCP_QUICK_SET_SERVER_ENABLED:
    "mcp-quick-set-server-enabled",

  MCP_GET_SECRET_STATUS:
    "mcp-get-secret-status",

  MCP_SET_SECRET:
    "mcp-set-secret",

  MCP_CLEAR_SECRET:
    "mcp-clear-secret",

  MCP_CLEAR_AUTH:
    "mcp-clear-auth",

  MCP_IMPORT_CONFIG:
    "mcp-import-config",

  MCP_EXPORT_CONFIG:
    "mcp-export-config",

  MCP_CHANGED:
    "mcp-changed",

  CUSTOM_TOOLS_GET_STATE:
    "custom-tools-get-state",

  CUSTOM_TOOLS_GET_SECRET_STATUS:
    "custom-tools-get-secret-status",

  CUSTOM_TOOLS_SET_SECRET:
    "custom-tools-set-secret",

  CUSTOM_TOOLS_CLEAR_SECRET:
    "custom-tools-clear-secret",

  CUSTOM_TOOLS_TEST:
    "custom-tools-test",

  DEVELOPER_INSPECT_PROMPT:
    "developer-inspect-prompt",

  WORKSPACE_LIST:
    "workspace-list",

  WORKSPACE_REGISTER:
    "workspace-register",

  WORKSPACE_REMOVE:
    "workspace-remove",

  MEMORY_GET_STATE:
    "memory-get-state",

  MEMORY_GET:
    "memory-get",

  MEMORY_LIST:
    "memory-list",

  MEMORY_CREATE:
    "memory-create",

  MEMORY_UPDATE:
    "memory-update",

  MEMORY_DELETE:
    "memory-delete",

  MEMORY_CLEAR:
    "memory-clear",

  MEMORY_CHANGED:
    "memory-changed",

  SETTINGS_GET:
    "settings-get",

  SETTINGS_UPDATE:
    "settings-update",

  SETTINGS_RESET:
    "settings-reset",

  SETTINGS_CHANGED:
    "settings-changed",

  SETTINGS_GET_APP_INFO:
    "settings-get-app-info",

  SETTINGS_SELECT_DIRECTORY:
    "settings-select-directory",

  OPEN_EXTERNAL_URL:
    "security-open-external-url",

  MINIMIZE_WINDOW:
    "minimize-window",

  MAXIMIZE_WINDOW:
    "maximize-window",

  CLOSE_WINDOW:
    "close-window",

  IS_MAXIMIZED:
    "is-maximized",

  WINDOW_STATE_CHANGED:
    "window-state-changed",

  SET_MOUSE_THROUGH:
    "set-mouse-through"
});

function subscribe(
  channel,
  callback,
  transform = (...args) =>
    args[0]
) {
  if (
    typeof callback !==
    "function"
  ) {
    return () => {};
  }

  const handler = (
    _event,
    ...args
  ) => {
    callback(
      transform(...args)
    );
  };

  ipcRenderer.on(
    channel,
    handler
  );

  return () => {
    ipcRenderer.removeListener(
      channel,
      handler
    );
  };
}

function normalizePoint(point) {
  return {
    x: Number(point?.x),
    y: Number(point?.y)
  };
}

const api = Object.freeze({
  openInput: () => {
    ipcRenderer.send(
      CHANNELS.OPEN_INPUT
    );
  },

  openResponse: () => {
    ipcRenderer.send(
      CHANNELS.OPEN_RESPONSE
    );
  },

  openSetting: () => {
    ipcRenderer.send(
      CHANNELS.OPEN_SETTING
    );
  },

  openConversation: (request = {}) => {
    ipcRenderer.send(
      CHANNELS
        .OPEN_CONVERSATION,
      {
        platformView: String(request.platformView ?? "")
      }
    );
  },

  openMemory: () => {
    ipcRenderer.send(
      CHANNELS.OPEN_MEMORY
    );
  },

  startPetDrag: (point) => {
    ipcRenderer.send(
      CHANNELS.PET_DRAG_START,
      normalizePoint(point)
    );
  },

  movePetDrag: (point) => {
    ipcRenderer.send(
      CHANNELS.PET_DRAG_MOVE,
      normalizePoint(point)
    );
  },

  endPetDrag: () => {
    ipcRenderer.send(
      CHANNELS.PET_DRAG_END
    );
  },

  resizeInputWindow: (
    request
  ) => {
    const normalized =
      request &&
      typeof request === "object"
        ? {
            height: Number(request.height),
            baseHeight: Number(request.baseHeight),
            menuExtraHeight: Number(request.menuExtraHeight),
            menuDirection: request.menuDirection === "up" ? "up" : "down",
            overlayOpen: request.overlayOpen === true
          }
        : Number(request);

    ipcRenderer.send(
      CHANNELS
        .RESIZE_INPUT_WINDOW,

      normalized
    );
  },

  dismissResponseWindow: () => {
    ipcRenderer.send(
      CHANNELS
        .DISMISS_RESPONSE_WINDOW
    );
  },

  resizeResponseWindow: (
    size
  ) => {
    if (
      !size ||
      typeof size !==
        "object"
    ) {
      return;
    }

    ipcRenderer.send(
      CHANNELS
        .RESIZE_RESPONSE_WINDOW,

      {
        width:
          Number(size.width),

        height:
          Number(size.height)
      }
    );
  },

  onResponseStart: (
    callback
  ) => {
    return subscribe(
      CHANNELS
        .RESPONSE_STREAM_START,

      callback,
      () => undefined
    );
  },

  onResponseChunk: (
    callback
  ) => {
    return subscribe(
      CHANNELS
        .RESPONSE_STREAM_CHUNK,

      callback,
      (chunk) =>
        String(chunk ?? "")
    );
  },

  onResponseEnd: (
    callback
  ) => {
    return subscribe(
      CHANNELS
        .RESPONSE_STREAM_END,

      callback,
      () => undefined
    );
  },

  onResponseClear: (
    callback
  ) => {
    return subscribe(
      CHANNELS
        .RESPONSE_STREAM_CLEAR,

      callback,
      () => undefined
    );
  },

  onResponseSideChange: (
    callback
  ) => {
    return subscribe(
      CHANNELS
        .RESPONSE_SIDE_CHANGED,

      callback,
      (side) =>
        side === "left"
          ? "left"
          : "right"
    );
  },

  notifyResponseReady: () => {
    ipcRenderer.send(
      CHANNELS
        .RESPONSE_RENDERER_READY
    );
  },

  sendAgentMessage: (
    input
  ) => {
    const request =
      input && typeof input === "object"
        ? {
            content: String(input.content ?? ""),
            expectedConversationId: String(
              input.expectedConversationId ?? ""
            ),
            continueTask:
              input.continueTask === true
          }
        : {
            content: String(input ?? ""),
            expectedConversationId: "",
            continueTask: false
          };

    return ipcRenderer.invoke(
      CHANNELS
        .AGENT_SEND_MESSAGE,
      request
    );
  },

  stopAgent: () => {
    return ipcRenderer.invoke(
      CHANNELS.AGENT_STOP
    );
  },

  getAgentStatus: () => {
    return ipcRenderer.invoke(
      CHANNELS
        .AGENT_GET_STATUS
    );
  },

  getAgentSnapshot: () => {
    return ipcRenderer.invoke(
      CHANNELS.AGENT_GET_SNAPSHOT
    );
  },

  getAgentRunDetails: (request = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.AGENT_GET_RUN_DETAILS,
      {
        taskId: String(request.taskId ?? ""),
        runId: String(request.runId ?? "")
      }
    );
  },

  getPlatformState: () => {
    return ipcRenderer.invoke(
      CHANNELS.PLATFORM_GET_STATE
    );
  },

  getPlatformRun: (platformRunId) => {
    return ipcRenderer.invoke(
      CHANNELS.PLATFORM_GET_RUN,
      { platformRunId: String(platformRunId ?? "") }
    );
  },

  controlPlatformJob: (request = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.PLATFORM_CONTROL_JOB,
      {
        jobId: String(request.jobId ?? ""),
        action: String(request.action ?? "")
      }
    );
  },

  resolvePlatformApproval: (request = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.PLATFORM_RESOLVE_APPROVAL,
      {
        approvalId: String(request.approvalId ?? ""),
        decision: String(request.decision ?? ""),
        note: String(request.note ?? "")
      }
    );
  },

  providePlatformJobInput: (request = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.PLATFORM_PROVIDE_INPUT,
      {
        jobId: String(request.jobId ?? ""),
        value: request.value ?? ""
      }
    );
  },

  signalPlatformExternal: (request = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.PLATFORM_SIGNAL_EXTERNAL,
      {
        jobId: String(request.jobId ?? ""),
        key: String(request.key ?? ""),
        payload: request.payload && typeof request.payload === "object" ? request.payload : null
      }
    );
  },

  controlPlatformNotification: (request = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.PLATFORM_CONTROL_NOTIFICATION,
      {
        notificationId: String(request.notificationId ?? ""),
        action: String(request.action ?? "")
      }
    );
  },

  onPlatformChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on(CHANNELS.PLATFORM_CHANGED, listener);
    return () => {
      ipcRenderer.removeListener(CHANNELS.PLATFORM_CHANGED, listener);
    };
  },

  onPlatformViewRequested: (callback) => {
    return subscribe(
      CHANNELS.PLATFORM_VIEW_REQUESTED,
      callback,
      (view) => String(view ?? "")
    );
  },

  getToolRuntimeRecovery: (taskId) => {
    return ipcRenderer.invoke(
      CHANNELS.AGENT_GET_RUNTIME_RECOVERY,
      { taskId: String(taskId ?? "") }
    );
  },

  resolveToolRuntimeRecovery: (request = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.AGENT_RESOLVE_RUNTIME_RECOVERY,
      {
        taskId: String(request.taskId ?? ""),
        callId: String(request.callId ?? ""),
        action: String(request.action ?? "")
      }
    );
  },

  getToolRuntimeRecoveryHistory: () => {
    return ipcRenderer.invoke(
      CHANNELS.AGENT_GET_RUNTIME_RECOVERY_HISTORY
    );
  },

  resolveToolApproval: (request = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.AGENT_RESOLVE_TOOL_APPROVAL,
      {
        approvalId: String(request.approvalId ?? ""),
        decision: String(request.decision ?? "")
      }
    );
  },

  getCircuitBreakerState: () => {
    return ipcRenderer.invoke(
      CHANNELS.AGENT_GET_CIRCUIT_BREAKERS
    );
  },

  resetCircuitBreaker: (request = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.AGENT_RESET_CIRCUIT_BREAKER,
      {
        scope: String(request.scope ?? "all"),
        key: String(request.key ?? "")
      }
    );
  },

  onAgentStatusChanged: (
    callback
  ) => {
    return subscribe(
      CHANNELS
        .AGENT_STATUS_CHANGED,
      callback,
      (status) => status
    );
  },

  onAgentSnapshotChanged: (callback) => {
    return subscribe(
      CHANNELS.AGENT_SNAPSHOT_CHANGED,
      callback,
      (snapshot) => snapshot
    );
  },

  onAgentStatusPatch: (callback) => {
    return subscribe(
      CHANNELS.AGENT_STATUS_PATCH,
      callback,
      (patch) => patch
    );
  },

  onAgentTextChunk: (callback) => {
    return subscribe(
      CHANNELS.AGENT_TEXT_CHUNK,
      callback,
      (chunk) => chunk
    );
  },

  getModelCredentialStatus: (
    descriptor = {}
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .AGENT_GET_CREDENTIAL_STATUS,
      descriptor
    );
  },

  setModelApiKey: (
    descriptor = {}
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .AGENT_SET_API_KEY,
      descriptor
    );
  },

  clearModelApiKey: (
    descriptor = {}
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .AGENT_CLEAR_API_KEY,
      descriptor
    );
  },

  testModelConnection: (
    modelSettings
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .AGENT_TEST_CONNECTION,
      modelSettings
    );
  },

  getConversationState: () => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_GET_STATE
    );
  },

  getConversation: (
    conversationId
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_GET,

      String(
        conversationId ?? ""
      )
    );
  },

  listConversations: () => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_LIST
    );
  },

  createConversation: (input = {}) => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_CREATE,
      {
        mode: String(input?.mode ?? ""),
        workspaceId:
          input?.workspaceId === null
            ? null
            : input?.workspaceId === undefined
              ? undefined
              : String(input?.workspaceId ?? ""),
        modelSelection:
          input?.modelSelection && typeof input.modelSelection === "object"
            ? {
                providerId: String(input.modelSelection.providerId ?? ""),
                modelConfigId: String(input.modelSelection.modelConfigId ?? "")
              }
            : undefined,
        skillId:
          input?.skillId === undefined
            ? undefined
            : input?.skillId === null
              ? null
              : String(input.skillId ?? ""),
        skillIds: Array.isArray(input?.skillIds)
          ? input.skillIds.map((value) => String(value ?? ""))
          : undefined,
        skillRoutingMode: input?.skillRoutingMode === "auto" ? "auto" : "manual"
      }
    );
  },

  switchConversationWorkspace: (workspaceId = null) => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_SWITCH_WORKSPACE,
      workspaceId === null
        ? null
        : String(workspaceId ?? "")
    );
  },

  navigateConversationContext: (input = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.CONVERSATION_NAVIGATE_CONTEXT,
      {
        mode: String(input?.mode ?? ""),
        workspaceId: input?.workspaceId === undefined
          ? undefined
          : input?.workspaceId === null
            ? null
            : String(input.workspaceId ?? "")
      }
    );
  },

  setConversationModel: (input = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.CONVERSATION_SET_MODEL,
      {
        conversationId: String(input?.conversationId ?? ""),
        providerId: String(input?.providerId ?? ""),
        modelConfigId: String(input?.modelConfigId ?? "")
      }
    );
  },

  setConversationSkill: (input = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.CONVERSATION_SET_SKILL,
      {
        conversationId: String(input?.conversationId ?? ""),
        skillId:
          input?.skillId === null
            ? null
            : String(input?.skillId ?? ""),
        skillIds: Array.isArray(input?.skillIds)
          ? input.skillIds.map((value) => String(value ?? ""))
          : undefined,
        skillRoutingMode: input?.skillRoutingMode === "auto" ? "auto" : "manual"
      }
    );
  },

  setConversationGoal: (input = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.CONVERSATION_SET_GOAL,
      {
        conversationId: String(input.conversationId ?? ""),
        objective: String(input.objective ?? ""),
        criteria: Array.isArray(input.criteria)
          ? input.criteria.slice(0, 12).map((criterion) => ({
              id: String(criterion?.id ?? ""),
              text: String(criterion?.text ?? ""),
              verificationKind: String(criterion?.verificationKind ?? "auto"),
              manualSatisfied: criterion?.manualSatisfied === true
            }))
          : [],
        autoContinue: input.autoContinue !== false,
        status: ["active", "paused"].includes(input.status)
          ? input.status
          : "active"
      }
    );
  },

  selectConversation: (
    conversationId
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_SELECT,

      String(
        conversationId ?? ""
      )
    );
  },

  renameConversation: (
    input
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_RENAME,
      {
        conversationId:
          String(
            input?.conversationId ?? ""
          ),
        title:
          String(
            input?.title ?? ""
          )
      }
    );
  },

  deleteConversation: (
    conversationId
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_DELETE,

      String(
        conversationId ?? ""
      )
    );
  },

  clearConversations: () => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_CLEAR
    );
  },

  resetConversationContext: (
    conversationId
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_RESET_CONTEXT,
      String(
        conversationId ?? ""
      )
    );
  },

  updateMessageContext: (
    input
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_UPDATE_MESSAGE_CONTEXT,
      input
    );
  },

  regenerateConversationMessage: (
    input
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_REGENERATE_MESSAGE,
      input
    );
  },

  inspectConversationContext: (
    conversationId
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_INSPECT_CONTEXT,
      String(
        conversationId ?? ""
      )
    );
  },

  onConversationChanged: (
    callback
  ) => {
    return subscribe(
      CHANNELS
        .CONVERSATION_CHANGED,

      callback,
      (state) => state
    );
  },

  getToolManifest: (request = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.TOOLS_GET_MANIFEST,
      request
    );
  },

  getSkillState: () => {
    return ipcRenderer.invoke(
      CHANNELS.SKILLS_GET_STATE
    );
  },

  getSkill: (skillId) => {
    return ipcRenderer.invoke(
      CHANNELS.SKILLS_GET,
      String(skillId ?? "")
    );
  },

  getSkillRuntimeState: (mode = "") => {
    return ipcRenderer.invoke(
      CHANNELS.SKILLS_GET_RUNTIME_STATE,
      { mode: String(mode ?? "") }
    );
  },

  testSkillRuntime: (skillId) => {
    return ipcRenderer.invoke(
      CHANNELS.SKILLS_TEST_RUNTIME,
      { skillId: String(skillId ?? "") }
    );
  },

  importSkillDirectory: () => {
    return ipcRenderer.invoke(
      CHANNELS.SKILLS_IMPORT_DIRECTORY
    );
  },

  importSkillZip: () => {
    return ipcRenderer.invoke(
      CHANNELS.SKILLS_IMPORT_ZIP
    );
  },

  setSkillEnabled: (skillId, enabled) => {
    return ipcRenderer.invoke(
      CHANNELS.SKILLS_SET_ENABLED,
      {
        skillId: String(skillId ?? ""),
        enabled: enabled === true
      }
    );
  },

  uninstallSkill: (skillId) => {
    return ipcRenderer.invoke(
      CHANNELS.SKILLS_UNINSTALL,
      String(skillId ?? "")
    );
  },

  onSkillsChanged: (callback) => {
    return subscribe(
      CHANNELS.SKILLS_CHANGED,
      callback,
      (state) => state
    );
  },

  getMcpState: () => {
    return ipcRenderer.invoke(
      CHANNELS.MCP_GET_STATE
    );
  },

  connectMcpServer: (serverId, options = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.MCP_CONNECT,
      {
        serverId: String(serverId ?? ""),
        force: options.force === true
      }
    );
  },

  disconnectMcpServer: (serverId) => {
    return ipcRenderer.invoke(
      CHANNELS.MCP_DISCONNECT,
      { serverId: String(serverId ?? "") }
    );
  },

  refreshMcpServer: (serverId) => {
    return ipcRenderer.invoke(
      CHANNELS.MCP_REFRESH,
      { serverId: String(serverId ?? "") }
    );
  },

  pingMcpServer: (serverId) => {
    return ipcRenderer.invoke(
      CHANNELS.MCP_PING,
      { serverId: String(serverId ?? "") }
    );
  },

  quickSetMcpEnabled: (enabled) => {
    return ipcRenderer.invoke(
      CHANNELS.MCP_QUICK_SET_ENABLED,
      { enabled: enabled === true }
    );
  },

  quickSetMcpServerEnabled: (serverId, enabled) => {
    return ipcRenderer.invoke(
      CHANNELS.MCP_QUICK_SET_SERVER_ENABLED,
      {
        serverId: String(serverId ?? ""),
        enabled: enabled === true
      }
    );
  },

  getMcpSecretStatus: (serverId, envName) => {
    return ipcRenderer.invoke(
      CHANNELS.MCP_GET_SECRET_STATUS,
      {
        serverId: String(serverId ?? ""),
        envName: String(envName ?? "")
      }
    );
  },

  setMcpSecret: (serverId, envName, value) => {
    return ipcRenderer.invoke(
      CHANNELS.MCP_SET_SECRET,
      {
        serverId: String(serverId ?? ""),
        envName: String(envName ?? ""),
        value: String(value ?? "")
      }
    );
  },

  clearMcpSecret: (serverId, envName) => {
    return ipcRenderer.invoke(
      CHANNELS.MCP_CLEAR_SECRET,
      {
        serverId: String(serverId ?? ""),
        envName: String(envName ?? "")
      }
    );
  },

  clearMcpAuthentication: (serverId) => {
    return ipcRenderer.invoke(
      CHANNELS.MCP_CLEAR_AUTH,
      { serverId: String(serverId ?? "") }
    );
  },

  importMcpConfig: () => {
    return ipcRenderer.invoke(CHANNELS.MCP_IMPORT_CONFIG);
  },

  exportMcpConfig: () => {
    return ipcRenderer.invoke(
      CHANNELS.MCP_EXPORT_CONFIG
    );
  },

  onMcpChanged: (callback) => {
    return subscribe(
      CHANNELS.MCP_CHANGED,
      callback,
      (state) => state
    );
  },

  getCustomToolState: () => {
    return ipcRenderer.invoke(
      CHANNELS.CUSTOM_TOOLS_GET_STATE
    );
  },

  getCustomToolSecretStatus: (toolId) => {
    return ipcRenderer.invoke(
      CHANNELS.CUSTOM_TOOLS_GET_SECRET_STATUS,
      String(toolId ?? "")
    );
  },

  setCustomToolSecret: (toolId, value) => {
    return ipcRenderer.invoke(
      CHANNELS.CUSTOM_TOOLS_SET_SECRET,
      {
        toolId: String(toolId ?? ""),
        value: String(value ?? "")
      }
    );
  },

  clearCustomToolSecret: (toolId) => {
    return ipcRenderer.invoke(
      CHANNELS.CUSTOM_TOOLS_CLEAR_SECRET,
      String(toolId ?? "")
    );
  },

  testCustomHttpTool: (toolId, input = {}, config = null) => {
    return ipcRenderer.invoke(
      CHANNELS.CUSTOM_TOOLS_TEST,
      {
        toolId: String(toolId ?? ""),
        input: input && typeof input === "object" ? input : {},
        config: config && typeof config === "object" ? config : null
      }
    );
  },

  inspectEffectivePrompt: (request = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.DEVELOPER_INSPECT_PROMPT,
      request
    );
  },

  listWorkspaces: () => {
    return ipcRenderer.invoke(
      CHANNELS.WORKSPACE_LIST
    );
  },

  registerWorkspace: (rootPath) => {
    return ipcRenderer.invoke(
      CHANNELS.WORKSPACE_REGISTER,
      {
        rootPath: String(rootPath ?? "")
      }
    );
  },

  removeWorkspace: (workspaceId) => {
    return ipcRenderer.invoke(
      CHANNELS.WORKSPACE_REMOVE,
      String(workspaceId ?? "")
    );
  },

  getMemoryState: () => {
    return ipcRenderer.invoke(
      CHANNELS.MEMORY_GET_STATE
    );
  },

  getMemory: (memoryId) => {
    return ipcRenderer.invoke(
      CHANNELS.MEMORY_GET,
      String(memoryId ?? "")
    );
  },

  listMemories: (filters = {}) => {
    return ipcRenderer.invoke(
      CHANNELS.MEMORY_LIST,
      filters
    );
  },

  createMemory: (input) => {
    return ipcRenderer.invoke(
      CHANNELS.MEMORY_CREATE,
      input
    );
  },

  updateMemory: (memoryId, patch) => {
    return ipcRenderer.invoke(
      CHANNELS.MEMORY_UPDATE,
      String(memoryId ?? ""),
      patch
    );
  },

  deleteMemory: (memoryId) => {
    return ipcRenderer.invoke(
      CHANNELS.MEMORY_DELETE,
      String(memoryId ?? "")
    );
  },

  clearMemories: () => {
    return ipcRenderer.invoke(
      CHANNELS.MEMORY_CLEAR
    );
  },

  onMemoryChanged: (callback) => {
    return subscribe(
      CHANNELS.MEMORY_CHANGED,
      callback,
      (state) => state
    );
  },

  getSettings: () => {
    return ipcRenderer.invoke(
      CHANNELS.SETTINGS_GET
    );
  },

  updateSettings: (
    patch
  ) => {
    return ipcRenderer.invoke(
      CHANNELS.SETTINGS_UPDATE,
      patch
    );
  },

  resetSettings: () => {
    return ipcRenderer.invoke(
      CHANNELS.SETTINGS_RESET
    );
  },

  getAppInfo: () => {
    return ipcRenderer.invoke(
      CHANNELS
        .SETTINGS_GET_APP_INFO
    );
  },

  selectWorkspaceDirectory: () => {
    return ipcRenderer.invoke(
      CHANNELS
        .SETTINGS_SELECT_DIRECTORY
    );
  },

  openExternalLink: (
    url
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .OPEN_EXTERNAL_URL,
      String(url ?? "")
    );
  },

  onSettingsChanged: (
    callback
  ) => {
    return subscribe(
      CHANNELS.SETTINGS_CHANGED,
      callback,
      (settings) => settings
    );
  },

  minimizeWindow: () => {
    ipcRenderer.send(
      CHANNELS.MINIMIZE_WINDOW
    );
  },

  maximizeWindow: () => {
    ipcRenderer.send(
      CHANNELS.MAXIMIZE_WINDOW
    );
  },

  closeWindow: () => {
    ipcRenderer.send(
      CHANNELS.CLOSE_WINDOW
    );
  },

  isMaximized: () => {
    return ipcRenderer.invoke(
      CHANNELS.IS_MAXIMIZED
    );
  },

  onWindowStateChange: (
    callback
  ) => {
    return subscribe(
      CHANNELS
        .WINDOW_STATE_CHANGED,

      callback,
      (isMaximized) =>
        Boolean(isMaximized)
    );
  },

  setMouseThrough: (
    shouldIgnore
  ) => {
    ipcRenderer.send(
      CHANNELS
        .SET_MOUSE_THROUGH,

      Boolean(shouldIgnore)
    );
  }
});

contextBridge.exposeInMainWorld(
  "api",
  api
);
