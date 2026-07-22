import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { createTextDiffPreview } from "./textDiffPreview.js";

import {
  getWorkspaceRoots,
  isExcludedDirectory,
  isSensitiveWorkspacePath,
  resolveWorkspacePath
} from "./workspacePolicy.js";

const fsp = fs.promises;
const READ_RUNTIME_CONTRACT = Object.freeze({
  effect: "read",
  retryMode: "safe",
  supportsAbort: true,
  supportsResume: true
});
const NEWLINE_VALUES = ["lf", "crlf", "cr", "mixed", "none"];
const ENCODING_VALUES = ["auto", "utf8", "utf16le"];

function workspaceToolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }
  const error = workspaceToolError("CANCELLED_BY_USER", "工具执行已取消。");
  error.name = "AbortError";
  throw error;
}

function fileKind(stat) {
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  if (stat.isSymbolicLink()) return "symlink";
  return "other";
}

function sizeLimitMessage(maxBytes) {
  return `${Math.round(maxBytes / 100_000) / 10} MB`;
}

async function openSafeReadHandle(filePath) {
  const flags = process.platform === "win32"
    ? "r"
    : fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
  try {
    return await fsp.open(filePath, flags);
  } catch (error) {
    if (["ELOOP", "EMLINK"].includes(error?.code)) {
      throw workspaceToolError(
        "SYMLINK_READ_BLOCKED",
        "拒绝读取符号链接文件。"
      );
    }
    throw error;
  }
}

function assertStableFile(before, after, bytesRead) {
  if (
    after.size !== before.size ||
    after.size !== bytesRead ||
    after.mtimeMs !== before.mtimeMs
  ) {
    throw workspaceToolError(
      "FILE_CHANGED_DURING_READ",
      "文件在读取期间发生变化，请重试。"
    );
  }
}

function detectNewline(text) {
  const crlf = (text.match(/\r\n/gu) ?? []).length;
  const withoutCrlf = text.replace(/\r\n/gu, "");
  const lf = (withoutCrlf.match(/\n/gu) ?? []).length;
  const cr = (withoutCrlf.match(/\r/gu) ?? []).length;
  const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length;

  if (kinds === 0) return "none";
  if (kinds > 1) return "mixed";
  if (crlf > 0) return "crlf";
  if (lf > 0) return "lf";
  return "cr";
}

function decodeTextBuffer(buffer, requestedEncoding = "auto") {
  const requested = ENCODING_VALUES.includes(requestedEncoding)
    ? requestedEncoding
    : "auto";
  const hasUtf8Bom = buffer.length >= 3 &&
    buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const hasUtf16LeBom = buffer.length >= 2 &&
    buffer[0] === 0xff && buffer[1] === 0xfe;
  const hasUtf16BeBom = buffer.length >= 2 &&
    buffer[0] === 0xfe && buffer[1] === 0xff;

  if (hasUtf16BeBom) {
    throw workspaceToolError(
      "UNSUPPORTED_TEXT_ENCODING",
      "暂不支持 UTF-16BE 文本，请先转换为 UTF-8 或 UTF-16LE。"
    );
  }

  let encoding = requested;
  let offset = 0;
  let bom = false;

  if (requested === "auto") {
    if (hasUtf16LeBom) {
      encoding = "utf16le";
      offset = 2;
      bom = true;
    } else {
      encoding = "utf8";
      if (hasUtf8Bom) {
        offset = 3;
        bom = true;
      }
    }
  } else if (requested === "utf8") {
    if (hasUtf16LeBom) {
      throw workspaceToolError(
        "INVALID_TEXT_ENCODING",
        "文件带有 UTF-16LE BOM，但请求按 UTF-8 读取。"
      );
    }
    if (hasUtf8Bom) {
      offset = 3;
      bom = true;
    }
  } else if (requested === "utf16le") {
    if (hasUtf8Bom) {
      throw workspaceToolError(
        "INVALID_TEXT_ENCODING",
        "文件带有 UTF-8 BOM，但请求按 UTF-16LE 读取。"
      );
    }
    if (hasUtf16LeBom) {
      offset = 2;
      bom = true;
    }
  }

  const body = buffer.subarray(offset);
  if (encoding === "utf8" && body.subarray(0, 8192).includes(0)) {
    throw workspaceToolError(
      "BINARY_FILE_BLOCKED",
      "检测到二进制文件，拒绝按文本读取。"
    );
  }

  let text;
  try {
    text = new TextDecoder(
      encoding === "utf16le" ? "utf-16le" : "utf-8",
      { fatal: true }
    ).decode(body);
  } catch {
    throw workspaceToolError(
      "INVALID_TEXT_ENCODING",
      `文件不是有效的 ${encoding === "utf16le" ? "UTF-16LE" : "UTF-8"} 文本。`
    );
  }

  return {
    text,
    encoding,
    bom,
    newline: detectNewline(text)
  };
}

async function readSafeTextFile(
  filePath,
  maxBytes,
  {
    signal,
    encoding = "auto"
  } = {}
) {
  throwIfAborted(signal);
  const handle = await openSafeReadHandle(filePath);

  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw workspaceToolError("FILE_REQUIRED", "该工具只接受普通文件。");
    }
    if (stat.size > maxBytes) {
      throw workspaceToolError(
        "FILE_TOO_LARGE",
        `文件超过 ${sizeLimitMessage(maxBytes)} 的只读工具上限。`
      );
    }

    const chunks = [];
    let totalBytes = 0;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));

    while (true) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw workspaceToolError(
          "FILE_TOO_LARGE",
          `文件读取期间增长并超过 ${sizeLimitMessage(maxBytes)} 上限。`
        );
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }

    const after = await handle.stat();
    assertStableFile(stat, after, totalBytes);
    const content = Buffer.concat(chunks, totalBytes);
    const decoded = decodeTextBuffer(content, encoding);

    return {
      ...decoded,
      bytes: totalBytes,
      stat: after,
      sha256: crypto.createHash("sha256").update(content).digest("hex")
    };
  } finally {
    await handle.close();
  }
}

function splitLines(text) {
  return text.split(/\r\n|\n|\r/u);
}

function numberedLines(lines, startLine) {
  return lines.map((line, index) => `${startLine + index}: ${line}`).join("\n");
}

function textRange(file, {
  startLine = 1,
  endLine,
  maxReadLines,
  includeLineNumbers = false
}) {
  const lines = splitLines(file.text);
  const start = startLine;

  if (start > lines.length) {
    throw workspaceToolError(
      "LINE_RANGE_OUT_OF_BOUNDS",
      `起始行 ${start} 超出文件总行数 ${lines.length}。`
    );
  }

  const requestedEnd = endLine ?? start + Math.min(199, maxReadLines - 1);
  if (requestedEnd < start) {
    throw workspaceToolError(
      "INVALID_LINE_RANGE",
      "endLine 不能小于 startLine。"
    );
  }

  const end = Math.min(
    requestedEnd,
    start + maxReadLines - 1,
    lines.length
  );
  const selected = lines.slice(start - 1, end);
  const hasMoreAfter = end < lines.length;

  return {
    startLine: start,
    endLine: end,
    totalLines: lines.length,
    content: includeLineNumbers
      ? numberedLines(selected, start)
      : selected.join("\n"),
    truncated: hasMoreAfter || requestedEnd > end,
    hasMoreBefore: start > 1,
    hasMoreAfter,
    nextStartLine: hasMoreAfter ? end + 1 : null
  };
}

