import { z } from "zod";

function jsonClone(value) {
  return value === undefined
    ? null
    : JSON.parse(JSON.stringify(value));
}

export function serializeToolSchema(schema) {
  if (!schema) {
    return null;
  }

  try {
    if (typeof z.toJSONSchema === "function") {
      return jsonClone(z.toJSONSchema(schema));
    }
  } catch {
    // Fall through to a bounded structural summary.
  }

  const typeName = String(
    schema?._def?.typeName ??
    schema?._def?.type ??
    schema?.constructor?.name ??
    "schema"
  );

  return {
    type: "object",
    title: typeName,
    description: "The runtime schema could not be converted to JSON Schema by this build."
  };
}
