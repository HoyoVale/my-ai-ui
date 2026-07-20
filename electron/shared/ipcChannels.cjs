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

      STOP:
        "agent-stop",

      GET_STATUS:
        "agent-get-status",

      STATUS_CHANGED:
        "agent-status-changed",

      GET_SNAPSHOT:
        "agent-get-snapshot",

      SNAPSHOT_CHANGED:
        "agent-snapshot-changed",

      STATUS_PATCH:
        "agent-status-patch",

      TEXT_CHUNK:
        "agent-text-chunk",

      GET_RUN_DETAILS:
        "agent-get-run-details",

      GET_CREDENTIAL_STATUS:
        "agent-get-credential-status",

      SET_API_KEY:
        "agent-set-api-key",

      CLEAR_API_KEY:
        "agent-clear-api-key",

      TEST_CONNECTION:
        "agent-test-connection",

      GET_RUNTIME_RECOVERY:
        "agent-get-runtime-recovery",

      RESOLVE_RUNTIME_RECOVERY:
        "agent-resolve-runtime-recovery",

      GET_RUNTIME_RECOVERY_HISTORY:
        "agent-get-runtime-recovery-history",

      GET_CIRCUIT_BREAKERS:
        "agent-get-circuit-breakers",

      RESET_CIRCUIT_BREAKER:
        "agent-reset-circuit-breaker"
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

      SWITCH_WORKSPACE:
        "conversation-switch-workspace",

      NAVIGATE_CONTEXT:
        "conversation-navigate-context",

      SET_MODEL:
        "conversation-set-model",

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

    tools: Object.freeze({
      GET_MANIFEST:
        "tools-get-manifest"
    }),

    developer: Object.freeze({
      INSPECT_PROMPT:
        "developer-inspect-prompt"
    }),

    workspace: Object.freeze({
      LIST:
        "workspace-list",

      REGISTER:
        "workspace-register",

      REMOVE:
        "workspace-remove"
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
