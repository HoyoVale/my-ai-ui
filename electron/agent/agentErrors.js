export function isAbortError(
  error
) {
  return (
    error?.name ===
      "AbortError" ||
    error?.code ===
      "ABORT_ERR"
  );
}

export function formatAgentError(
  error
) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : String(
          error ??
          "未知错误"
        );

  const message =
    rawMessage.toLowerCase();

  if (
    message.includes("api key") ||
    message.includes("401") ||
    message.includes(
      "authentication"
    ) ||
    message.includes(
      "unauthorized"
    )
  ) {
    return "API Key 无效或尚未配置，请在 Setting → Model 中检查。";
  }

  if (
    message.includes("402") ||
    message.includes("balance") ||
    message.includes("quota")
  ) {
    return "模型账户余额或配额不足。";
  }

  if (
    message.includes("429") ||
    message.includes(
      "rate limit"
    )
  ) {
    return "请求过于频繁，请稍后再试。";
  }

  if (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econn") ||
    message.includes("enotfound")
  ) {
    return "无法连接模型服务，请检查网络和 Base URL。";
  }

  if (
    message.includes("timeout") ||
    message.includes("timed out")
  ) {
    return "模型请求超时，请稍后重试或调大超时时间。";
  }

  return rawMessage;
}
