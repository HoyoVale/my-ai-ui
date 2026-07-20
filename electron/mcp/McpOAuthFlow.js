import crypto from "node:crypto";
import http from "node:http";

import {
  clearMcpPrivateValue,
  getMcpPrivateValue,
  setMcpPrivateValue
} from "./mcpCredentialStore.js";

const OAUTH_KEYS = Object.freeze({
  CLIENT: "MCP_OAUTH_CLIENT",
  TOKENS: "MCP_OAUTH_TOKENS",
  VERIFIER: "MCP_OAUTH_VERIFIER",
  DISCOVERY: "MCP_OAUTH_DISCOVERY"
});

function parseJson(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function writeJson(serverId, key, value) {
  if (value === undefined || value === null) {
    clearMcpPrivateValue(serverId, key);
    return;
  }
  setMcpPrivateValue(serverId, key, JSON.stringify(value));
}

function safeHtml(title, message) {
  const escape = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:72px auto;padding:0 24px;color:#202124}h1{font-size:24px}p{line-height:1.6;color:#5f6368}</style></head><body><h1>${escape(title)}</h1><p>${escape(message)}</p><script>setTimeout(()=>window.close(),1800)</script></body></html>`;
}

function createCallbackReceiver({ state, timeoutMs = 180000 }) {
  let settled = false;
  let timer = null;
  let resolveCode;
  let rejectCode;
  const result = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = http.createServer((request, response) => {
    if (settled) {
      response.writeHead(410, { "content-type": "text/plain; charset=utf-8" });
      response.end("Authorization session has ended.");
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/mcp/oauth/callback") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const returnedState = url.searchParams.get("state") ?? "";
    const error = url.searchParams.get("error") ?? "";
    const errorDescription = url.searchParams.get("error_description") ?? error;
    const code = url.searchParams.get("code") ?? "";

    if (!returnedState || returnedState !== state) {
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      response.end(safeHtml("授权失败", "安全校验未通过，请返回应用后重试。"));
      settled = true;
      rejectCode(new Error("MCP OAuth state 校验失败。"));
      return;
    }

    if (error) {
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      response.end(safeHtml("授权未完成", errorDescription));
      settled = true;
      rejectCode(new Error(`MCP OAuth 授权失败：${errorDescription}`));
      return;
    }

    if (!code) {
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      response.end(safeHtml("授权失败", "没有收到授权码。"));
      settled = true;
      rejectCode(new Error("MCP OAuth 回调未包含授权码。"));
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(safeHtml("连接成功", "可以关闭此页面并返回应用。"));
    settled = true;
    resolveCode(code);
  });

  const listen = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("无法创建 MCP OAuth 回调地址。"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}/mcp/oauth/callback`);
    });
  });

  timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectCode(new Error("MCP OAuth 授权等待超时。"));
    }
  }, timeoutMs);
  timer.unref?.();

  return {
    listen,
    waitForCode: () => result,
    close: async () => {
      if (timer) clearTimeout(timer);
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}

class PersistentOAuthProvider {
  constructor({ server, redirectUrl, state, openExternal }) {
    this.server = server;
    this._redirectUrl = redirectUrl;
    this._state = state;
    this.openExternal = openExternal;
  }

  get redirectUrl() {
    return this._redirectUrl;
  }

  get clientMetadata() {
    return {
      client_name: "Xixi Desktop",
      redirect_uris: [this._redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: (this.server.oauthScopes ?? []).join(" ") || undefined
    };
  }

  state() {
    return this._state;
  }

  clientInformation() {
    return parseJson(getMcpPrivateValue(this.server.id, OAUTH_KEYS.CLIENT));
  }

  saveClientInformation(value) {
    writeJson(this.server.id, OAUTH_KEYS.CLIENT, value);
  }

  tokens() {
    return parseJson(getMcpPrivateValue(this.server.id, OAUTH_KEYS.TOKENS));
  }

  saveTokens(value) {
    writeJson(this.server.id, OAUTH_KEYS.TOKENS, value);
  }

  async redirectToAuthorization(authorizationUrl) {
    if (!["https:", "http:"].includes(authorizationUrl.protocol)) {
      throw new Error("MCP OAuth 返回了不受支持的授权地址。" );
    }
    await this.openExternal(authorizationUrl.toString());
  }

  saveCodeVerifier(value) {
    setMcpPrivateValue(this.server.id, OAUTH_KEYS.VERIFIER, value);
  }

  codeVerifier() {
    const value = getMcpPrivateValue(this.server.id, OAUTH_KEYS.VERIFIER);
    if (!value) {
      throw new Error("MCP OAuth PKCE 校验信息不存在，请重新登录。" );
    }
    return value;
  }

  saveDiscoveryState(value) {
    writeJson(this.server.id, OAUTH_KEYS.DISCOVERY, value);
  }

  discoveryState() {
    return parseJson(getMcpPrivateValue(this.server.id, OAUTH_KEYS.DISCOVERY));
  }

  invalidateCredentials(scope) {
    if (["all", "tokens"].includes(scope)) {
      clearMcpPrivateValue(this.server.id, OAUTH_KEYS.TOKENS);
    }
    if (["all", "client"].includes(scope)) {
      clearMcpPrivateValue(this.server.id, OAUTH_KEYS.CLIENT);
    }
    if (["all", "verifier"].includes(scope)) {
      clearMcpPrivateValue(this.server.id, OAUTH_KEYS.VERIFIER);
    }
    if (["all", "discovery"].includes(scope)) {
      clearMcpPrivateValue(this.server.id, OAUTH_KEYS.DISCOVERY);
    }
  }
}

export async function createMcpOAuthFlow({ server, openExternal, timeoutMs }) {
  const state = crypto.randomBytes(24).toString("base64url");
  const receiver = createCallbackReceiver({ state, timeoutMs });
  const redirectUrl = await receiver.listen;
  return {
    provider: new PersistentOAuthProvider({
      server,
      redirectUrl,
      state,
      openExternal
    }),
    waitForCode: receiver.waitForCode,
    close: receiver.close
  };
}

export function clearMcpOAuthCredentials(serverId) {
  for (const key of Object.values(OAUTH_KEYS)) {
    clearMcpPrivateValue(serverId, key);
  }
}
