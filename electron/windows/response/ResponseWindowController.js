import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  createBaseWindow
} from "../../core/createWindow.js";

import {
  getRendererUrl
} from "../../shared/rendererRoutes.js";

import {
  getSettings
} from "../../settings/settingsStore.js";

import {
  getPetWindow
} from "../pet/petWindow.js";

import {
  calculateResponsePlacement
} from "./responsePlacement.js";

import {
  getResponseMetrics
} from "./responseConstants.js";

import {
  ResponseStreamReplayBuffer
} from "./ResponseStreamReplayBuffer.js";

import {
  ownsResponseWindow
} from "./responseWindowOwnership.js";

function clamp(
  value,
  min,
  max
) {
  return Math.min(
    Math.max(value, min),
    max
  );
}

export class ResponseWindowController {
  constructor() {
    this.window = null;

    this.ready = false;
    this.pendingMessages = [];
    this.maxPendingMessages = 32;
    this.streamReplay = new ResponseStreamReplayBuffer();

    this.attachedPet = null;
    this.petMoveHandler = null;
    this.petResizeHandler = null;
    this.petClosedHandler = null;

    this.currentSide = "right";

    /*
     * Controller 会在 app ready 之前被 import。
     * 这里不能调用 app.getPath() 间接读取设置，
     * 所以先使用默认逻辑尺寸，首次 open 时再读取真实设置。
     */
    this.logicalWidth = 440;
    this.logicalHeight = 284;

    this.autoCloseTimer = null;
  }

  open() {
    if (
      this.window &&
      !this.window.isDestroyed()
    ) {
      return this.window;
    }

    const pet = getPetWindow();

    if (
      !pet ||
      pet.isDestroyed()
    ) {
      return null;
    }

    const settings =
      getSettings();

    const metrics =
      getResponseMetrics(
        settings
      );

    this.logicalWidth =
      metrics.maxWidth;

    this.logicalHeight =
      metrics.maxHeight;

    const placement =
      calculateResponsePlacement(
        this.logicalWidth,
        this.logicalHeight,
        settings
      );

    const responseWindow =
      createBaseWindow({
        x: placement.x,
        y: placement.y,

        width:
          this.logicalWidth,

        height:
          this.logicalHeight,

        minWidth:
          metrics.minWidth,

        maxWidth:
          metrics.maxWidth,

        minHeight:
          metrics.minHeight,

        maxHeight:
          metrics.maxHeight,

        show: false,

        transparent: true,

        backgroundColor:
          "#00000000",

        frame: false,
        hasShadow: false,

        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,

        skipTaskbar: true,

        alwaysOnTop:
          settings
            .response
            .alwaysOnTop,

        /*
         * Response 经常处于隐藏状态。
         * 禁止后台节流，确保隐藏后仍能及时处理下一次流式 IPC。
         */
        webPreferences: {
          backgroundThrottling:
            false
        }
      });

    this.window = responseWindow;
    this.ready = false;
    this.currentSide =
      placement.side;

    responseWindow
      .webContents
      .on(
        "did-start-loading",
        () => {
          if (
            !ownsResponseWindow(
              this.window,
              responseWindow
            ) ||
            responseWindow.isDestroyed()
          ) {
            return;
          }

          /*
           * did-finish-load 只代表文档加载完成，不代表 React effect 中的
           * IPC 订阅已经安装。导航期间重新进入排队模式，等待 Renderer
           * 显式握手，避免快速回复在首屏挂载或热重载时丢失。
           */
          this.ready = false;
        }
      );

    responseWindow.loadURL(
      getRendererUrl(
        "/response"
      )
    );

    this.attachToPet(pet);

    responseWindow.on(
      "closed",
      () => {
        this.handleWindowClosed(responseWindow);
      }
    );

    return responseWindow;
  }

