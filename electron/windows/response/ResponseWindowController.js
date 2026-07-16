import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  createBaseWindow
} from "../../core/createWindow.js";

import {
  getRendererUrl
} from "../../shared/rendererRoutes.js";

import {
  getPetWindow
} from "../pet/petWindow.js";

import {
  calculateResponsePlacement
} from "./responsePlacement.js";

import {
  RESPONSE_MAX_HEIGHT,
  RESPONSE_MAX_WIDTH,
  RESPONSE_MIN_HEIGHT,
  RESPONSE_MIN_WIDTH
} from "./responseConstants.js";

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
    this.streamActive = false;
    this.dismissed = false;

    this.pendingMessages = [];

    this.attachedPet = null;
    this.petMoveHandler = null;
    this.petClosedHandler = null;

    this.currentSide = "right";

    this.logicalWidth =
      RESPONSE_MAX_WIDTH;

    this.logicalHeight =
      RESPONSE_MAX_HEIGHT;
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

    this.logicalWidth =
      RESPONSE_MAX_WIDTH;

    this.logicalHeight =
      RESPONSE_MAX_HEIGHT;

    const placement =
      calculateResponsePlacement(
        this.logicalWidth,
        this.logicalHeight
      );

    this.window =
      createBaseWindow({
        x: placement.x,
        y: placement.y,

        width:
          this.logicalWidth,

        height:
          this.logicalHeight,

        minWidth:
          RESPONSE_MIN_WIDTH,

        maxWidth:
          RESPONSE_MAX_WIDTH,

        minHeight:
          RESPONSE_MIN_HEIGHT,

        maxHeight:
          RESPONSE_MAX_HEIGHT,

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
        alwaysOnTop: true
      });

    this.ready = false;
    this.currentSide =
      placement.side;

    this.window.loadURL(
      getRendererUrl(
        "/response"
      )
    );

    this.window
      .webContents
      .once(
        "did-finish-load",
        () => {
          if (
            !this.window ||
            this.window.isDestroyed()
          ) {
            return;
          }

          this.ready = true;

          this.flushPendingMessages();

          this.send(
            IPC_CHANNELS
              .response
              .SIDE_CHANGED,

            this.currentSide
          );
        }
      );

    this.attachToPet(pet);

    this.window.on(
      "closed",
      () => {
        this.detachFromPet();
        this.resetAfterClose();
      }
    );

    return this.window;
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

    this.logicalWidth =
      clamp(
        Math.ceil(width),
        RESPONSE_MIN_WIDTH,
        RESPONSE_MAX_WIDTH
      );

    this.logicalHeight =
      clamp(
        Math.ceil(height),
        RESPONSE_MIN_HEIGHT,
        RESPONSE_MAX_HEIGHT
      );

    this.applyBounds();

    if (
      !this.dismissed &&
      !this.window.isVisible()
    ) {
      this.window.showInactive();
    }
  }

  startStream() {
    const window = this.open();

    if (!window) {
      return;
    }

    this.streamActive = true;
    this.dismissed = false;

    if (window.isVisible()) {
      window.hide();
    }

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
    }

    this.send(
      IPC_CHANNELS
        .response
        .STREAM_CHUNK,

      String(chunk)
    );
  }

  endStream() {
    if (!this.window) {
      return;
    }

    this.streamActive = false;

    this.send(
      IPC_CHANNELS
        .response
        .STREAM_END
    );
  }

  clear() {
    this.streamActive = false;

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

    this.dismissed = true;

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

  send(channel, ...args) {
    if (
      !this.window ||
      this.window.isDestroyed()
    ) {
      return;
    }

    if (!this.ready) {
      this.pendingMessages.push({
        channel,
        args
      });

      return;
    }

    this.window
      .webContents
      .send(
        channel,
        ...args
      );
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

    for (
      const message
      of messages
    ) {
      this.window
        .webContents
        .send(
          message.channel,
          ...message.args
        );
    }
  }

  applyBounds() {
    if (
      !this.window ||
      this.window.isDestroyed()
    ) {
      return;
    }

    const placement =
      calculateResponsePlacement(
        this.logicalWidth,
        this.logicalHeight
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

  attachToPet(pet) {
    this.attachedPet = pet;

    this.petMoveHandler = () => {
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
    this.petClosedHandler = null;
  }

  resetAfterClose() {
    this.window = null;

    this.ready = false;
    this.streamActive = false;
    this.dismissed = false;

    this.pendingMessages = [];

    this.currentSide = "right";

    this.logicalWidth =
      RESPONSE_MAX_WIDTH;

    this.logicalHeight =
      RESPONSE_MAX_HEIGHT;
  }
}
