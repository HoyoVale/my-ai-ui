import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";

import { z } from "zod";

const READ_METHODS = new Set(["GET", "HEAD"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SAFE_HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/u;
const FORBIDDEN_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "content-length",
  "connection",
  "proxy-authorization",
  "transfer-encoding",
  "upgrade"
]);

function createError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  );
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  return family === 4
    ? isPrivateIpv4(address)
    : family === 6
      ? isPrivateIpv6(address)
      : false;
}

function isLocalHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return ["localhost", "127.0.0.1", "::1"].includes(normalized);
}

async function assertNetworkTarget(url, allowPrivateNetwork) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw createError("INVALID_ARGUMENTS", "自定义 HTTP 工具只支持 HTTP 或 HTTPS。" );
  }
  if (url.username || url.password || url.hash) {
    throw createError("INVALID_ARGUMENTS", "URL 不能包含账号、密码或 Fragment。" );
  }
  const local = isLocalHostname(url.hostname);
  if (url.protocol === "http:" && !local) {
    throw createError("POLICY_DENIED", "非本机地址必须使用 HTTPS。" );
  }
  if (allowPrivateNetwork || local) {
    return;
  }
  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch (error) {
    throw createError(
      "TEMPORARY_FAILURE",
      `无法解析目标主机：${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
    throw createError(
      "POLICY_DENIED",
      "目标解析到本机、私有或链路本地网络。请在开发者模式下显式允许私有网络后再试。"
    );
  }
}

function schemaForType(type) {
  if (type === "number") return z.number();
  if (type === "integer") return z.number().int();
  if (type === "boolean") return z.boolean();
  if (type === "object") return z.record(z.string(), z.unknown());
  if (type === "array") return z.array(z.unknown());
  return z.string();
}

export function createCustomHttpInputSchema(parameters = []) {
  const shape = {};
  for (const parameter of parameters) {
    let schema = schemaForType(parameter.type);
    if (parameter.description) {
      schema = schema.describe(parameter.description);
    }
    if (!parameter.required) {
      schema = schema.optional();
    }
    shape[parameter.name] = schema;
  }
  return z.object(shape).strict();
}

function stringifyValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function pathValue(value) {
  return encodeURIComponent(stringifyValue(value));
}

function applyPathParameters(template, parameters, input) {
  let output = template;
  for (const parameter of parameters.filter((item) => item.location === "path")) {
    const token = `{${parameter.name}}`;
    const value = input[parameter.name];
    if (value === undefined || value === null || value === "") {
      if (parameter.required || output.includes(token)) {
        throw createError("INVALID_ARGUMENTS", `缺少路径参数：${parameter.name}`);
      }
      continue;
    }
    output = output.split(token).join(pathValue(value));
  }
  const unresolved = output.match(/\{[a-zA-Z][a-zA-Z0-9_-]*\}/u);
  if (unresolved) {
    throw createError("INVALID_ARGUMENTS", `URL 中仍有未提供的路径参数：${unresolved[0]}`);
  }
  return output;
}

function resolvePath(value, pathExpression) {
  const path = String(pathExpression ?? "").trim();
  if (!path) return value;
  const segments = path.split(".").filter(Boolean);
  let current = value;
  for (const segment of segments) {
    if (current === null || current === undefined) return null;
    if (Array.isArray(current) && /^\d+$/u.test(segment)) {
      current = current[Number(segment)];
    } else if (typeof current === "object") {
      current = current[segment];
    } else {
      return null;
    }
  }
  return current === undefined ? null : current;
}

async function readBoundedResponse(response, maxBytes) {
  if (!response.body) {
    return { buffer: Buffer.alloc(0), truncated: false, totalBytes: 0 };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  let storedBytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    totalBytes += chunk.length;
    if (storedBytes < maxBytes) {
      const remaining = maxBytes - storedBytes;
      const slice = chunk.subarray(0, remaining);
      chunks.push(slice);
      storedBytes += slice.length;
      if (slice.length < chunk.length) truncated = true;
    } else {
      truncated = true;
    }
    if (truncated) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return {
    buffer: Buffer.concat(chunks),
    truncated,
    totalBytes
  };
}

function responseHeaders(headers) {
  const output = {};
  for (const [name, value] of headers.entries()) {
    if (["set-cookie", "authorization", "proxy-authenticate"].includes(name.toLowerCase())) {
      continue;
    }
    output[name] = String(value).slice(0, 2000);
  }
  return output;
}

function parseResponseData(buffer, contentType, truncated) {
  const text = buffer.toString("utf8");
  if (!truncated && /(?:application\/json|\+json)/iu.test(contentType)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function throwForHttpStatus(response, data) {
  if (response.ok) return;
  const message = typeof data === "string"
    ? data.slice(0, 400)
    : JSON.stringify(data).slice(0, 400);
  let code = "HTTP_ERROR";
  if (response.status === 401 || response.status === 403) code = "PERMISSION_DENIED";
  else if (response.status === 404) code = "NOT_FOUND";
  else if (response.status === 409 || response.status === 412) code = "CONFLICT";
  else if (response.status === 429) code = "RATE_LIMITED";
  else if (response.status >= 500) code = "TEMPORARY_FAILURE";
  else if (response.status >= 400) code = "INVALID_ARGUMENTS";
  throw createError(
    code,
    `HTTP ${response.status} ${response.statusText}${message ? `：${message}` : ""}`,
    { status: response.status }
  );
}

function buildRequest(config, input, secret) {
  const rawUrl = applyPathParameters(config.url, config.parameters, input);
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw createError("INVALID_ARGUMENTS", "自定义 HTTP 工具 URL 无效。" );
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    if (
      SAFE_HEADER_NAME.test(name) &&
      !FORBIDDEN_REQUEST_HEADERS.has(name.toLowerCase())
    ) {
      headers.set(name, String(value));
    }
  }
  headers.set("Accept", "application/json, text/plain;q=0.9, */*;q=0.5");
  const body = {};
  for (const parameter of config.parameters) {
    const value = input[parameter.name];
    if (value === undefined || value === null) continue;
    if (parameter.location === "query") {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(parameter.name, stringifyValue(item));
      } else {
        url.searchParams.set(parameter.name, stringifyValue(value));
      }
    } else if (parameter.location === "header") {
      if (
        !SAFE_HEADER_NAME.test(parameter.name) ||
        FORBIDDEN_REQUEST_HEADERS.has(parameter.name.toLowerCase())
      ) {
        throw createError("INVALID_ARGUMENTS", `不允许使用 Header 参数：${parameter.name}`);
      }
      headers.set(parameter.name, stringifyValue(value));
    } else if (parameter.location === "body") {
      body[parameter.name] = value;
    }
  }
  if (config.authMode === "bearer") {
    if (!secret) throw createError("PERMISSION_DENIED", "该工具尚未配置 Bearer Token。" );
    headers.set("Authorization", `Bearer ${secret}`);
  } else if (config.authMode === "api-key") {
    if (!secret) throw createError("PERMISSION_DENIED", "该工具尚未配置 API Key。" );
    headers.set(config.apiKeyHeader || "X-API-Key", secret);
  }
  let requestBody;
  if (BODY_METHODS.has(config.method) && Object.keys(body).length > 0) {
    headers.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }
  return { url, headers, body: requestBody };
}

export async function executeDeclarativeHttpTool(config, input, {
  secret = "",
  abortSignal = null,
  fetchImpl = fetch
} = {}) {
  const request = buildRequest(config, input, secret);
  await assertNetworkTarget(request.url, config.allowPrivateNetwork === true);
  let response;
  try {
    response = await fetchImpl(request.url, {
      method: config.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
      signal: abortSignal
    });
  } catch (error) {
    if (abortSignal?.aborted) {
      throw error;
    }
    throw createError(
      "TEMPORARY_FAILURE",
      `HTTP 请求失败：${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (response.status >= 300 && response.status < 400) {
    throw createError("POLICY_DENIED", "出于安全考虑，自定义 HTTP 工具不会自动跟随重定向。" );
  }
  const bounded = await readBoundedResponse(response, config.maxResponseBytes);
  const headers = responseHeaders(response.headers);
  const contentType = response.headers.get("content-type") ?? "";
  const data = parseResponseData(bounded.buffer, contentType, bounded.truncated);
  throwForHttpStatus(response, data);
  return {
    ok: true,
    status: response.status,
    statusText: response.statusText,
    url: request.url.toString(),
    headers,
    data,
    extracted: resolvePath(data, config.responsePath),
    truncated: bounded.truncated,
    responseBytes: bounded.buffer.length,
    observedBytes: bounded.totalBytes
  };
}

export function createDeclarativeHttpDefinition(config, {
  secretResolver = () => "",
  fetchImpl = fetch
} = {}) {
  const method = String(config.method ?? "GET").toUpperCase();
  const readOnly = READ_METHODS.has(method);
  const destructive = method === "DELETE";
  const baseName = config.id.replace(/[^a-zA-Z0-9_-]/gu, "_");
  const suffix = crypto
    .createHash("sha256")
    .update(config.id)
    .digest("hex")
    .slice(0, 8);
  const toolName = `custom_http_${baseName.slice(0, 38)}_${suffix}`;
  return {
    id: `custom.http.${config.id}@1`,
    name: toolName,
    version: 1,
    title: config.name,
    description: config.description || `${method} ${config.url}`,
    source: `custom.http.${config.id}`,
    toolsets: [`custom.${config.id}`],
    riskLevel: destructive ? "high" : readOnly ? "low" : "medium",
    sideEffect: readOnly ? "read" : "external",
    idempotency: readOnly ? "natural" : "none",
    activityVisibility: "normal",
    inputSchema: createCustomHttpInputSchema(config.parameters),
    outputSchema: z.object({
      ok: z.boolean(),
      status: z.number().int(),
      statusText: z.string(),
      url: z.string(),
      headers: z.record(z.string(), z.string()),
      data: z.unknown(),
      extracted: z.unknown(),
      truncated: z.boolean(),
      responseBytes: z.number().int(),
      observedBytes: z.number().int()
    }),
    timeoutMs: config.timeoutMs,
    retryPolicy: {
      maxAttempts: readOnly ? 2 : 1,
      retryOn: readOnly ? ["TEMPORARY_FAILURE", "RATE_LIMITED"] : [],
      backoffMs: 250
    },
    runtimeContract: {
      effect: destructive ? "destructive" : readOnly ? "read" : "remote_write",
      retryMode: destructive ? "manual_only" : readOnly ? "safe" : "reconcile_before_retry",
      supportsAbort: true,
      supportsResume: readOnly,
      timeoutMs: config.timeoutMs
    },
    presentation: {
      title: config.name,
      description: config.description || `${method} ${config.url}`,
      icon: "network"
    },
    customHttp: {
      id: config.id,
      method,
      url: config.url,
      authMode: config.authMode,
      readOnly
    },
    execute: async (input, context = {}) => executeDeclarativeHttpTool(config, input, {
      secret: await secretResolver(config.id),
      abortSignal: context.abortSignal,
      fetchImpl
    })
  };
}
