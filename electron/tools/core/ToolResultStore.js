import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  redactSensitiveValue
} from "./redaction.js";

function clone(value) {
  return structuredClone(value);
}

export {
  redactSensitiveValue as redactSensitiveResult
};

function serialize(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function byteLength(value) {
  return Buffer.byteLength(
    String(value ?? ""),
    "utf8"
  );
}

function sliceUtf8(value, maxBytes) {
  const buffer = Buffer.from(
    String(value ?? ""),
    "utf8"
  );

  if (buffer.byteLength <= maxBytes) {
    return buffer.toString("utf8");
  }

  return buffer
    .subarray(0, maxBytes)
    .toString("utf8");
}

function firstUsefulMessage(value) {
  const candidates = [
    value?.message,
    value?.data?.message,
    value?.error?.message
  ];

  return candidates.find(
    (candidate) =>
      typeof candidate === "string" &&
      candidate.trim()
  )?.trim() ?? "";
}

function summarizeValue(value, toolName) {
  const message = firstUsefulMessage(value);

  if (message) {
    return message.slice(0, 240);
  }

  const data = value?.data;

  if (data?.changePreview?.diff) {
    const paths = data.changePreview.paths?.length
      ? data.changePreview.paths
      : data.changePreview.path ? [data.changePreview.path] : [];
    const added = Math.max(0, Number(data.addedLines) || 0);
    const removed = Math.max(0, Number(data.removedLines) || 0);
    return `已修改 ${paths.length > 1 ? `${paths.length} 个文件` : paths[0] || "文件"}${added || removed ? `（+${added} / -${removed}）` : ""}`;
  }

  if (Array.isArray(data)) {
    return `返回 ${data.length} 个结果`;
  }

  if (Array.isArray(data?.items)) {
    return `返回 ${data.items.length} 个项目`;
  }

  if (typeof data?.content === "string") {
    return `返回 ${data.content.length} 个字符`;
  }

  if (typeof data?.text === "string") {
    return `返回 ${data.text.length} 个字符`;
  }

  return `${toolName || "工具"}执行完成`;
}

function commandPreviewFromValue(value) {
  const data = value?.data;
  if (!data || typeof data !== "object" || !data.displayCommand) return undefined;
  return {
    displayCommand: String(data.displayCommand).slice(0, 1200),
    command: String(data.command ?? "").slice(0, 500),
    args: Array.isArray(data.args) ? data.args.map(String).slice(0, 64) : [],
    cwd: String(data.cwd ?? "").slice(0, 500),
    kind: String(data.kind ?? "process").slice(0, 80),
    script: String(data.script ?? "").slice(0, 120),
    exitCode: data.exitCode === null ? null : Number(data.exitCode),
    durationMs: Math.max(0, Number(data.durationMs) || 0),
    stdout: String(data.stdout ?? "").slice(0, 24000),
    stderr: String(data.stderr ?? "").slice(0, 12000),
    stdoutTruncated: data.stdoutTruncated === true,
    stderrTruncated: data.stderrTruncated === true,
    terminated: data.terminated === true,
    terminationReason: String(data.terminationReason ?? "").slice(0, 120)
  };
}

function createResultEnvelope({
  status,
  summary,
  preview,
  data,
  error,
  changePreview,
  commandPreview,
  resultId = "",
  truncated = false,
  originalBytes = 0,
  storedBytes = 0,
  clipped = false
}) {
  const result = {
    status,
    summary: String(summary ?? "").slice(0, 400),
    preview: String(preview ?? "").slice(0, 2400),
    truncated: Boolean(truncated),
    originalBytes: Math.max(0, Number(originalBytes) || 0),
    storedBytes: Math.max(0, Number(storedBytes) || 0),
    clipped: Boolean(clipped)
  };

  if (data !== undefined) {
    result.data = clone(data);
  }

  if (changePreview !== undefined) {
    result.changePreview = clone(changePreview);
  }

  if (commandPreview !== undefined) {
    result.commandPreview = clone(commandPreview);
  }

  if (error !== undefined) {
    result.error = clone(error);
  }

  if (resultId) {
    result.reference = {
      type: "tool_result",
      resultId: String(resultId)
    };
  }

  return result;
}

function safeResultId(value) {
  const id = String(value ?? "").trim();
  return /^[a-zA-Z0-9_-]{8,128}$/.test(id)
    ? id
    : "";
}

function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), "utf8");
  fs.renameSync(temporary, filePath);
}

