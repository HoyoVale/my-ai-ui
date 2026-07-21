import { TextDecoder } from "node:util";

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const NEWLINE_PATTERN = /\r\n|\r|\n/gu;

function codecError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function hasPrefix(buffer, prefix) {
  return buffer.length >= prefix.length && buffer.subarray(0, prefix.length).equals(prefix);
}

function containsBinaryControl(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let controls = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controls += 1;
  }
  return sample.length > 0 && controls / sample.length > 0.02;
}

function decodeUtf8(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw codecError("INVALID_TEXT_ENCODING", "文件不是有效的 UTF-8 文本。");
  }
}

function decodeUtf16Le(buffer) {
  if (buffer.length % 2 !== 0) {
    throw codecError("INVALID_TEXT_ENCODING", "UTF-16LE 文件字节长度无效。");
  }
  return buffer.toString("utf16le");
}

export function detectNewline(text) {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (const match of String(text ?? "").matchAll(NEWLINE_PATTERN)) {
    if (match[0] === "\r\n") crlf += 1;
    else if (match[0] === "\n") lf += 1;
    else cr += 1;
  }
  const types = [lf > 0, crlf > 0, cr > 0].filter(Boolean).length;
  if (types === 0) return "none";
  if (types > 1) return "mixed";
  if (crlf > 0) return "crlf";
  if (cr > 0) return "cr";
  return "lf";
}

export function newlineSequence(newline) {
  if (newline === "crlf") return "\r\n";
  if (newline === "cr") return "\r";
  return "\n";
}

export function normalizeTextNewlines(text, newline) {
  if (!["lf", "crlf", "cr"].includes(newline)) return String(text ?? "");
  return String(text ?? "").replace(NEWLINE_PATTERN, newlineSequence(newline));
}

export function decodeTextBuffer(buffer, { encoding = "auto" } = {}) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? "");
  const requested = String(encoding ?? "auto").toLowerCase();
  let actualEncoding = requested;
  let bom = false;
  let body = source;

  if (requested === "auto") {
    if (hasPrefix(source, UTF8_BOM)) {
      actualEncoding = "utf8";
      bom = true;
      body = source.subarray(UTF8_BOM.length);
    } else if (hasPrefix(source, UTF16LE_BOM)) {
      actualEncoding = "utf16le";
      bom = true;
      body = source.subarray(UTF16LE_BOM.length);
    } else {
      actualEncoding = "utf8";
    }
  } else if (requested === "utf8") {
    bom = hasPrefix(source, UTF8_BOM);
    body = bom ? source.subarray(UTF8_BOM.length) : source;
  } else if (requested === "utf16le") {
    bom = hasPrefix(source, UTF16LE_BOM);
    body = bom ? source.subarray(UTF16LE_BOM.length) : source;
  } else {
    throw codecError("UNSUPPORTED_TEXT_ENCODING", `不支持的文本编码：${requested}`);
  }

  if (actualEncoding === "utf8" && !bom && containsBinaryControl(body)) {
    throw codecError("BINARY_FILE_BLOCKED", "目标文件疑似二进制文件，已拒绝文本改写。");
  }

  const text = actualEncoding === "utf16le"
    ? decodeUtf16Le(body)
    : decodeUtf8(body);

  return {
    text,
    encoding: actualEncoding,
    bom,
    newline: detectNewline(text),
    bytes: source.length
  };
}

export function encodeTextBuffer(text, {
  encoding = "utf8",
  bom = false
} = {}) {
  const actualEncoding = String(encoding ?? "utf8").toLowerCase();
  const value = String(text ?? "");
  if (actualEncoding === "utf8") {
    const body = Buffer.from(value, "utf8");
    return bom ? Buffer.concat([UTF8_BOM, body]) : body;
  }
  if (actualEncoding === "utf16le") {
    const body = Buffer.from(value, "utf16le");
    return bom ? Buffer.concat([UTF16LE_BOM, body]) : body;
  }
  throw codecError("UNSUPPORTED_TEXT_ENCODING", `不支持的文本编码：${actualEncoding}`);
}

export function resolveWriteCodec({
  requestedEncoding = "auto",
  existing = null,
  preserveNewline = true,
  content = ""
} = {}) {
  const requested = String(requestedEncoding ?? "auto").toLowerCase();
  const encoding = requested === "auto"
    ? existing?.encoding ?? "utf8"
    : requested;
  const bom = existing && existing.encoding === encoding
    ? existing.bom === true
    : encoding === "utf16le";
  const newline = preserveNewline && existing && ["lf", "crlf", "cr"].includes(existing.newline)
    ? existing.newline
    : detectNewline(content);
  const text = preserveNewline && existing
    ? normalizeTextNewlines(content, existing.newline)
    : String(content ?? "");
  return { encoding, bom, newline, text };
}