function escapeRegExp(character) {
  return /[.*+?^${}()|[\]\\]/u.test(character)
    ? `\\${character}`
    : character;
}

function globToRegExp(pattern, { caseSensitive = false } = {}) {
  const source = String(pattern ?? "*").trim() || "*";
  let output = "^";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "*") {
      if (source[index + 1] === "*") {
        if (["/", "\\"].includes(source[index + 2])) {
          output += "(?:.*[/\\\\])?";
          index += 2;
        } else {
          output += ".*";
          index += 1;
        }
      } else {
        output += "[^/\\\\]*";
      }
    } else if (character === "?") {
      output += "[^/\\\\]";
    } else if (["/", "\\"].includes(character)) {
      output += "[/\\\\]";
    } else {
      output += escapeRegExp(character);
    }
  }

  return new RegExp(`${output}$`, caseSensitive ? "u" : "iu");
}

function normalizedPath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isHiddenName(name) {
  return String(name ?? "").startsWith(".");
}

function patternMatches(patterns, relativePath, name = path.basename(relativePath)) {
  return patterns.some((matcher) =>
    matcher.test(relativePath) || matcher.test(name)
  );
}

function compileGlobPatterns(patterns = []) {
  return patterns.map((pattern) => globToRegExp(pattern));
}

async function walkWorkspaceEntries({
  directory,
  root,
  maxDepth,
  maxEntries,
  includeHidden = true,
  ignoreMatchers = [],
  onEntry,
  signal
}) {
  const stack = [{ directory, depth: 0 }];
  const stats = {
    directoriesVisited: 0,
    filesVisited: 0,
    entriesVisited: 0,
    skippedDirectories: 0,
    skippedEntries: 0,
    stopped: false,
    limitReason: ""
  };

  while (stack.length > 0) {
    throwIfAborted(signal);
    const current = stack.pop();
    let entries;

    try {
      entries = await fsp.readdir(current.directory, { withFileTypes: true });
      stats.directoriesVisited += 1;
    } catch {
      stats.skippedDirectories += 1;
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    const childDirectories = [];

    for (const entry of entries) {
      throwIfAborted(signal);
      stats.entriesVisited += 1;
      if (stats.entriesVisited > maxEntries) {
        stats.stopped = true;
        stats.limitReason = "entry_limit";
        return stats;
      }

      const absolutePath = path.join(current.directory, entry.name);
      const relativePath = normalizedPath(path.relative(root, absolutePath));
      const hidden = isHiddenName(entry.name);
      const fixedExcluded = entry.isDirectory() && isExcludedDirectory(entry.name);
      const ignored = patternMatches(ignoreMatchers, relativePath, entry.name);

      if (
        fixedExcluded ||
        (!includeHidden && hidden) ||
        ignored ||
        entry.isSymbolicLink() ||
        isSensitiveWorkspacePath(absolutePath)
      ) {
        stats.skippedEntries += 1;
        continue;
      }

      let stat;
      try {
        stat = await fsp.lstat(absolutePath);
      } catch {
        stats.skippedEntries += 1;
        continue;
      }

      const depth = current.depth + 1;
      if (stat.isFile()) stats.filesVisited += 1;

      const shouldContinue = await onEntry({
        absolutePath,
        relativePath,
        name: entry.name,
        depth,
        hidden,
        stat,
        type: fileKind(stat)
      });
      if (shouldContinue === false) {
        stats.stopped = true;
        if (!stats.limitReason) stats.limitReason = "result_limit";
        return stats;
      }

      if (entry.isDirectory() && depth < maxDepth) {
        childDirectories.push({
          directory: absolutePath,
          depth
        });
      }
    }

    for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
      stack.push(childDirectories[index]);
    }
  }

  return stats;
}

function projectType(manifestName) {
  const types = {
    "package.json": "Node.js / JavaScript",
    "pyproject.toml": "Python",
    "requirements.txt": "Python",
    "Cargo.toml": "Rust",
    "go.mod": "Go",
    "CMakeLists.txt": "C / C++",
    "pom.xml": "Java / Maven",
    "build.gradle": "Java / Gradle",
    "build.gradle.kts": "Kotlin / Gradle"
  };
  return types[manifestName] ?? "Unknown";
}

async function hashFile(filePath, maxBytes, { signal } = {}) {
  throwIfAborted(signal);
  const handle = await openSafeReadHandle(filePath);

  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw workspaceToolError("FILE_REQUIRED", "该工具只接受普通文件。");
    }
    if (stat.size > maxBytes) {
      throw workspaceToolError(
        "FILE_TOO_LARGE",
        `文件超过 ${sizeLimitMessage(maxBytes)} 的哈希计算上限。`
      );
    }

    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(128 * 1024);
    let totalBytes = 0;

    while (true) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw workspaceToolError(
          "FILE_TOO_LARGE",
          "文件读取期间增长并超过哈希计算上限。"
        );
      }
      hash.update(buffer.subarray(0, bytesRead));
    }

    const after = await handle.stat();
    assertStableFile(stat, after, totalBytes);
    return {
      hash: hash.digest("hex"),
      sizeBytes: totalBytes,
      modifiedAt: after.mtime.toISOString()
    };
  } finally {
    await handle.close();
  }
}

function sortDirectoryEntries(entries, sortBy) {
  const sorted = [...entries];
  sorted.sort((left, right) => {
    if (sortBy === "type") {
      const type = left.type.localeCompare(right.type, "en");
      if (type !== 0) return type;
    } else if (sortBy === "size") {
      const size = (left.sizeBytes ?? -1) - (right.sizeBytes ?? -1);
      if (size !== 0) return size;
    } else if (sortBy === "modifiedAt") {
      const modified = left.modifiedAt.localeCompare(right.modifiedAt, "en");
      if (modified !== 0) return modified;
    }
    return left.path.localeCompare(right.path, "en");
  });
  return sorted;
}

function treeText(entries) {
  return entries.map((entry) => {
    const marker = entry.type === "directory" ? "[D]" : "[F]";
    return `${"  ".repeat(Math.max(0, entry.depth - 1))}${marker} ${entry.name}`;
  }).join("\n");
}

function parseModifiedAfter(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw workspaceToolError(
      "INVALID_DATE_FILTER",
      "modifiedAfter 必须是有效的 ISO 日期时间。"
    );
  }
  return timestamp;
}

