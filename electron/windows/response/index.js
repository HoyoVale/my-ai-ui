import {
  ResponseWindowController
} from "./ResponseWindowController.js";

const controller =
  new ResponseWindowController();

export function openResponseWindow() {
  return controller.open();
}

export function resizeResponseWindow(
  requestedSize
) {
  controller.resize(
    requestedSize
  );
}

export function applyResponseWindowSettings(
  settings
) {
  controller.applySettings(
    settings
  );
}

export function startResponseStream() {
  controller.startStream();
}

export function appendResponseChunk(
  chunk
) {
  controller.appendChunk(
    chunk
  );
}

export function endResponseStream() {
  controller.endStream();
}

export function clearResponseWindow() {
  controller.clear();
}

export function dismissResponseWindow() {
  controller.dismiss();
}

export function closeResponseWindow() {
  controller.close();
}

export function isResponseSender(
  webContents
) {
  return controller.isSender(
    webContents
  );
}
