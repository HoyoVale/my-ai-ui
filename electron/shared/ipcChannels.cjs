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
      RENDERER_READY:
        "response-renderer-ready",

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

      RESOLVE_TOOL_APPROVAL:
        "agent-resolve-tool-approval",

      GET_CIRCUIT_BREAKERS:
        "agent-get-circuit-breakers",

      RESET_CIRCUIT_BREAKER:
        "agent-reset-circuit-breaker"
    }),

    platform: Object.freeze({
      GET_STATE:
        "platform-get-state",

      GET_RUN:
        "platform-get-run",

      CONTROL_JOB:
        "platform-control-job",

      RESOLVE_APPROVAL:
        "platform-resolve-approval",

      PROVIDE_INPUT:
        "platform-provide-input",

      SIGNAL_EXTERNAL:
        "platform-signal-external",

      CONTROL_NOTIFICATION:
        "platform-control-notification",

      VIEW_REQUESTED:
        "platform-view-requested",

      CHANGED:
        "platform-changed"
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

      SET_SKILL:
        "conversation-set-skill",

      SET_GOAL:
        "conversation-set-goal",

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

    skills: Object.freeze({
      GET_STATE:
        "skills-get-state",

      GET:
        "skills-get",

      GET_RUNTIME_STATE:
        "skills-get-runtime-state",

      TEST_RUNTIME:
        "skills-test-runtime",

      IMPORT_DIRECTORY:
        "skills-import-directory",

      IMPORT_ZIP:
        "skills-import-zip",

      SET_ENABLED:
        "skills-set-enabled",

      UNINSTALL:
        "skills-uninstall",

      CHANGED:
        "skills-changed"
    }),

    mcp: Object.freeze({
      GET_STATE:
        "mcp-get-state",

      CONNECT:
        "mcp-connect",

      DISCONNECT:
        "mcp-disconnect",

      REFRESH:
        "mcp-refresh",

      PING:
        "mcp-ping",

      GET_SECRET_STATUS:
        "mcp-get-secret-status",

      SET_SECRET:
        "mcp-set-secret",

      CLEAR_SECRET:
        "mcp-clear-secret",

      CLEAR_AUTH:
        "mcp-clear-auth",

      IMPORT_CONFIG:
        "mcp-import-config",

      EXPORT_CONFIG:
        "mcp-export-config",

      QUICK_SET_ENABLED:
        "mcp-quick-set-enabled",

      QUICK_SET_SERVER_ENABLED:
        "mcp-quick-set-server-enabled",

      CHANGED:
        "mcp-changed"
    }),

    customTools: Object.freeze({
      GET_STATE:
        "custom-tools-get-state",

      GET_SECRET_STATUS:
        "custom-tools-get-secret-status",

      SET_SECRET:
        "custom-tools-set-secret",

      CLEAR_SECRET:
        "custom-tools-clear-secret",

      TEST:
        "custom-tools-test"
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
