const IPC_CHANNELS =
  Object.freeze({
    navigation: Object.freeze({
      OPEN_INPUT:
        "open-input",

      OPEN_RESPONSE:
        "open-response",

      OPEN_SETTING:
        "open-setting"
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
