const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET"
]);

const AUTH_CODES = new Set([
  "AUTHENTICATION_ERROR",
  "INVALID_API_KEY",
  "UNAUTHORIZED"
]);

const RATE_LIMIT_CODES = new Set([
  "RATE_LIMIT",
  "RATE_LIMITED",
  "TOO_MANY_REQUESTS"
]);

function numericStatus(error) {
  const status = Number(
    error?.statusCode ??
    error?.status ??
    error?.response?.status ??
    error?.cause?.statusCode ??
    0
  );
  return Number.isFinite(status) ? status : 0;
}

function errorCode(error) {
  return String(
    error?.code ??
    error?.cause?.code ??
    error?.data?.code ??
    ""
  ).trim().toUpperCase();
}

function errorMessage(error) {
  return String(
    error?.message ??
    error?.cause?.message ??
    error ??
    "模型请求失败。"
  ).trim();
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    return String(headers.get(name) ?? "").trim();
  }

  const target = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === target) {
      return String(value ?? "").trim();
    }
  }
  return "";
}

function retryAfterMsFrom(error) {
  const direct = Number(
    error?.retryAfterMs ??
    error?.data?.retryAfterMs ??
    error?.cause?.retryAfterMs
  );
  if (Number.isFinite(direct) && direct > 0) {
    return Math.round(direct);
  }

  const headers =
    error?.responseHeaders ??
    error?.headers ??
    error?.response?.headers ??
    error?.cause?.headers;
  const raw = headerValue(headers, "retry-after");
  if (!raw) return 0;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp)
    ? Math.max(0, timestamp - Date.now())
    : 0;
}

function explicitRetryable(error) {
  if (typeof error?.isRetryable === "boolean") {
    return error.isRetryable;
  }
  if (typeof error?.retryable === "boolean") {
    return error.retryable;
  }
  return null;
}

export const PROVIDER_ERROR_CATEGORIES = Object.freeze({
  CANCELLED: "cancelled",
  AUTHENTICATION: "authentication",
  PERMISSION: "permission",
  QUOTA: "quota",
  INVALID_REQUEST: "invalid_request",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  RATE_LIMITED: "rate_limited",
  TIMEOUT: "timeout",
  NETWORK: "network",
  UNAVAILABLE: "unavailable",
  INTERNAL: "internal"
});

