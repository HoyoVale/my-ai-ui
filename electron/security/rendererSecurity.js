import {
  shell
} from "electron";

import {
  mainEnv
} from "../config/env.js";

import {
  isTrustedRendererUrl,
  parseSafeExternalUrl
} from "./urlPolicy.js";

let sessionPolicyInstalled = false;

function normalizeRequestOrigin(
  url
) {
  if (url.protocol === "ws:") {
    url.protocol = "http:";
  }

  if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  return url.origin;
}

export function getTrustedRendererOrigins() {
  const origins = new Set();

  try {
    origins.add(
      new URL(
        mainEnv.DEV_SERVER_URL
      ).origin
    );
  } catch {
    // 配置错误会由窗口加载失败暴露。
  }

  return origins;
}

export function applyWindowSecurity(
  window
) {
  const trustedOrigins =
    getTrustedRendererOrigins();

  window.webContents.on(
    "will-navigate",
    (event, url) => {
      if (
        !isTrustedRendererUrl(
          url,
          trustedOrigins
        )
      ) {
        event.preventDefault();
      }
    }
  );

  window.webContents
    .setWindowOpenHandler(
      () => ({
        action: "deny"
      })
    );
}

export function installRendererSessionSecurity(
  targetSession
) {
  if (sessionPolicyInstalled) {
    return;
  }

  sessionPolicyInstalled = true;

  const trustedOrigins =
    getTrustedRendererOrigins();

  targetSession
    .setPermissionRequestHandler(
      (_webContents, _permission, callback) => {
        callback(false);
      }
    );

  targetSession
    .setPermissionCheckHandler(
      () => false
    );

  targetSession.webRequest
    .onBeforeRequest(
      {
        urls: [
          "http://*/*",
          "https://*/*",
          "ws://*/*",
          "wss://*/*"
        ]
      },
      (details, callback) => {
        let allowed = false;

        try {
          const url =
            new URL(details.url);

          allowed =
            trustedOrigins.has(
              normalizeRequestOrigin(
                url
              )
            );
        } catch {
          allowed = false;
        }

        callback({
          cancel: !allowed
        });
      }
    );
}

export async function openSafeExternalUrl(
  value
) {
  const url =
    parseSafeExternalUrl(value);

  if (!url) {
    return {
      ok: false,
      code:
        "unsafe-external-url",
      message:
        "该链接使用了不允许的协议、凭据或本地/私有网络地址。"
    };
  }

  await shell.openExternal(
    url.toString(),
    {
      activate: true
    }
  );

  return {
    ok: true,
    url: url.toString()
  };
}
