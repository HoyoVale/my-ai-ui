const DEFAULT_LIMITS = Object.freeze({
  maxTextBytes: 51200,
  maxStructuredBytes: 1048576,
  maxJsonFields: 10000,
  maxContentBlocks: 128,
  stripHtml: true
});

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions/iu,
  /reveal\s+(?:the\s+)?system\s+prompt/iu,
  /send\s+(?:the\s+)?(?:token|api\s*key|password|secret)/iu,
  /developer\s+message/iu,
  /system\s+message/iu
];

function stripHtml(text) {
  return String(text ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<!--([\s\S]*?)-->/gu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function looksLikeHtml(text) {
  return /<(?:html|body|script|style|div|p|span|a|table|section|article)\b/iu.test(text);
}

function promptInjectionSignals(text) {
  return PROMPT_INJECTION_PATTERNS
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source.slice(0, 80));
}

function normalizeUntrustedText(value, limits) {
  const raw = String(value ?? "");
  const htmlStripped = limits.stripHtml !== false && looksLikeHtml(raw);
  const text = htmlStripped ? stripHtml(raw) : raw;
  return {
    text,
    htmlStripped,
    promptInjectionSignals: promptInjectionSignals(text)
  };
}

function truncateUtf8(text, maxBytes) {
  const source = String(text ?? "");
  if (Buffer.byteLength(source, "utf8") <= maxBytes) {
    return { text: source, truncated: false };
  }
  let low = 0;
  let high = source.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(source.slice(0, middle), "utf8") <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return { text: source.slice(0, low), truncated: true };
}

function countAndCloneJson(value, limits, state, depth = 0) {
  if (depth > 64) {
    state.truncated = true;
    return "[Max depth reached]";
  }
  if (typeof value === "string") {
    const normalized = normalizeUntrustedText(value, limits);
    state.htmlStripped ||= normalized.htmlStripped;
    state.promptInjectionSignals.push(...normalized.promptInjectionSignals);
    return normalized.text;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    const output = [];
    for (const item of value) {
      state.fields += 1;
      if (state.fields > limits.maxJsonFields) {
        state.truncated = true;
        break;
      }
      output.push(countAndCloneJson(item, limits, state, depth + 1));
    }
    return output;
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    state.fields += 1;
    if (state.fields > limits.maxJsonFields) {
      state.truncated = true;
      break;
    }
    output[key] = countAndCloneJson(item, limits, state, depth + 1);
  }
  return output;
}

function sanitizeStructured(value, limits) {
  if (value === undefined) {
    return {
      value: null,
      truncated: false,
      fields: 0,
      htmlStripped: false,
      promptInjectionSignals: []
    };
  }
  try {
    const state = {
      fields: 0,
      truncated: false,
      htmlStripped: false,
      promptInjectionSignals: []
    };
    const cloned = countAndCloneJson(value, limits, state);
    const serialized = JSON.stringify(cloned);
    if (Buffer.byteLength(serialized, "utf8") > limits.maxStructuredBytes) {
      return {
        value: {
          truncated: true,
          reason: "MCP structured content exceeded the local byte limit.",
          byteLength: Buffer.byteLength(serialized, "utf8")
        },
        truncated: true,
        fields: state.fields,
        htmlStripped: state.htmlStripped,
        promptInjectionSignals: state.promptInjectionSignals
      };
    }
    return {
      value: cloned,
      truncated: state.truncated,
      fields: state.fields,
      htmlStripped: state.htmlStripped,
      promptInjectionSignals: state.promptInjectionSignals
    };
  } catch {
    return {
      value: {
        truncated: true,
        reason: "MCP structured content is not JSON serializable."
      },
      truncated: true,
      fields: 0,
      htmlStripped: false,
      promptInjectionSignals: []
    };
  }
}

function mergeStructuredSafety(safety, result) {
  safety.htmlStripped ||= result.htmlStripped;
  safety.promptInjectionSignals.push(...result.promptInjectionSignals);
}

export function sanitizeMcpToolResult(result, context = {}, configuredLimits = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(configuredLimits ?? {}) };
  const sourceContent = Array.isArray(result?.content) ? result.content : [];
  const content = [];
  const safety = {
    untrusted: true,
    classification: "untrusted-data",
    htmlStripped: false,
    promptInjectionSignals: [],
    binaryBlocksOmitted: 0,
    contentTruncated: sourceContent.length > limits.maxContentBlocks,
    structuredTruncated: false
  };
  let remainingTextBytes = limits.maxTextBytes;

  for (const block of sourceContent.slice(0, limits.maxContentBlocks)) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text") {
      const normalized = normalizeUntrustedText(block.text, limits);
      safety.htmlStripped ||= normalized.htmlStripped;
      safety.promptInjectionSignals.push(...normalized.promptInjectionSignals);
      const bounded = truncateUtf8(normalized.text, Math.max(0, remainingTextBytes));
      remainingTextBytes -= Buffer.byteLength(bounded.text, "utf8");
      safety.contentTruncated ||= bounded.truncated;
      content.push({
        type: "text",
        text: bounded.text,
        truncated: bounded.truncated,
        untrusted: true,
        classification: normalized.promptInjectionSignals.length > 0
          ? "prompt-injection-suspected"
          : "untrusted-data"
      });
      continue;
    }
    if (block.type === "image" || block.type === "audio" || block.type === "blob") {
      safety.binaryBlocksOmitted += 1;
      content.push({
        type: String(block.type),
        mimeType: String(block.mimeType ?? "application/octet-stream"),
        omitted: true,
        reason: "Binary MCP result content is not injected into model context."
      });
      continue;
    }
    if (block.type === "resource" || block.type === "resource_link") {
      const sanitized = sanitizeStructured(block, {
        ...limits,
        maxStructuredBytes: Math.min(limits.maxStructuredBytes, 262144),
        maxJsonFields: Math.min(limits.maxJsonFields, 2000)
      });
      content.push(sanitized.value);
      safety.contentTruncated ||= sanitized.truncated;
      mergeStructuredSafety(safety, sanitized);
      continue;
    }
    content.push({ type: String(block.type ?? "unknown"), omitted: true });
  }

  const structured = sanitizeStructured(result?.structuredContent, limits);
  const meta = sanitizeStructured(result?._meta, {
    ...limits,
    maxStructuredBytes: Math.min(limits.maxStructuredBytes, 131072),
    maxJsonFields: Math.min(limits.maxJsonFields, 1000)
  });
  safety.structuredTruncated = structured.truncated;
  mergeStructuredSafety(safety, structured);
  mergeStructuredSafety(safety, meta);
  safety.promptInjectionSignals = [...new Set(safety.promptInjectionSignals)].slice(0, 8);
  if (safety.promptInjectionSignals.length > 0) {
    safety.classification = "prompt-injection-suspected";
  }

  const base = {
    ok: result?.isError !== true,
    serverId: context.serverId,
    toolName: context.toolName,
    content,
    structuredContent: structured.value,
    meta: meta.value,
    safety
  };
  if (result?.isError === true) {
    const message = content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    base.error = {
      code: "MCP_TOOL_ERROR",
      type: "execution_failed",
      message: message || "MCP Server 返回了工具执行错误。",
      retryable: false
    };
  }
  return base;
}