export function classifyProviderError(
  error,
  { cancellationRequested = false } = {}
) {
  const status = numericStatus(error);
  const code = errorCode(error);
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  const retryAfterMs = retryAfterMsFrom(error);
  const explicit = explicitRetryable(error);

  let category = PROVIDER_ERROR_CATEGORIES.INTERNAL;

  if (cancellationRequested) {
    category = PROVIDER_ERROR_CATEGORIES.CANCELLED;
  } else if (
    status === 401 ||
    AUTH_CODES.has(code) ||
    /api key|authentication|unauthorized/u.test(lower)
  ) {
    category = PROVIDER_ERROR_CATEGORIES.AUTHENTICATION;
  } else if (
    status === 403 ||
    /forbidden|permission denied/u.test(lower)
  ) {
    category = PROVIDER_ERROR_CATEGORIES.PERMISSION;
  } else if (
    status === 402 ||
    /insufficient.*quota|quota exceeded|balance/u.test(lower)
  ) {
    category = PROVIDER_ERROR_CATEGORIES.QUOTA;
  } else if (
    status === 400 ||
    status === 413 ||
    status === 422 ||
    /invalid request|context length|too many tokens|request too large/u.test(lower)
  ) {
    category = PROVIDER_ERROR_CATEGORIES.INVALID_REQUEST;
  } else if (status === 404) {
    category = PROVIDER_ERROR_CATEGORIES.NOT_FOUND;
  } else if (status === 409) {
    category = PROVIDER_ERROR_CATEGORIES.CONFLICT;
  } else if (
    status === 429 ||
    RATE_LIMIT_CODES.has(code) ||
    /rate limit|too many requests/u.test(lower)
  ) {
    category = PROVIDER_ERROR_CATEGORIES.RATE_LIMITED;
  } else if (
    status === 408 ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    /timed out|timeout/u.test(lower) ||
    error?.name === "AbortError"
  ) {
    category = PROVIDER_ERROR_CATEGORIES.TIMEOUT;
  } else if (
    NETWORK_CODES.has(code) ||
    /fetch failed|network|socket|connection reset|dns/u.test(lower)
  ) {
    category = PROVIDER_ERROR_CATEGORIES.NETWORK;
  } else if (
    status >= 500 ||
    code === "CIRCUIT_OPEN" ||
    /temporar|unavailable|overloaded|service busy/u.test(lower)
  ) {
    category = PROVIDER_ERROR_CATEGORIES.UNAVAILABLE;
  }

  const inferredRetryable = [
    PROVIDER_ERROR_CATEGORIES.RATE_LIMITED,
    PROVIDER_ERROR_CATEGORIES.TIMEOUT,
    PROVIDER_ERROR_CATEGORIES.NETWORK,
    PROVIDER_ERROR_CATEGORIES.UNAVAILABLE
  ].includes(category);
  const hardFailure = [
    PROVIDER_ERROR_CATEGORIES.CANCELLED,
    PROVIDER_ERROR_CATEGORIES.AUTHENTICATION,
    PROVIDER_ERROR_CATEGORIES.PERMISSION,
    PROVIDER_ERROR_CATEGORIES.QUOTA,
    PROVIDER_ERROR_CATEGORIES.INVALID_REQUEST,
    PROVIDER_ERROR_CATEGORIES.NOT_FOUND,
    PROVIDER_ERROR_CATEGORIES.CONFLICT
  ].includes(category);
  const retryable = hardFailure
    ? false
    : explicit === null
      ? inferredRetryable
      : explicit;
  const automaticRetry = retryable && code !== "CIRCUIT_OPEN";
  const countsTowardCircuit = automaticRetry && category !== PROVIDER_ERROR_CATEGORIES.RATE_LIMITED
    ? true
    : automaticRetry && category === PROVIDER_ERROR_CATEGORIES.RATE_LIMITED;

  return {
    code: code || `PROVIDER_${category.toUpperCase()}`,
    status,
    category,
    message,
    retryable,
    automaticRetry,
    countsTowardCircuit,
    retryAfterMs
  };
}

export function providerErrorMessage(classified) {
  switch (classified?.category) {
    case PROVIDER_ERROR_CATEGORIES.AUTHENTICATION:
      return "API Key 无效或尚未配置，请在 Setting → Model 中检查。";
    case PROVIDER_ERROR_CATEGORIES.PERMISSION:
      return "模型服务拒绝了当前请求，请检查账户权限和模型访问权限。";
    case PROVIDER_ERROR_CATEGORIES.QUOTA:
      return "模型账户余额或配额不足。";
    case PROVIDER_ERROR_CATEGORIES.INVALID_REQUEST:
      return "模型请求参数或上下文不被服务接受，请检查模型配置或缩短输入。";
    case PROVIDER_ERROR_CATEGORIES.NOT_FOUND:
      return "找不到配置的模型或接口，请检查模型 ID 和 Base URL。";
    case PROVIDER_ERROR_CATEGORIES.RATE_LIMITED:
      return "请求过于频繁，请稍后再试。";
    case PROVIDER_ERROR_CATEGORIES.TIMEOUT:
      return "模型请求超时，请稍后重试或调大超时时间。";
    case PROVIDER_ERROR_CATEGORIES.NETWORK:
      return "无法连接模型服务，请检查网络和 Base URL。";
    case PROVIDER_ERROR_CATEGORIES.UNAVAILABLE:
      return "模型服务暂时不可用，请稍后重试。";
    case PROVIDER_ERROR_CATEGORIES.CANCELLED:
      return "模型请求已取消。";
    default:
      return String(classified?.message ?? "模型请求失败。");
  }
}
