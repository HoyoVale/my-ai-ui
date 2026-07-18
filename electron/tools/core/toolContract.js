function schemaResult(schema, value) {
  if (!schema) {
    return { success: true, data: value };
  }

  if (typeof schema.safeParse === "function") {
    return schema.safeParse(value);
  }

  if (typeof schema.parse === "function") {
    try {
      return { success: true, data: schema.parse(value) };
    } catch (error) {
      return { success: false, error };
    }
  }

  throw new TypeError("Tool schema must provide safeParse() or parse().");
}

function validationMessage(result, fallback) {
  const issues = result?.error?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues
      .slice(0, 3)
      .map((issue) => {
        const path = issue.path?.length ? `${issue.path.join(".")}: ` : "";
        return `${path}${issue.message}`;
      })
      .join("; ");
  }
  return result?.error?.message ?? fallback;
}

export function validateToolInput(definition, input) {
  const result = schemaResult(definition?.inputSchema, input);
  return result.success
    ? { ok: true, value: result.data }
    : {
        ok: false,
        code: "INVALID_TOOL_ARGUMENTS",
        message: validationMessage(result, "工具参数不符合 Schema。")
      };
}

export function validateToolOutput(definition, output) {
  const result = schemaResult(definition?.outputSchema, output);
  return result.success
    ? { ok: true, value: result.data }
    : {
        ok: false,
        code: "INVALID_TOOL_OUTPUT",
        message: validationMessage(result, "工具输出不符合 Schema。")
      };
}

export function isJsonSerializable(value) {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined;
  } catch {
    return false;
  }
}