export class ToolResultStore {
  constructor({
    maxInlineBytes = 24000,
    maxStoredBytes = 200000,
    defaultChunkCharacters = 8000,
    maxPreviewCharacters = 1800,
    storageDirectory = "",
    retentionMs = 7 * 24 * 60 * 60 * 1000,
    maxPersistedEntries = 256,
    maxPersistedBytes = 64 * 1024 * 1024,
    taskId = "",
    workspaceId = "",
    segmentId = "",
    redact = null
  } = {}) {
    this.maxInlineBytes = Math.max(
      2000,
      maxInlineBytes
    );
    this.maxStoredBytes = Math.max(
      this.maxInlineBytes,
      maxStoredBytes
    );
    this.defaultChunkCharacters = Math.max(
      500,
      defaultChunkCharacters
    );
    this.maxPreviewCharacters = Math.max(
      400,
      maxPreviewCharacters
    );
    this.storageDirectory =
      String(storageDirectory ?? "").trim();
    this.retentionMs = Math.max(
      60 * 60 * 1000,
      Number(retentionMs) ||
        7 * 24 * 60 * 60 * 1000
    );
    this.maxPersistedEntries = Math.max(
      1,
      Number(maxPersistedEntries) || 256
    );
    this.maxPersistedBytes = Math.max(
      this.maxStoredBytes,
      Number(maxPersistedBytes) ||
        64 * 1024 * 1024
    );
    this.owner = {
      taskId: String(taskId ?? ""),
      workspaceId: String(workspaceId ?? ""),
      segmentId: String(segmentId ?? "")
    };
    this.redact =
      typeof redact === "function"
        ? redact
        : redactSensitiveValue;
    this.entries = new Map();

    if (this.storageDirectory) {
      this.cleanupExpired();
      this.enforceQuota();
    }
  }

  entryPath(resultId) {
    const id = safeResultId(resultId);

    if (!id || !this.storageDirectory) {
      return "";
    }

    return path.join(
      this.storageDirectory,
      `${id}.json`
    );
  }

  persistEntry(entry) {
    const filePath = this.entryPath(entry?.id);

    if (!filePath) {
      return;
    }

    try {
      atomicWriteJson(filePath, entry);
    } catch (error) {
      console.warn(
        "无法持久化工具结果引用：",
        error
      );
    }
  }

  loadEntry(resultId) {
    const id = safeResultId(resultId);

    if (!id) {
      return null;
    }

    const memoryEntry = this.entries.get(id);

    if (memoryEntry) {
      return this.isOwnedByStore(memoryEntry)
        ? memoryEntry
        : null;
    }

    const filePath = this.entryPath(id);

    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        fs.readFileSync(filePath, "utf8")
      );

      if (
        parsed?.id !== id ||
        typeof parsed?.text !== "string" ||
        !this.isOwnedByStore(parsed)
      ) {
        return null;
      }

      this.entries.set(id, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  isOwnedByStore(entry) {
    const owner = entry?.owner ?? {};
    const matches = (expected, actual) =>
      !expected || String(actual ?? "") === expected;

    return (
      matches(
        this.owner.taskId,
        owner.taskId
      ) &&
      matches(
        this.owner.workspaceId,
        owner.workspaceId
      ) &&
      matches(
        this.owner.segmentId,
        owner.segmentId
      )
    );
  }

  cleanupExpired(now = Date.now()) {
    if (
      !this.storageDirectory ||
      !fs.existsSync(this.storageDirectory)
    ) {
      return 0;
    }

    let removed = 0;

    for (const name of fs.readdirSync(this.storageDirectory)) {
      if (!name.endsWith(".json")) {
        continue;
      }

      const filePath = path.join(this.storageDirectory, name);

      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > this.retentionMs) {
          fs.rmSync(filePath, { force: true });
          removed += 1;
        }
      } catch {
        // Ignore files concurrently removed by another run.
      }
    }

