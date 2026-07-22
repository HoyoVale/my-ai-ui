import crypto from "node:crypto";

function normalize(value) {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalize(value[key])])
    );
  }

  if (value === undefined) {
    return null;
  }

  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(normalize(value));
}

export function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : canonicalStringify(value))
    .digest("hex");
}

export function clone(value) {
  return structuredClone(value);
}
