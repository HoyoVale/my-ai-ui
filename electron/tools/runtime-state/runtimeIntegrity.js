import crypto from "node:crypto";

function isJsonOmitted(value) {
  return value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol";
}

export function canonicalRuntimeJson(value) {
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => isJsonOmitted(item) ? "null" : canonicalRuntimeJson(item))
      .join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => !isJsonOmitted(value[key]))
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalRuntimeJson(value[key])}`)
      .join(",")}}`;
  }

  if (isJsonOmitted(value)) {
    return "null";
  }

  return JSON.stringify(value);
}

export function runtimeChecksum(value) {
  return crypto
    .createHash("sha256")
    .update(canonicalRuntimeJson(value))
    .digest("hex");
}

export function withoutRuntimeIntegrity(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  const clone = structuredClone(value);
  delete clone.integrity;
  delete clone.checksum;
  return clone;
}
