const IPC_CHANNELS =
  Object.freeze({
    navigation: Object.freeze({
      OPEN_INPUT:
        "open-input",

      OPEN_RESPONSE:
        "open-response",

      OPEN_SETTING:
        "open-setting",

      OPEN_CONVERSATION:
        "open-conversation",

      OPEN_MEMORY:
        "open-memory"
    }),

    pet: Object.freeze({
      DRAG_START:
        "pet-drag-start",

      DRAG_MOVE:
        "pet-drag-move",

      DRAG_END:
        "pet-drag-end"
    }),

    input: Object.freeze({
      RESIZE_WINDOW:
        "resize-input-window"
    }),

    response: Object.freeze({
      DISMISS_WINDOW:
        "dismiss-response-window",

      RESIZE_WINDOW:
        "resize-response-window",

      STREAM_START:
        "response-stream-start",

      STREAM_CHUNK:
        "response-stream-chunk",

      STREAM_END:
        "response-stream-end",

      STREAM_CLEAR:
        "response-stream-clear",

      SIDE_CHANGED:
        "response-side-changed"
    }),

    agent: Object.freeze({
      SEND_MESSAGE:
        "agent-send-message",

      RESUME_QUESTION:
        "agent-resume-question",

      STOP:
        "agent-stop",

      GET_STATUS:
        "agent-get-status",

      STATUS_CHANGED:
        "agent-status-changed",

      GET_CREDENTIAL_STATUS:
        "agent-get-credential-status",

      SET_API_KEY:
        "agent-set-api-key",

      CLEAR_API_KEY:
        "agent-clear-api-key",

      TEST_CONNECTION:
        "agent-test-connection"
    }),

    conversation: Object.freeze({
      GET_STATE:
        "conversation-get-state",

      GET:
        "conversation-get",

      LIST:
        "conversation-list",

      CREATE:
        "conversation-create",

      SELECT:
        "conversation-select",

      RENAME:
        "conversation-rename",

      DELETE:
        "conversation-delete",

      CLEAR:
        "conversation-clear",


      RESET_CONTEXT:
        "conversation-reset-context",

      UPDATE_MESSAGE_CONTEXT:
        "conversation-update-message-context",

      REGENERATE_MESSAGE:
        "conversation-regenerate-message",

      INSPECT_CONTEXT:
        "conversation-inspect-context",

      CHANGED:
        "conversation-changed"
    }),

    memory: Object.freeze({
      GET_STATE:
        "memory-get-state",

      GET:
        "memory-get",

      LIST:
        "memory-list",

      CREATE:
        "memory-create",

      UPDATE:
        "memory-update",

      DELETE:
        "memory-delete",

      CLEAR:
        "memory-clear",

      CHANGED:
        "memory-changed"
    }),

    security: Object.freeze({
      OPEN_EXTERNAL_URL:
        "security-open-external-url"
    }),

    settings: Object.freeze({
      GET:
        "settings-get",

      UPDATE:
        "settings-update",

      RESET:
        "settings-reset",

      CHANGED:
        "settings-changed",

      GET_APP_INFO:
        "settings-get-app-info",

      SELECT_DIRECTORY:
        "settings-select-directory"
    }),

    window: Object.freeze({
      MINIMIZE:
        "minimize-window",

      TOGGLE_MAXIMIZE:
        "maximize-window",

      CLOSE:
        "close-window",

      IS_MAXIMIZED:
        "is-maximized",

      STATE_CHANGED:
        "window-state-changed",

      SET_MOUSE_THROUGH:
        "set-mouse-through"
    })
  });

module.exports = IPC_CHANNELS;