    return removed;
  }

  enforceQuota() {
    if (
      !this.storageDirectory ||
      !fs.existsSync(this.storageDirectory)
    ) {
      return 0;
    }

    const files = [];

    for (const name of fs.readdirSync(this.storageDirectory)) {
      if (!name.endsWith(".json")) {
        continue;
      }

      const filePath = path.join(this.storageDirectory, name);

      try {
        const stat = fs.statSync(filePath);
        files.push({
          filePath,
          resultId: name.slice(0, -5),
          size: stat.size,
          modifiedAt: stat.mtimeMs
        });
      } catch {
        // Ignore files concurrently removed by another run.
      }
    }

    files.sort((left, right) =>
      left.modifiedAt - right.modifiedAt
    );

    let totalBytes = files.reduce(
      (sum, file) => sum + file.size,
      0
    );
    let remaining = files.length;
    let removed = 0;

    for (const file of files) {
      if (
        remaining <= this.maxPersistedEntries &&
        totalBytes <= this.maxPersistedBytes
      ) {
        break;
      }

      try {
        fs.rmSync(file.filePath, { force: true });
        this.entries.delete(file.resultId);
        totalBytes -= file.size;
        remaining -= 1;
        removed += 1;
      } catch {
        // Quota cleanup is best-effort and must not fail a Tool call.
      }
    }

    return removed;
  }

  capture(
    value,
    {
      toolName = "tool",
      callId = "",
      taskId = this.owner.taskId,
      workspaceId = this.owner.workspaceId,
      segmentId = this.owner.segmentId
    } = {}
  ) {
    const safeValue = this.redact(clone(value));
    const serialized = serialize(safeValue);
    const totalBytes = byteLength(serialized);
    const changePreview = safeValue?.data?.changePreview;
    const commandPreview = commandPreviewFromValue(safeValue);
    const summary = summarizeValue(
      safeValue,
      toolName
    );
    const preview = serialized.slice(
      0,
      this.maxPreviewCharacters
    );

    if (totalBytes <= this.maxInlineBytes) {
      const result = createResultEnvelope({
        status: "success",
        summary,
        preview,
        data: safeValue,
        changePreview,
        commandPreview,
        truncated: false,
        originalBytes: totalBytes,
        storedBytes: totalBytes
      });

      return {
        value: clone(safeValue),
        result,
        meta: {
          outputBytes: totalBytes,
          storedBytes: totalBytes,
          truncated: false,
          clipped: false
        }
      };
    }

    const resultId = crypto.randomUUID();
    const storedText = sliceUtf8(
      serialized,
      this.maxStoredBytes
    );
    const storedBytes = byteLength(storedText);
    const clipped = storedBytes < totalBytes;

    const entry = {
      id: resultId,
      toolName,
      callId: String(callId ?? ""),
      owner: {
        taskId: String(taskId ?? ""),
        workspaceId: String(workspaceId ?? ""),
        segmentId: String(segmentId ?? "")
      },
      text: storedText,
      totalBytes,
      storedBytes,
      clipped,
      createdAt: Date.now()
    };

    this.entries.set(resultId, entry);
    this.persistEntry(entry);
    this.enforceQuota();

    const compactValue = {
      ok: safeValue?.ok === false ? false : true,
      data: {
        resultId,
        preview,
        message:
          "工具结果较大，已保存为分页结果。需要更多内容时调用 read_tool_result。"
      },
      meta: {
        resultId,
        truncated: true,
        totalBytes,
        storedBytes,
        clipped
      }
    };

    return {
      value: compactValue,
      result: createResultEnvelope({
        status: "success",
        summary,
        preview,
        changePreview,
        commandPreview,
        resultId,
        truncated: true,
        originalBytes: totalBytes,
        storedBytes,
        clipped
      }),
      meta: {
        resultId,
        outputBytes: totalBytes,
        storedBytes,
        truncated: true,
        clipped
      }
    };
  }

  captureFailure(
    value,
    {
      toolName = "tool",
      cancelled = false,
      callId = "",
      taskId = this.owner.taskId,
      segmentId = this.owner.segmentId
    } = {}
  ) {
    const safeValue = this.redact(clone(value));
    const serialized = serialize(safeValue);
    const totalBytes = byteLength(serialized);
    const error = safeValue?.error ?? {
      code: cancelled
        ? "CANCELLED_BY_USER"
        : "TOOL_EXECUTION_FAILED",
      message: firstUsefulMessage(value) ||
        "工具执行失败。",
      retryable: false
    };

    return {
      value: clone(safeValue),
      result: createResultEnvelope({
        status: cancelled
          ? "cancelled"
          : "error",
        summary:
          error.message ||
          `${toolName}执行失败`,
        preview: serialized,
        error,
        truncated:
          totalBytes > this.maxInlineBytes,
        originalBytes: totalBytes,
        storedBytes: Math.min(
          totalBytes,
          this.maxInlineBytes
        ),
        clipped:
          totalBytes > this.maxInlineBytes
      }),
      meta: {
        callId: String(callId ?? ""),
        taskId: String(taskId ?? ""),
        segmentId: String(segmentId ?? ""),
        outputBytes: totalBytes,
        storedBytes: Math.min(
          totalBytes,
          this.maxInlineBytes
        ),
        truncated:
          totalBytes > this.maxInlineBytes,
        clipped:
          totalBytes > this.maxInlineBytes
      }
    };
  }

  read(
    resultId,
    {
      offset = 0,
      limit = this.defaultChunkCharacters,
      taskId = this.owner.taskId,
      segmentId = this.owner.segmentId
    } = {}
  ) {
    const entry = this.loadEntry(
      resultId
    );

    if (
      !entry ||
      (
        taskId &&
        String(entry.owner?.taskId ?? "") !== String(taskId)
      ) ||
      (
        segmentId &&
        String(entry.owner?.segmentId ?? "") !== String(segmentId)
      )
    ) {
      return {
        ok: false,
        error: {
          code: "TOOL_RESULT_NOT_FOUND",
          message:
            "找不到该工具结果，结果可能已过期或属于其他任务。",
          retryable: false
        }
      };
    }

    const start = Math.max(
      0,
      Math.round(Number(offset) || 0)
    );
    const size = Math.max(
      500,
      Math.min(
        12000,
        Math.round(
          Number(limit) ||
          this.defaultChunkCharacters
        )
      )
    );
    const content = entry.text.slice(
      start,
      start + size
    );
    const nextOffset = start + content.length;

    return {
      ok: true,
      data: {
        resultId: entry.id,
        toolName: entry.toolName,
        callId: entry.callId ?? "",
        content,
        offset: start,
        nextOffset:
          nextOffset < entry.text.length
            ? nextOffset
            : null,
        hasMore:
          nextOffset < entry.text.length
      },
      meta: {
        totalCharacters: entry.text.length,
        totalBytes: entry.totalBytes,
        storedBytes: entry.storedBytes,
        clipped: entry.clipped
      }
    };
  }

  list() {
    return [...this.entries.values()]
      .filter((entry) =>
        this.isOwnedByStore(entry)
      )
      .map((entry) => ({
        id: entry.id,
        toolName: entry.toolName,
        totalBytes: entry.totalBytes,
        storedBytes: entry.storedBytes,
        clipped: entry.clipped,
        createdAt: entry.createdAt
      }));
  }
}