  resize(requestedSize) {
    if (
      !this.window ||
      this.window.isDestroyed() ||
      !requestedSize ||
      typeof requestedSize !==
        "object"
    ) {
      return;
    }

    const width =
      Number(
        requestedSize.width
      );

    const height =
      Number(
        requestedSize.height
      );

    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      return;
    }

    const settings =
      getSettings();

    const metrics =
      getResponseMetrics(
        settings
      );

    this.logicalWidth =
      clamp(
        Math.ceil(width),
        metrics.minWidth,
        metrics.maxWidth
      );

    this.logicalHeight =
      clamp(
        Math.ceil(height),
        metrics.minHeight,
        metrics.maxHeight
      );

    this.applyBounds(
      settings
    );

    if (
      !this.dismissed &&
      !this.window.isVisible()
    ) {
      this.window.showInactive();
    }
  }

  applySettings(settings) {
    if (
      !this.window ||
      this.window.isDestroyed()
    ) {
      return;
    }

    const metrics =
      getResponseMetrics(
        settings
      );

    this.logicalWidth =
      clamp(
        this.logicalWidth,
        metrics.minWidth,
        metrics.maxWidth
      );

    this.logicalHeight =
      clamp(
        this.logicalHeight,
        metrics.minHeight,
        metrics.maxHeight
      );

    this.window.setMinimumSize(
      1,
      1
    );

    this.window.setMaximumSize(
      10000,
      10000
    );

    this.window.setMinimumSize(
      metrics.minWidth,
      metrics.minHeight
    );

    this.window.setMaximumSize(
      metrics.maxWidth,
      metrics.maxHeight
    );

    this.window.setAlwaysOnTop(
      settings
        .response
        .alwaysOnTop
    );

    this.applyBounds(
      settings
    );

    if (
      !this.streamActive
    ) {
      this.scheduleAutoClose(
        settings
      );
    }
  }

  startStream() {
    const window = this.open();

    this.clearAutoClose();

    this.streamActive = true;
    this.dismissed = false;
    this.hasContent = false;
    this.streamReplay.start();

    if (!window) {
      return;
    }

    /*
     * 每次新回复都从最小逻辑尺寸开始。
     * Renderer 随文本增长再上报真实尺寸，
     * 避免沿用上一条长回复的大窗口。
     */
    const settings =
      getSettings();

    const metrics =
      getResponseMetrics(
        settings
      );

    this.logicalWidth =
      metrics.minWidth;

    this.logicalHeight =
      metrics.minHeight;

    if (window.isVisible()) {
      window.hide();
    }

    this.applyBounds(
      settings
    );

    this.send(
      IPC_CHANNELS
        .response
        .STREAM_START
    );
  }

  appendChunk(chunk) {
    if (this.dismissed) {
      return;
    }

    if (
      chunk === undefined ||
      chunk === null ||
      chunk === ""
    ) {
      return;
    }

    if (!this.streamActive) {
      this.startStream();
    } else if (
      !this.window ||
      this.window.isDestroyed()
    ) {
      this.open();
    }

    this.hasContent = true;
    this.streamReplay.append(chunk);

    this.send(
      IPC_CHANNELS
        .response
        .STREAM_CHUNK,

      String(chunk)
    );

    /*
     * 不再等待隐藏 Renderer 的 ResizeObserver 才显示窗口。
     * 隐藏窗口中的 requestAnimationFrame 可能被 Chromium 节流，
     * 因而第二条回复永远无法触发 resize IPC。
     */
    this.revealForStream();
  }

  replaceText(value) {
    if (this.dismissed) {
      return;
    }

    const text = String(value ?? "");
    if (!this.streamActive && text) {
      this.startStream();
    } else if (
      text &&
      (!this.window || this.window.isDestroyed())
    ) {
      this.open();
    }

    this.hasContent = Boolean(text);
    this.streamReplay.replace(text);
    this.send(
      IPC_CHANNELS
        .response
        .STREAM_REPLACE,
      text
    );

    if (text) {
      this.revealForStream();
    }
  }

  endStream() {
    this.streamActive = false;
    this.streamReplay.end();

    if (!this.window) {
      return;
    }

    this.send(
      IPC_CHANNELS
        .response
        .STREAM_END
    );

    this.scheduleAutoClose(
      getSettings()
    );
  }

  clear() {
    this.clearAutoClose();

    this.streamActive = false;
    this.hasContent = false;
    this.streamReplay.clear();

    this.send(
      IPC_CHANNELS
        .response
        .STREAM_CLEAR
    );

    if (
      this.window &&
      !this.window.isDestroyed() &&
      this.window.isVisible()
    ) {
      this.window.hide();
    }
  }

  dismiss() {
    if (
      !this.window ||
      this.window.isDestroyed()
    ) {
      return;
    }

    this.clearAutoClose();

    this.dismissed = true;
    this.hasContent = false;
    this.streamReplay.clear();

    this.send(
      IPC_CHANNELS
        .response
        .STREAM_CLEAR
    );

    if (this.window.isVisible()) {
      this.window.hide();
    }
  }

  close() {
    if (
      !this.window ||
      this.window.isDestroyed()
    ) {
      return;
    }

    this.window.close();
  }

  isSender(webContents) {
    return Boolean(
      this.window &&
      !this.window.isDestroyed() &&
      this.window.webContents ===
        webContents
    );
  }

  markRendererReady() {
    if (
      !this.window ||
      this.window.isDestroyed()
    ) {
      return;
    }

    this.ready = true;

    this.replayStreamState();
    this.flushPendingMessages();

    this.send(
      IPC_CHANNELS
        .response
        .SIDE_CHANGED,

      this.currentSide
    );

    this.revealForStream();
  }

  send(channel, ...args) {
    if (
      !this.window ||
      this.window.isDestroyed()
    ) {
      return;
    }

    if (!this.ready) {
      this.queuePendingMessage(channel, args);
      return;
    }

    if (!this.sendNow(channel, args)) {
      if (
        this.window &&
        !this.window.isDestroyed()
      ) {
        this.ready = false;
        this.queuePendingMessage(channel, args);
      }
    }
  }

  queuePendingMessage(channel, args) {
    if (
      this.streamReplay.isStreamChannel(
        channel,
        IPC_CHANNELS.response
      )
    ) {
      return;
    }

    const existingIndex = this.pendingMessages.findIndex(
      (message) => message.channel === channel
    );
    if (existingIndex >= 0) {
      this.pendingMessages.splice(existingIndex, 1);
    }
    this.pendingMessages.push({ channel, args });
    if (this.pendingMessages.length > this.maxPendingMessages) {
      this.pendingMessages.splice(
        0,
        this.pendingMessages.length - this.maxPendingMessages
      );
    }
  }

  replayStreamState() {
    if (
      !this.window ||
      this.window.isDestroyed() ||
      !this.ready
    ) {
      return false;
    }

    const messages = this.streamReplay.replayMessages(
      IPC_CHANNELS.response
    );
    for (const message of messages) {
      if (!this.sendNow(message.channel, message.args)) {
        this.ready = false;
        return false;
      }
    }
    return true;
  }

  sendNow(channel, args) {
    if (
      !this.window ||
      this.window.isDestroyed() ||
      this.window.webContents.isDestroyed()
    ) {
      return false;
    }

    try {
      this.window.webContents.send(channel, ...args);
      return true;
    } catch (error) {
      if (!this.window.webContents.isDestroyed()) {
        console.warn("发送 Response 流消息失败：", error);
      }
      return false;
    }
  }

  flushPendingMessages() {
    if (
      !this.window ||
      this.window.isDestroyed() ||
      !this.ready
    ) {
      return;
    }

    const messages =
      this.pendingMessages;

    this.pendingMessages = [];

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (!this.sendNow(message.channel, message.args)) {
        if (
          this.window &&
          !this.window.isDestroyed()
        ) {
          this.ready = false;
          this.pendingMessages.push(...messages.slice(index));
        }
        break;
      }
    }
  }

  revealForStream() {
    if (
      !this.window ||
      this.window.isDestroyed() ||
      !this.ready ||
      !this.hasContent ||
      this.dismissed
    ) {
      return;
    }

    this.applyBounds();

    if (!this.window.isVisible()) {
      this.window.showInactive();
    }
  }

  applyBounds(
    settings = getSettings()
  ) {
    if (
      !this.window ||
      this.window.isDestroyed()
    ) {
      return;
    }

    const placement =
      calculateResponsePlacement(
        this.logicalWidth,
        this.logicalHeight,
        settings
      );

    this.window.setBounds(
      {
        x: placement.x,
        y: placement.y,

        width:
          this.logicalWidth,

        height:
          this.logicalHeight
      },
      false
    );

    this.emitSide(
      placement.side
    );
  }

  emitSide(side) {
    if (
      side === this.currentSide
    ) {
      return;
    }

    this.currentSide = side;

    this.send(
      IPC_CHANNELS
        .response
        .SIDE_CHANGED,

      side
    );
  }

  scheduleAutoClose(
    settings
  ) {
    this.clearAutoClose();

    const seconds =
      settings
        .response
        .autoCloseSeconds;

    if (
      !seconds ||
      this.streamActive ||
      this.dismissed
    ) {
      return;
    }

    this.autoCloseTimer =
      setTimeout(
        () => {
          this.dismiss();
        },
        seconds * 1000
      );
  }

  clearAutoClose() {
    if (!this.autoCloseTimer) {
      return;
    }

    clearTimeout(
      this.autoCloseTimer
    );

    this.autoCloseTimer = null;
  }

  attachToPet(pet) {
    /*
     * A destroyed Response window can be replaced by the next stream chunk
     * before Electron dispatches the old window's `closed` event. Remove the
     * previous attachment first so a stale close cannot leave duplicate pet
     * listeners behind.
     */
    this.detachFromPet();
    this.attachedPet = pet;

    this.petMoveHandler = () => {
      this.applyBounds();
    };

    this.petResizeHandler = () => {
      this.applyBounds();
    };

    this.petClosedHandler = () => {
      this.close();
    };

    pet.on(
      "move",
      this.petMoveHandler
    );

    pet.on(
      "resize",
      this.petResizeHandler
    );

    pet.on(
      "closed",
      this.petClosedHandler
    );
  }

  detachFromPet() {
    if (
      this.attachedPet &&
      !this.attachedPet.isDestroyed()
    ) {
      if (
        this.petMoveHandler
      ) {
        this.attachedPet
          .removeListener(
            "move",
            this.petMoveHandler
          );
      }

      if (
        this.petResizeHandler
      ) {
        this.attachedPet
          .removeListener(
            "resize",
            this.petResizeHandler
          );
      }

      if (
        this.petClosedHandler
      ) {
        this.attachedPet
          .removeListener(
            "closed",
            this.petClosedHandler
          );
      }
    }

    this.attachedPet = null;
    this.petMoveHandler = null;
    this.petResizeHandler = null;
    this.petClosedHandler = null;
  }

  handleWindowClosed(closedWindow) {
    /*
     * Ignore stale close callbacks. A new Response window may already own the
     * controller while the old BrowserWindow is finishing its asynchronous
     * close lifecycle. Resetting shared state here would orphan the new window
     * and redirect the remaining stream into yet another window.
     */
    if (
      !ownsResponseWindow(
        this.window,
        closedWindow
      )
    ) {
      return false;
    }

    this.clearAutoClose();
    this.detachFromPet();
    this.resetAfterClose();
    return true;
  }

  resetAfterClose() {
    const metrics =
      getResponseMetrics(
        getSettings()
      );

    this.window = null;

    this.ready = false;
    this.pendingMessages = [];

    this.currentSide = "right";

    this.logicalWidth =
      metrics.maxWidth;

    this.logicalHeight =
      metrics.maxHeight;
  }
}