function assertSafeRegex(source) {
  if (source.length > 200) {
    throw workspaceToolError("REGEX_TOO_COMPLEX", "正则表达式长度不能超过 200 个字符。");
  }
  if (/\\[1-9]|\\k<|\(\?(?:[=!]|<[=!])/u.test(source)) {
    throw workspaceToolError(
      "REGEX_UNSAFE_FEATURE",
      "正则搜索不支持反向引用或前后向断言。"
    );
  }
  if (
    /\([^)]*(?:\*|\+|\{\d+(?:,\d*)?\})[^)]*\)(?:\*|\+|\?|\{\d+(?:,\d*)?\})/u.test(source) ||
    /\)(?:\*|\+|\?|\{\d+(?:,\d*)?\})/u.test(source)
  ) {
    throw workspaceToolError(
      "REGEX_TOO_COMPLEX",
      "正则表达式包含可能造成灾难性回溯的分组量词或嵌套量词。"
    );
  }
}

function compileSearchRegex(query, caseSensitive) {
  assertSafeRegex(query);
  try {
    return new RegExp(query, caseSensitive ? "u" : "iu");
  } catch (error) {
    throw workspaceToolError(
      "INVALID_REGEX",
      `正则表达式无效：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function wordCharacter(character) {
  return character ? /[\p{L}\p{N}_]/u.test(character) : false;
}

function findLiteralIndex(line, query, { caseSensitive, wholeWord }) {
  const comparableLine = caseSensitive ? line : line.toLocaleLowerCase();
  const comparableQuery = caseSensitive ? query : query.toLocaleLowerCase();
  let index = comparableLine.indexOf(comparableQuery);

  while (index >= 0) {
    if (!wholeWord) return index;
    const before = line[index - 1] ?? "";
    const after = line[index + query.length] ?? "";
    if (!wordCharacter(before) && !wordCharacter(after)) return index;
    index = comparableLine.indexOf(comparableQuery, index + Math.max(1, query.length));
  }

  return -1;
}

const pathSchema = z.string().trim().max(500);
const runtimeReadMetadata = {
  sideEffect: "read",
  riskLevel: "low",
  idempotency: "natural",
  retryPolicy: {
    maxAttempts: 2,
    retryOn: ["TEMPORARY_FAILURE"],
    backoffMs: 120
  },
  runtimeContract: READ_RUNTIME_CONTRACT
};

const CONTINUITY_READ_CACHE_VERSION = 1;
const CONTINUITY_READ_CACHE_MAX_ENTRIES = 256;
const CONTINUITY_READ_CACHE_MAX_BYTES = 32_000_000;

function stableCacheValue(value) {
  if (Array.isArray(value)) return value.map(stableCacheValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableCacheValue(value[key])])
    );
  }
  return value;
}

function continuityReadCacheKey(source) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableCacheValue(source)))
    .digest("hex");
}

async function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  await fsp.mkdir(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(value), "utf8");
  try {
    await fsp.rename(temporary, filePath);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
    await fsp.rm(filePath, { force: true });
    await fsp.rename(temporary, filePath);
  }
}

async function pruneContinuityReadCache(directory) {
  if (!directory) return;
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(directory, entry.name);
    try {
      const stat = await fsp.stat(filePath);
      files.push({ filePath, size: stat.size, modifiedAt: stat.mtimeMs });
    } catch {
      // Ignore a cache entry removed by another run.
    }
  }
  files.sort((left, right) => right.modifiedAt - left.modifiedAt);
  let totalBytes = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    totalBytes += file.size;
    if (
      index >= CONTINUITY_READ_CACHE_MAX_ENTRIES ||
      totalBytes > CONTINUITY_READ_CACHE_MAX_BYTES
    ) {
      await fsp.rm(file.filePath, { force: true }).catch(() => {});
    }
  }
}
const directoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  depth: z.number().int(),
  type: z.enum(["directory", "file", "symlink", "other"]),
  sizeBytes: z.number().int().nullable(),
  modifiedAt: z.string(),
  hidden: z.boolean()
});
const textReadOutputSchema = z.object({
  root: z.string(),
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  totalLines: z.number().int(),
  content: z.string(),
  truncated: z.boolean(),
  hasMoreBefore: z.boolean(),
  hasMoreAfter: z.boolean(),
  nextStartLine: z.number().int().nullable(),
  sizeBytes: z.number().int(),
  modifiedAt: z.string(),
  cacheReused: z.boolean(),
  encoding: z.enum(["utf8", "utf16le"]),
  bom: z.boolean(),
  newline: z.enum(NEWLINE_VALUES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  includeLineNumbers: z.boolean()
});

function compareLineSummary(before, after) {
  const left = splitLines(String(before ?? ""));
  const right = splitLines(String(after ?? ""));
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    identical: left.length === right.length && prefix === left.length,
    addedLines: Math.max(0, right.length - prefix - suffix),
    removedLines: Math.max(0, left.length - prefix - suffix)
  };
}

export function createWorkspaceToolDefinitions(workspaceSettings = {}) {
  const limits = {
    maxTextFileBytes: Math.min(
      20_000_000,
      Math.max(1_024, Number(workspaceSettings.maxTextFileBytes) || 2_000_000)
    ),
    maxReadLines: Math.min(
      5_000,
      Math.max(1, Number(workspaceSettings.maxReadLines) || 1000)
    ),
    maxDirectoryEntries: Math.min(
      1_000,
      Math.max(1, Number(workspaceSettings.maxDirectoryEntries) || 200)
    ),
    maxSearchResults: Math.min(
      500,
      Math.max(1, Number(workspaceSettings.maxSearchResults) || 100)
    ),
    maxSearchDepth: Math.min(
      12,
      Math.max(0, Number(workspaceSettings.maxSearchDepth) || 6)
    ),
    maxHashFileBytes: Math.min(
      200_000_000,
      Math.max(1_024, Number(workspaceSettings.maxHashFileBytes) || 50_000_000)
    )
  };
  limits.maxSearchEntries = Math.min(
    100_000,
    Math.max(2_000, limits.maxSearchResults * 500)
  );
  limits.maxSearchBytes = Math.min(
    256_000_000,
    Math.max(10_000_000, limits.maxTextFileBytes * 50)
  );
  limits.maxBatchFiles = 20;
  limits.maxBatchTotalBytes = Math.min(
    10_000_000,
    Math.max(500_000, limits.maxTextFileBytes * 3)
  );
  limits.maxTreeEntries = Math.min(2_000, limits.maxDirectoryEntries * 5);

  const resolve = (inputPath, options = {}) => resolveWorkspacePath(inputPath, {
    ...options,
    workspaceSettings
  });

  const continuityReadCacheDirectory = String(
    workspaceSettings.continuityReadCacheDirectory ?? ""
  ).trim();

  async function readTextWithContinuityCache(inputPath, {
    startLine = 1,
    endLine,
    maxBytes,
    encoding = "auto",
    includeLineNumbers = false,
    signal = null
  } = {}) {
    const resolved = resolve(inputPath, { allowDirectory: false });
    const normalizedInput = {
      path: resolved.path,
      startLine,
      endLine: endLine ?? null,
      maxBytes,
      encoding,
      includeLineNumbers
    };
    const key = continuityReadCacheKey(normalizedInput);
    const cachePath = continuityReadCacheDirectory
      ? path.join(continuityReadCacheDirectory, `${key}.json`)
      : "";

    if (cachePath) {
      try {
        const currentStat = await fsp.stat(resolved.path);
        const cached = JSON.parse(await fsp.readFile(cachePath, "utf8"));
        const signature = cached?.signature ?? {};
        if (
          cached?.version === CONTINUITY_READ_CACHE_VERSION &&
          cached?.key === key &&
          signature.size === currentStat.size &&
          signature.mtimeMs === currentStat.mtimeMs &&
          signature.ctimeMs === currentStat.ctimeMs &&
          cached?.output && typeof cached.output === "object"
        ) {
          await fsp.utimes(cachePath, new Date(), new Date()).catch(() => {});
          return {
            ...structuredClone(cached.output),
            cacheReused: true
          };
        }
      } catch {
        // Missing, stale or damaged cache entries are rebuilt from the file.
      }
    }

    const file = await readSafeTextFile(resolved.path, maxBytes, {
      signal,
      encoding
    });
    const range = textRange(file, {
      startLine,
      endLine,
      maxReadLines: limits.maxReadLines,
      includeLineNumbers
    });
    const output = {
      root: resolved.root,
      path: resolved.relativePath,
      ...range,
      sizeBytes: file.bytes,
      modifiedAt: file.stat.mtime.toISOString(),
      cacheReused: false,
      encoding: file.encoding,
      bom: file.bom,
      newline: file.newline,
      sha256: file.sha256,
      includeLineNumbers
    };

    if (cachePath) {
      await atomicWriteJson(cachePath, {
        version: CONTINUITY_READ_CACHE_VERSION,
        key,
        sourcePath: resolved.path,
        signature: {
          size: file.stat.size,
          mtimeMs: file.stat.mtimeMs,
          ctimeMs: file.stat.ctimeMs
        },
        output,
        cachedAt: Date.now()
      }).catch(() => {});
      void pruneContinuityReadCache(continuityReadCacheDirectory);
    }

    return output;
  }

  async function inspectPath(inputPath, context = {}) {
    throwIfAborted(context.abortSignal);
    let resolved;

    try {
      resolved = resolve(inputPath);
    } catch (error) {
      if (error?.code !== "PATH_NOT_FOUND") throw error;
      const unresolved = resolve(inputPath, { mustExist: false });
      return {
        root: unresolved.root,
        path: unresolved.relativePath,
        exists: false,
        type: "missing",
        sizeBytes: null,
        createdAt: null,
        modifiedAt: null,
        encoding: null,
        newline: null,
        sha256: null,
        symlink: false,
        symlinkTarget: null,
        readable: false
      };
    }

    const source = String(inputPath ?? ".").trim() || ".";
    const requestedPath = path.isAbsolute(source)
      ? path.resolve(source)
      : path.resolve(resolved.root, source);
    const requestedStat = await fsp.lstat(requestedPath);
    const stat = await fsp.stat(resolved.path);
    const symlink = requestedStat.isSymbolicLink();
    let symlinkTarget = null;

    if (symlink) {
      symlinkTarget = normalizedPath(path.relative(resolved.root, resolved.path)) || ".";
    }

    let encoding = null;
    let newline = null;
    let sha256 = null;

    if (stat.isFile()) {
      if (stat.size <= limits.maxHashFileBytes) {
        sha256 = (await hashFile(resolved.path, limits.maxHashFileBytes, {
          signal: context.abortSignal
        })).hash;
      }
      if (stat.size <= limits.maxTextFileBytes) {
        try {
          const file = await readSafeTextFile(resolved.path, limits.maxTextFileBytes, {
            signal: context.abortSignal,
            encoding: "auto"
          });
          encoding = file.encoding;
          newline = file.newline;
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          if (!["BINARY_FILE_BLOCKED", "INVALID_TEXT_ENCODING", "UNSUPPORTED_TEXT_ENCODING"].includes(error?.code)) {
            throw error;
          }
          encoding = error.code === "BINARY_FILE_BLOCKED" ? "binary" : "unknown";
        }
      }
    }

    return {
      root: resolved.root,
      path: resolved.relativePath,
      exists: true,
      type: fileKind(stat),
      sizeBytes: stat.isFile() ? stat.size : null,
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      encoding,
      newline,
      sha256,
      symlink,
      symlinkTarget,
      readable: true
    };
  }

  return [
    {
      name: "list_directory",
      title: "List directory",
      description:
        "List a bounded directory range inside an authorized workspace. Supports depth, hidden-file visibility, ignore Globs, metadata, and deterministic sorting without following symbolic links.",
      inputSchema: z.object({
        path: pathSchema.default("."),
        depth: z.number().int().min(1).max(limits.maxSearchDepth).default(1),
        includeHidden: z.boolean().default(true),
        ignorePatterns: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
        sortBy: z.enum(["name", "type", "size", "modifiedAt"]).default("name"),
        maxEntries: z.number().int().min(1)
          .max(limits.maxDirectoryEntries)
          .default(limits.maxDirectoryEntries)
      }),
      outputSchema: z.object({
        root: z.string(),
        path: z.string(),
        depth: z.number().int(),
        entries: z.array(directoryEntrySchema),
        truncated: z.boolean(),
        limitReason: z.string(),
        scannedEntries: z.number().int(),
        skippedEntries: z.number().int()
      }),
      timeoutMs: 20_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        const depth = input.depth ?? 1;
        const maxEntries = input.maxEntries ?? limits.maxDirectoryEntries;
        const includeHidden = input.includeHidden ?? true;
        const sortBy = input.sortBy ?? "name";
        const resolved = resolve(input.path ?? ".", { allowFile: false });
        const entries = [];
        const traversal = await walkWorkspaceEntries({
          directory: resolved.path,
          root: resolved.root,
          maxDepth: depth,
          maxEntries: Math.min(limits.maxSearchEntries, maxEntries * 20 + 100),
          includeHidden,
          ignoreMatchers: compileGlobPatterns(input.ignorePatterns ?? []),
          signal: context.abortSignal,
          async onEntry(entry) {
            entries.push({
              name: entry.name,
              path: entry.relativePath,
              depth: entry.depth,
              type: entry.type,
              sizeBytes: entry.stat.isFile() ? entry.stat.size : null,
              modifiedAt: entry.stat.mtime.toISOString(),
              hidden: entry.hidden
            });
            return entries.length <= maxEntries;
          }
        });
        const sorted = sortDirectoryEntries(entries, sortBy);
        const truncated = sorted.length > maxEntries || Boolean(traversal.limitReason);

        return {
          root: resolved.root,
          path: resolved.relativePath,
          depth,
          entries: sorted.slice(0, maxEntries),
          truncated,
          limitReason: sorted.length > maxEntries
            ? "result_limit"
            : traversal.limitReason,
          scannedEntries: traversal.entriesVisited,
          skippedEntries: traversal.skippedEntries + traversal.skippedDirectories
        };
      }
    },
    {
      name: "list_directory_tree",
      title: "List directory tree",
      description:
        "Build a bounded, deterministic project tree for an authorized directory. Fixed excluded directories, sensitive paths, symbolic links, depth, entry count, and output size remain constrained.",
      inputSchema: z.object({
        path: pathSchema.default("."),
        depth: z.number().int().min(1).max(limits.maxSearchDepth).default(3),
        includeHidden: z.boolean().default(true),
        ignorePatterns: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
        maxEntries: z.number().int().min(1)
          .max(limits.maxTreeEntries)
          .default(Math.min(500, limits.maxTreeEntries))
      }),
      outputSchema: z.object({
        root: z.string(),
        path: z.string(),
        depth: z.number().int(),
        tree: z.string(),
        entries: z.array(directoryEntrySchema),
        truncated: z.boolean(),
        limitReason: z.string(),
        scannedEntries: z.number().int(),
        skippedEntries: z.number().int()
      }),
      timeoutMs: 30_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        const depth = input.depth ?? 3;
        const maxEntries = input.maxEntries ?? Math.min(500, limits.maxTreeEntries);
        const includeHidden = input.includeHidden ?? true;
        const resolved = resolve(input.path ?? ".", { allowFile: false });
        const entries = [];
        const traversal = await walkWorkspaceEntries({
          directory: resolved.path,
          root: resolved.root,
          maxDepth: depth,
          maxEntries: Math.min(limits.maxSearchEntries, maxEntries * 20 + 100),
          includeHidden,
          ignoreMatchers: compileGlobPatterns(input.ignorePatterns ?? []),
          signal: context.abortSignal,
          async onEntry(entry) {
            entries.push({
              name: entry.name,
              path: entry.relativePath,
              depth: entry.depth,
              type: entry.type,
              sizeBytes: entry.stat.isFile() ? entry.stat.size : null,
              modifiedAt: entry.stat.mtime.toISOString(),
              hidden: entry.hidden
            });
            return entries.length <= maxEntries;
          }
        });
        const ordered = [...entries].sort((left, right) =>
          left.path.localeCompare(right.path, "en")
        );
        const visible = ordered.slice(0, maxEntries);
        const truncated = ordered.length > maxEntries || Boolean(traversal.limitReason);

        return {
          root: resolved.root,
          path: resolved.relativePath,
          depth,
          tree: treeText(visible),
          entries: visible,
          truncated,
          limitReason: ordered.length > maxEntries
            ? "result_limit"
            : traversal.limitReason,
          scannedEntries: traversal.entriesVisited,
          skippedEntries: traversal.skippedEntries + traversal.skippedDirectories
        };
      }
    },
    {
      name: "stat_path",
      title: "Inspect path",
      description:
        "Compatibility metadata lookup for one existing safe path. Prefer inspect_path when existence, encoding, newline, hash, or symlink details are needed.",
      inputSchema: z.object({
        path: pathSchema.min(1)
      }),
      outputSchema: z.object({
        root: z.string(),
        path: z.string(),
        type: z.enum(["directory", "file", "symlink", "other"]),
        sizeBytes: z.number().int().nullable(),
        createdAt: z.string(),
        modifiedAt: z.string(),
        readable: z.boolean(),
        writableByTool: z.boolean()
      }),
      timeoutMs: 10_000,
      ...runtimeReadMetadata,
      async execute({ path: inputPath }, context = {}) {
        const result = await inspectPath(inputPath, context);
        if (!result.exists) {
          throw workspaceToolError("PATH_NOT_FOUND", "路径不存在。");
        }
        return {
          root: result.root,
          path: result.path,
          type: result.type,
          sizeBytes: result.sizeBytes,
          createdAt: result.createdAt,
          modifiedAt: result.modifiedAt,
          readable: result.readable,
          writableByTool: false
        };
      }
    },
    {
      name: "inspect_path",
      title: "Inspect path deeply",
      description:
        "Inspect one authorized path, including non-existence, type, size, timestamps, safe symlink resolution, text encoding, newline style, and SHA-256 when within configured limits.",
      inputSchema: z.object({
        path: pathSchema.min(1)
      }),
      outputSchema: z.object({
        root: z.string(),
        path: z.string(),
        exists: z.boolean(),
        type: z.enum(["directory", "file", "symlink", "other", "missing"]),
        sizeBytes: z.number().int().nullable(),
        createdAt: z.string().nullable(),
        modifiedAt: z.string().nullable(),
        encoding: z.enum(["utf8", "utf16le", "binary", "unknown"]).nullable(),
        newline: z.enum(NEWLINE_VALUES).nullable(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
        symlink: z.boolean(),
        symlinkTarget: z.string().nullable(),
        readable: z.boolean()
      }),
      timeoutMs: 90_000,
      ...runtimeReadMetadata,
      execute(input, context = {}) {
        return inspectPath(input.path, context);
      }
    },
    {
      name: "read_text_file",
      title: "Read text file",
      description:
        "Read a bounded line range from one safe UTF-8 or UTF-16LE text file. Supports byte caps, BOM/newline detection, line numbers, SHA-256 evidence, and stable-file verification.",
      inputSchema: z.object({
        path: pathSchema.min(1),
        startLine: z.number().int().min(1).default(1),
        endLine: z.number().int().min(1).max(10_000_000).optional(),
        maxBytes: z.number().int().min(1_024)
          .max(limits.maxTextFileBytes)
          .default(limits.maxTextFileBytes),
        encoding: z.enum(ENCODING_VALUES).default("auto"),
        includeLineNumbers: z.boolean().default(false)
      }),
      outputSchema: textReadOutputSchema,
      timeoutMs: 25_000,
      ...runtimeReadMetadata,
      execute(input, context = {}) {
        return readTextWithContinuityCache(input.path, {
          startLine: input.startLine,
          endLine: input.endLine,
          maxBytes: input.maxBytes ?? limits.maxTextFileBytes,
          encoding: input.encoding ?? "auto",
          includeLineNumbers: input.includeLineNumbers ?? false,
          signal: context.abortSignal
        });
      }
    },
    {
      name: "read_multiple_files",
      title: "Read multiple files",
      description:
        "Read several small authorized text files in one bounded call. Each file reports success or an isolated error, while per-file and total byte limits prevent one failure or oversized result from consuming the whole batch.",
      inputSchema: z.object({
        paths: z.array(pathSchema.min(1)).min(1).max(limits.maxBatchFiles),
        maxBytesPerFile: z.number().int().min(1_024)
          .max(limits.maxTextFileBytes)
          .default(Math.min(200_000, limits.maxTextFileBytes)),
        maxTotalBytes: z.number().int().min(1_024)
          .max(limits.maxBatchTotalBytes)
          .default(Math.min(1_000_000, limits.maxBatchTotalBytes)),
        encoding: z.enum(ENCODING_VALUES).default("auto"),
        includeLineNumbers: z.boolean().default(false)
      }),
      outputSchema: z.object({
        results: z.array(z.union([
          textReadOutputSchema.extend({ ok: z.literal(true) }),
          z.object({
            ok: z.literal(false),
            path: z.string(),
            error: z.object({
              code: z.string(),
              message: z.string()
            })
          })
        ])),
        requestedFiles: z.number().int(),
        successfulFiles: z.number().int(),
        failedFiles: z.number().int(),
        totalBytes: z.number().int(),
        truncated: z.boolean(),
        limitReason: z.string()
      }),
      timeoutMs: 60_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        const maxBytesPerFile = input.maxBytesPerFile ?? Math.min(200_000, limits.maxTextFileBytes);
        const maxTotalBytes = input.maxTotalBytes ?? Math.min(1_000_000, limits.maxBatchTotalBytes);
        const encoding = input.encoding ?? "auto";
        const includeLineNumbers = input.includeLineNumbers ?? false;
        const results = [];
        let totalBytes = 0;
        let totalLimitReached = false;

        for (const inputPath of input.paths) {
          throwIfAborted(context.abortSignal);
          if (totalLimitReached) {
            results.push({
              ok: false,
              path: inputPath,
              error: {
                code: "TOTAL_RESULT_LIMIT",
                message: "批量读取总字节上限已达到。"
              }
            });
            continue;
          }

          try {
            const resolved = resolve(inputPath, { allowDirectory: false });
            const stat = await fsp.stat(resolved.path);
            if (totalBytes + stat.size > maxTotalBytes) {
              totalLimitReached = true;
              results.push({
                ok: false,
                path: resolved.relativePath,
                error: {
                  code: "TOTAL_RESULT_LIMIT",
                  message: "读取该文件会超过批量读取总字节上限。"
                }
              });
              continue;
            }
            const output = await readTextWithContinuityCache(inputPath, {
              startLine: 1,
              endLine: limits.maxReadLines,
              maxBytes: maxBytesPerFile,
              encoding,
              includeLineNumbers,
              signal: context.abortSignal
            });
            totalBytes += output.sizeBytes;
            results.push({
              ok: true,
              ...output
            });
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            results.push({
              ok: false,
              path: inputPath,
              error: {
                code: String(error?.code ?? "READ_FAILED"),
                message: error instanceof Error ? error.message : String(error)
              }
            });
          }
        }

        const successfulFiles = results.filter((item) => item.ok).length;
        const lineLimitReached = results.some((item) => item.ok && item.truncated);
        return {
          results,
          requestedFiles: input.paths.length,
          successfulFiles,
          failedFiles: results.length - successfulFiles,
          totalBytes,
          truncated: totalLimitReached || lineLimitReached,
          limitReason: totalLimitReached
            ? "total_byte_limit"
            : lineLimitReached
              ? "line_limit"
              : ""
        };
      }
    },
    {
      name: "compare_files",
      title: "Compare text files",
      description:
        "Compare two safe UTF-8 or UTF-16LE text files inside the same authorized workspace. Returns bounded unified Diff, hashes, encoding metadata, and added/removed line counts without modifying either file.",
      inputSchema: z.object({
        leftPath: pathSchema.min(1),
        rightPath: pathSchema.min(1),
        maxBytesPerFile: z.number().int().min(1_024)
          .max(limits.maxTextFileBytes)
          .default(Math.min(1_000_000, limits.maxTextFileBytes)),
        contextLines: z.number().int().min(0).max(12).default(3),
        maxDiffChars: z.number().int().min(1_000).max(100_000).default(24_000)
      }),
      outputSchema: z.object({
        root: z.string(),
        leftPath: z.string(),
        rightPath: z.string(),
        identical: z.boolean(),
        addedLines: z.number().int().nonnegative(),
        removedLines: z.number().int().nonnegative(),
        left: z.object({
          sizeBytes: z.number().int().nonnegative(),
          encoding: z.enum(["utf8", "utf16le"]),
          newline: z.enum(NEWLINE_VALUES),
          sha256: z.string().regex(/^[a-f0-9]{64}$/u)
        }),
        right: z.object({
          sizeBytes: z.number().int().nonnegative(),
          encoding: z.enum(["utf8", "utf16le"]),
          newline: z.enum(NEWLINE_VALUES),
          sha256: z.string().regex(/^[a-f0-9]{64}$/u)
        }),
        comparison: z.object({
          kind: z.literal("unified_diff"),
          path: z.string(),
          diff: z.string(),
          truncated: z.boolean()
        })
      }),
      timeoutMs: 35_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        const maxBytes = input.maxBytesPerFile ?? Math.min(1_000_000, limits.maxTextFileBytes);
        const leftResolved = resolve(input.leftPath, { allowDirectory: false });
        const rightResolved = resolve(input.rightPath, { allowDirectory: false });
        if (leftResolved.root !== rightResolved.root) {
          throw workspaceToolError("CROSS_WORKSPACE_COMPARE_BLOCKED", "只能比较同一授权工作区中的文件。");
        }
        const [left, right] = await Promise.all([
          readSafeTextFile(leftResolved.path, maxBytes, {
            signal: context.abortSignal,
            encoding: "auto"
          }),
          readSafeTextFile(rightResolved.path, maxBytes, {
            signal: context.abortSignal,
            encoding: "auto"
          })
        ]);
        const summary = compareLineSummary(left.text, right.text);
        const label = `${leftResolved.relativePath} ↔ ${rightResolved.relativePath}`;
        const changePreview = createTextDiffPreview({
          path: label,
          before: left.text,
          after: right.text,
          contextLines: input.contextLines,
          maxChars: input.maxDiffChars
        });
        return {
          root: leftResolved.root,
          leftPath: leftResolved.relativePath,
          rightPath: rightResolved.relativePath,
          ...summary,
          left: {
            sizeBytes: left.bytes,
            encoding: left.encoding,
            newline: left.newline,
            sha256: left.sha256
          },
          right: {
            sizeBytes: right.bytes,
            encoding: right.encoding,
            newline: right.newline,
            sha256: right.sha256
          },
          comparison: changePreview
        };
      }
    },
    {
      name: "search_files",
      title: "Search files",
      description:
        "Search safe workspace paths with bounded Globs and metadata filters. Supports include/exclude patterns, file type, size, modification time, depth, hidden files, stable ordering, and explicit truncation reporting.",
      inputSchema: z.object({
        path: pathSchema.default("."),
        pattern: z.string().trim().min(1).max(200).optional(),
        glob: z.string().trim().min(1).max(200).optional(),
        exclude: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
        fileType: z.enum(["file", "directory", "all"]).default("file"),
        minSize: z.number().int().min(0).optional(),
        maxSize: z.number().int().min(0).optional(),
        modifiedAfter: z.string().max(50).optional(),
        includeHidden: z.boolean().default(true),
        maxDepth: z.number().int().min(0)
          .max(limits.maxSearchDepth)
          .default(limits.maxSearchDepth),
        maxResults: z.number().int().min(1)
          .max(limits.maxSearchResults)
          .default(limits.maxSearchResults)
      }).refine((value) => Boolean(value.glob || value.pattern), {
        message: "glob 或兼容字段 pattern 至少需要提供一个。"
      }).refine((value) => (
        value.minSize === undefined ||
        value.maxSize === undefined ||
        value.minSize <= value.maxSize
      ), {
        message: "minSize 不能大于 maxSize。"
      }),
      outputSchema: z.object({
        root: z.string(),
        pattern: z.string(),
        matches: z.array(z.string()),
        details: z.array(directoryEntrySchema),
        truncated: z.boolean(),
        limitReason: z.string(),
        scannedEntries: z.number().int(),
        scannedFiles: z.number().int(),
        scannedDirectories: z.number().int(),
        skippedEntries: z.number().int()
      }),
      timeoutMs: 60_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        const fileType = input.fileType ?? "file";
        const includeHidden = input.includeHidden ?? true;
        const maxDepth = input.maxDepth ?? limits.maxSearchDepth;
        const maxResults = input.maxResults ?? limits.maxSearchResults;
        const resolved = resolve(input.path ?? ".", { allowFile: false });
        const selectedPattern = input.glob ?? input.pattern;
        const matcher = globToRegExp(selectedPattern);
        const excludeMatchers = compileGlobPatterns(input.exclude ?? []);
        const modifiedAfter = parseModifiedAfter(input.modifiedAfter);
        const details = [];

        const traversal = await walkWorkspaceEntries({
          directory: resolved.path,
          root: resolved.root,
          maxDepth: Math.max(1, maxDepth + 1),
          maxEntries: limits.maxSearchEntries,
          includeHidden,
          ignoreMatchers: [],
          signal: context.abortSignal,
          async onEntry(entry) {
            if (patternMatches(excludeMatchers, entry.relativePath, entry.name)) return true;
            if (fileType !== "all" && entry.type !== fileType) return true;
            if (entry.type === "file") {
              if (input.minSize !== undefined && entry.stat.size < input.minSize) return true;
              if (input.maxSize !== undefined && entry.stat.size > input.maxSize) return true;
            }
            if (modifiedAfter !== null && entry.stat.mtimeMs <= modifiedAfter) return true;
            if (!matcher.test(entry.relativePath) && !matcher.test(entry.name)) return true;

            details.push({
              name: entry.name,
              path: entry.relativePath,
              depth: entry.depth,
              type: entry.type,
              sizeBytes: entry.stat.isFile() ? entry.stat.size : null,
              modifiedAt: entry.stat.mtime.toISOString(),
              hidden: entry.hidden
            });
            return details.length <= maxResults;
          }
        });

        const sorted = [...details].sort((left, right) => {
          const depth = left.depth - right.depth;
          return depth !== 0
            ? depth
            : left.path.localeCompare(right.path, "en");
        });
        const truncated = sorted.length > maxResults || Boolean(traversal.limitReason);
        const visible = sorted.slice(0, maxResults);
        return {
          root: resolved.root,
          pattern: selectedPattern,
          matches: visible.map((item) => item.path),
          details: visible,
          truncated,
          limitReason: sorted.length > maxResults
            ? "result_limit"
            : traversal.limitReason,
          scannedEntries: traversal.entriesVisited,
          scannedFiles: traversal.filesVisited,
          scannedDirectories: traversal.directoriesVisited,
          skippedEntries: traversal.skippedEntries + traversal.skippedDirectories
        };
      }
    },
    {
      name: "search_text",
      title: "Search text",
      description:
        "Search literal text or a conservative bounded regular expression in safe text files. Supports include/exclude Globs, whole-word matching, context lines, per-file limits, byte/depth limits, and stable line metadata.",
      inputSchema: z.object({
        path: pathSchema.default("."),
        query: z.string().min(1).max(500),
        regex: z.boolean().default(false),
        caseSensitive: z.boolean().default(false),
        wholeWord: z.boolean().default(false),
        include: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
        exclude: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
        extensions: z.array(
          z.string().trim().min(1).max(20).regex(/^\.?[a-z0-9_+.-]+$/iu)
        ).max(30).optional(),
        contextBefore: z.number().int().min(0).max(10).default(0),
        contextAfter: z.number().int().min(0).max(10).default(0),
        maxMatchesPerFile: z.number().int().min(1).max(100).default(20),
        maxDepth: z.number().int().min(0)
          .max(limits.maxSearchDepth)
          .default(limits.maxSearchDepth),
        maxResults: z.number().int().min(1)
          .max(limits.maxSearchResults)
          .optional(),
        maxMatches: z.number().int().min(1)
          .max(limits.maxSearchResults)
          .optional()
      }),
      outputSchema: z.object({
        root: z.string(),
        query: z.string(),
        regex: z.boolean(),
        matches: z.array(z.object({
          path: z.string(),
          line: z.number().int(),
          column: z.number().int(),
          text: z.string(),
          before: z.array(z.string()),
          after: z.array(z.string())
        })),
        truncated: z.boolean(),
        limitReason: z.string(),
        scannedFiles: z.number().int(),
        scannedBytes: z.number().int(),
        skippedFiles: z.number().int()
      }),
      timeoutMs: 90_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        const regex = input.regex ?? false;
        const caseSensitive = input.caseSensitive ?? false;
        const wholeWord = input.wholeWord ?? false;
        const contextBefore = input.contextBefore ?? 0;
        const contextAfter = input.contextAfter ?? 0;
        const maxMatchesPerFile = input.maxMatchesPerFile ?? 20;
        const maxDepth = input.maxDepth ?? limits.maxSearchDepth;
        const resolved = resolve(input.path ?? ".", { allowFile: false });
        const maxMatches = input.maxMatches ?? input.maxResults ?? limits.maxSearchResults;
        const includeMatchers = compileGlobPatterns([
          ...(input.include ?? []),
          ...(input.extensions ?? []).map((extension) =>
            `**/*.${extension.toLowerCase().replace(/^\./u, "")}`
          )
        ]);
        const excludeMatchers = compileGlobPatterns(input.exclude ?? []);
        const searchRegex = regex
          ? compileSearchRegex(input.query, caseSensitive)
          : null;
        const matches = [];
        let scannedBytes = 0;
        let scannedFiles = 0;
        let skippedFiles = 0;
        let byteLimitReached = false;

        const traversal = await walkWorkspaceEntries({
          directory: resolved.path,
          root: resolved.root,
          maxDepth: Math.max(1, maxDepth + 1),
          maxEntries: limits.maxSearchEntries,
          includeHidden: true,
          ignoreMatchers: [],
          signal: context.abortSignal,
          async onEntry(entry) {
            if (entry.type !== "file") return true;
            if (includeMatchers.length > 0 && !patternMatches(includeMatchers, entry.relativePath, entry.name)) {
              return true;
            }
            if (patternMatches(excludeMatchers, entry.relativePath, entry.name)) return true;
            if (scannedBytes + entry.stat.size > limits.maxSearchBytes) {
              byteLimitReached = true;
              return false;
            }

            let file;
            try {
              file = await readSafeTextFile(entry.absolutePath, limits.maxTextFileBytes, {
                signal: context.abortSignal,
                encoding: "auto"
              });
            } catch (error) {
              if (error?.name === "AbortError") throw error;
              skippedFiles += 1;
              return true;
            }

            scannedBytes += file.bytes;
            scannedFiles += 1;
            const lines = splitLines(file.text);
            let fileMatches = 0;

            for (let index = 0; index < lines.length; index += 1) {
              throwIfAborted(context.abortSignal);
              let column = -1;
              if (searchRegex) {
                const found = searchRegex.exec(lines[index]);
                searchRegex.lastIndex = 0;
                column = found?.index ?? -1;
              } else {
                column = findLiteralIndex(lines[index], input.query, {
                  caseSensitive,
                  wholeWord
                });
              }

              if (column < 0) continue;
              matches.push({
                path: entry.relativePath,
                line: index + 1,
                column: column + 1,
                text: lines[index].slice(0, 1_000),
                before: lines.slice(
                  Math.max(0, index - contextBefore),
                  index
                ).map((line) => line.slice(0, 1_000)),
                after: lines.slice(
                  index + 1,
                  Math.min(lines.length, index + 1 + contextAfter)
                ).map((line) => line.slice(0, 1_000))
              });
              fileMatches += 1;
              if (fileMatches >= maxMatchesPerFile) break;
              if (matches.length > maxMatches) return false;
            }
            return matches.length <= maxMatches;
          }
        });

        const limitReason = byteLimitReached
          ? "byte_limit"
          : matches.length > maxMatches
            ? "result_limit"
            : traversal.limitReason;
        return {
          root: resolved.root,
          query: input.query,
          regex,
          matches: matches.slice(0, maxMatches),
          truncated: Boolean(limitReason),
          limitReason,
          scannedFiles,
          scannedBytes,
          skippedFiles: skippedFiles + traversal.skippedDirectories
        };
      }
    },
    {
      name: "detect_project",
      title: "Detect project",
      description:
        "Identify common project manifests, lockfiles, package manager, and package scripts without executing code. Symlinked or excluded manifests are ignored.",
      inputSchema: z.object({
        path: pathSchema.default(".")
      }),
      outputSchema: z.object({
        root: z.string(),
        path: z.string(),
        manifests: z.array(z.object({ name: z.string(), type: z.string() })),
        lockfiles: z.array(z.string()),
        package: z.object({
          name: z.string().nullable(),
          version: z.string().nullable(),
          private: z.boolean(),
          scripts: z.array(z.string()),
          packageManager: z.string().nullable()
        }).or(z.object({
          error: z.string(),
          errorCode: z.string()
        })).nullable()
      }),
      timeoutMs: 20_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        throwIfAborted(context.abortSignal);
        const resolved = resolve(input.path, { allowFile: false });
        const manifestNames = [
          "package.json",
          "pyproject.toml",
          "requirements.txt",
          "Cargo.toml",
          "go.mod",
          "CMakeLists.txt",
          "pom.xml",
          "build.gradle",
          "build.gradle.kts"
        ];
        const lockfileNames = [
          "pnpm-lock.yaml",
          "yarn.lock",
          "package-lock.json",
          "bun.lock",
          "bun.lockb",
          "poetry.lock",
          "uv.lock",
          "Cargo.lock",
          "go.sum"
        ];

        const safeFiles = new Map();
        for (const name of [...manifestNames, ...lockfileNames]) {
          throwIfAborted(context.abortSignal);
          try {
            const candidate = resolve(path.join(resolved.path, name), {
              allowDirectory: false
            });
            const stat = await fsp.lstat(candidate.path);
            if (stat.isFile() && !stat.isSymbolicLink()) {
              safeFiles.set(name, candidate.path);
            }
          } catch {
            // Missing, excluded, sensitive, unreadable, and symlinked manifests are omitted.
          }
        }

        const manifests = manifestNames
          .filter((name) => safeFiles.has(name))
          .map((name) => ({ name, type: projectType(name) }));
        const lockfiles = lockfileNames.filter((name) => safeFiles.has(name));

        let packageSummary = null;
        const packagePath = safeFiles.get("package.json");
        if (packagePath) {
          try {
            const file = await readSafeTextFile(
              packagePath,
              limits.maxTextFileBytes,
              { signal: context.abortSignal }
            );
            const data = JSON.parse(file.text);
            const inferredPackageManager = data.packageManager ?? (
              lockfiles.includes("pnpm-lock.yaml") ? "pnpm" :
              lockfiles.includes("yarn.lock") ? "yarn" :
              lockfiles.includes("package-lock.json") ? "npm" :
              lockfiles.some((name) => name.startsWith("bun.lock")) ? "bun" :
              null
            );
            packageSummary = {
              name: typeof data.name === "string" ? data.name : null,
              version: typeof data.version === "string" ? data.version : null,
              private: Boolean(data.private),
              scripts: Object.keys(data.scripts ?? {}).sort().slice(0, 50),
              packageManager: inferredPackageManager
            };
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            packageSummary = {
              error: "package.json 无法安全读取或解析。",
              errorCode: String(error?.code ?? "INVALID_PACKAGE_JSON")
            };
          }
        }

        return {
          root: resolved.root,
          path: resolved.relativePath,
          manifests,
          lockfiles,
          package: packageSummary
        };
      }
    },
    {
      name: "compute_file_hash",
      title: "Compute file hash",
      description:
        "Stream a safe file and compute SHA-256 without loading the whole file into memory. The operation supports cancellation and enforces a byte limit even if the file grows during reading.",
      inputSchema: z.object({
        path: pathSchema.min(1)
      }),
      outputSchema: z.object({
        root: z.string(),
        path: z.string(),
        algorithm: z.literal("sha256"),
        hash: z.string().regex(/^[a-f0-9]{64}$/u),
        sizeBytes: z.number().int(),
        modifiedAt: z.string()
      }),
      timeoutMs: 90_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        const resolved = resolve(input.path, { allowDirectory: false });
        const result = await hashFile(
          resolved.path,
          limits.maxHashFileBytes,
          { signal: context.abortSignal }
        );
        return {
          root: resolved.root,
          path: resolved.relativePath,
          algorithm: "sha256",
          ...result
        };
      }
    }
  ];
}

export function getDefaultWorkspaceRoot(workspaceSettings = {}) {
  return getWorkspaceRoots(workspaceSettings)[0] ?? null;
}
