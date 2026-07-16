const {
  contextBridge,
  ipcRenderer
} = require("electron");

/*
 * Electron 20+ 默认启用 renderer sandbox。
 *
 * 沙箱 preload 不能通过 require("./other-file.cjs")
 * 加载本地 CommonJS 模块，所以当前项目在没有
 * preload bundler 的情况下，preload 必须保持单文件。
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
  /* ---------- 打开窗口 ---------- */

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

  /* ---------- Pet 拖动 ---------- */

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

  /* ---------- Input ---------- */

  resizeInputWindow: (
    height
  ) => {
    ipcRenderer.send(
      CHANNELS
        .RESIZE_INPUT_WINDOW,

      Number(height)
    );
  },

  /* ---------- Response ---------- */

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

  /* ---------- 通用窗口控制 ---------- */

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
