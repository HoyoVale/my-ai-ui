const PROTOCOL_MARKER = /(?:<\s*[｜|]{0,2}DSML[｜|]{0,2}\s*(?:tool_calls|invoke|function_calls)?\s*>|<\/?\s*(?:tool_calls?|function_calls?|invoke)\b[^>]*>|<\|(?:tool_calls?|function_calls?|assistant to=|tool)\|>)/iu;

const BLOCK_PATTERNS = [
  /<\s*[｜|]{0,2}DSML[｜|]{0,2}\s*tool_calls\s*>[\s\S]*?<\s*[｜|]{0,2}DSML[｜|]{0,2}\s*\/\s*tool_calls\s*>/giu,
  /<\s*tool_calls?\b[^>]*>[\s\S]*?<\s*\/\s*tool_calls?\s*>/giu,
  /<\s*function_calls?\b[^>]*>[\s\S]*?<\s*\/\s*function_calls?\s*>/giu,
  /<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/giu
];

const LINE_PATTERNS = [
  /^.*<\s*[｜|]{0,2}DSML[｜|]{0,2}\s*(?:invoke|tool_calls|\/tool_calls)[^>]*>.*$/gimu,
  /^.*<\/?\s*(?:invoke|tool_call|function_call)\b[^>]*>.*$/gimu,
  /^.*<\|(?:tool_call|tool_calls|function_call)[^>]*\|>.*$/gimu
];

function jsonProtocolOnly(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    const parsed = JSON.parse(trimmed);
    const object = Array.isArray(parsed) ? parsed[0] : parsed;
    return Boolean(
      object && typeof object === "object" &&
      (object.tool_calls || object.toolCalls || object.function_call || object.functionCall)
    );
  } catch {
    return false;
  }
}

export function containsProviderProtocol(value) {
  const text = String(value ?? "");
  return PROTOCOL_MARKER.test(text) || jsonProtocolOnly(text);
}

export function sanitizePublicAssistantText(value) {
  let text = String(value ?? "");
  if (!text.trim()) return "";
  if (jsonProtocolOnly(text)) return "";

  for (const pattern of BLOCK_PATTERNS) {
    text = text.replace(pattern, "");
  }
  for (const pattern of LINE_PATTERNS) {
    text = text.replace(pattern, "");
  }

  const unmatched = text.search(PROTOCOL_MARKER);
  if (unmatched >= 0) {
    text = text.slice(0, unmatched);
  }

  return text
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

const PROTOCOL_END_MARKER = /(?:<\s*[｜|]{0,2}DSML[｜|]{0,2}\s*\/\s*tool_calls\s*>|<\s*\/\s*(?:tool_calls?|function_calls?|invoke)\s*>|<\|tool_calls_section_end\|>)/iu;

function markerMatch(text, pattern) {
  const match = pattern.exec(text);
  return match
    ? { index: match.index, end: match.index + match[0].length }
    : null;
}

export class PublicTextStreamSanitizer {
  constructor({ tailLength = 40 } = {}) {
    this.buffer = "";
    this.tailLength = Math.max(32, Number(tailLength) || 40);
    this.suppressingProtocol = false;
    this.publicTextEmitted = false;
    this.pendingProtocolSeparator = false;
  }

  emitPublic(value) {
    let output = String(value ?? "");
    if (!output) return "";
    if (this.pendingProtocolSeparator && this.publicTextEmitted) {
      output = `\n${output.replace(/^\s+/u, "")}`;
      this.pendingProtocolSeparator = false;
    }
    this.publicTextEmitted = true;
    return output;
  }

  consumeSuppressed(chunk) {
    const candidate = `${this.buffer}${String(chunk ?? "")}`;
    const endMarker = markerMatch(candidate, PROTOCOL_END_MARKER);
    if (!endMarker) {
      this.buffer = candidate.slice(-this.tailLength * 2);
      return "";
    }

    this.buffer = "";
    this.suppressingProtocol = false;
    return this.push(candidate.slice(endMarker.end));
  }

  push(chunk) {
    if (this.suppressingProtocol) {
      return this.consumeSuppressed(chunk);
    }

    this.buffer += String(chunk ?? "");
    const startMarker = markerMatch(this.buffer, PROTOCOL_MARKER);
    if (startMarker) {
      const safePrefix = this.emitPublic(sanitizePublicAssistantText(
        this.buffer.slice(0, startMarker.index)
      ));
      const protocolAndRemainder = this.buffer.slice(startMarker.index);
      this.buffer = "";
      this.suppressingProtocol = true;
      this.pendingProtocolSeparator = this.publicTextEmitted;
      const afterProtocol = this.consumeSuppressed(protocolAndRemainder);
      return `${safePrefix}${afterProtocol}`;
    }

    if (this.buffer.length <= this.tailLength) return "";
    const emitLength = this.buffer.length - this.tailLength;
    const emitted = this.buffer.slice(0, emitLength);
    this.buffer = this.buffer.slice(emitLength);
    return this.emitPublic(emitted);
  }

  flush() {
    const emitted = this.suppressingProtocol
      ? ""
      : this.emitPublic(sanitizePublicAssistantText(this.buffer));
    this.buffer = "";
    this.suppressingProtocol = false;
    this.pendingProtocolSeparator = false;
    return emitted;
  }
}
