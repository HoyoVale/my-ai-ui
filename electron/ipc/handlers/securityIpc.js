import {
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  openSafeExternalUrl
} from "../../security/rendererSecurity.js";

import {
  getTrustedRendererOrigins
} from "../../security/rendererSecurity.js";

import {
  isTrustedRendererUrl
} from "../../security/urlPolicy.js";

function requireTrustedRenderer(
  event
) {
  const senderUrl =
    event.senderFrame?.url ??
    event.sender.getURL();

  if (
    !isTrustedRendererUrl(
      senderUrl,
      getTrustedRendererOrigins()
    )
  ) {
    throw new Error(
      "Untrusted renderer sender."
    );
  }
}

export function registerSecurityIpc() {
  ipcMain.handle(
    IPC_CHANNELS
      .security
      .OPEN_EXTERNAL_URL,
    (event, url) => {
      requireTrustedRenderer(event);

      return openSafeExternalUrl(
        url
      );
    }
  );
}
