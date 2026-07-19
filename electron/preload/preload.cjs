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

  AGENT_SEND_MESSAGE:
    "agent-send-message",

  AGENT_STOP:
    "agent-stop",

  AGENT_GET_STATUS:
    "agent-get-status",

  AGENT_STATUS_CHANGED:
    "agent-status-changed",

  AGENT_GET_CREDENTIAL_STATUS:
    "agent-get-credential-status",

  AGENT_SET_API_KEY:
    "agent-set-api-key",

  AGENT_CLEAR_API_KEY:
    "agent-clear-api-key",

  AGENT_TEST_CONNECTION:
    "agent-test-connection",

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

  openConversation: () => {
    ipcRenderer.send(
      CHANNELS
        .OPEN_CONVERSATION
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
    height
  ) => {
    ipcRenderer.send(
      CHANNELS
        .RESIZE_INPUT_WINDOW,

      Number(height)
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

  sendAgentMessage: (
    content
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .AGENT_SEND_MESSAGE,
      String(content ?? "")
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
        workspaceId:
          input?.workspaceId === null
            ? null
            : String(input?.workspaceId ?? "")
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
