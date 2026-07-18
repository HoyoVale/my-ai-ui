const SENSITIVE_KEYS = new Set([
  "authorization",
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token"
]);

function redact(value, seen) {
  if (typeof value === "bigint") {
    return String(value);
  }
  if (["function", "symbol", "undefined"].includes(typeof value)) {
    return `[${typeof value}]`;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    const result = value.map((item) => redact(item, seen));
    seen.delete(value);
    return result;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  const result = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.has(key.toLowerCase())
        ? "[REDACTED]"
        : redact(item, seen)
    ])
  );
  seen.delete(value);
  return result;
}

export function redactSensitiveValue(value) {
  return redact(value, new WeakSet());
}
