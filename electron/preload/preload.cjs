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

  CONVERSATION_LIST:
    "conversation-list",

  CONVERSATION_CREATE:
    "conversation-create",

  CONVERSATION_SELECT:
    "conversation-select",

  CONVERSATION_DELETE:
    "conversation-delete",

  CONVERSATION_CLEAR:
    "conversation-clear",

  CONVERSATION_CHANGED:
    "conversation-changed",

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

  getModelCredentialStatus: () => {
    return ipcRenderer.invoke(
      CHANNELS
        .AGENT_GET_CREDENTIAL_STATUS
    );
  },

  setModelApiKey: (
    apiKey
  ) => {
    return ipcRenderer.invoke(
      CHANNELS
        .AGENT_SET_API_KEY,
      String(apiKey ?? "")
    );
  },

  clearModelApiKey: () => {
    return ipcRenderer.invoke(
      CHANNELS
        .AGENT_CLEAR_API_KEY
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

  listConversations: () => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_LIST
    );
  },

  createConversation: () => {
    return ipcRenderer.invoke(
      CHANNELS
        .CONVERSATION_CREATE
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
