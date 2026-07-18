import crypto from "node:crypto";

function clone(value) {
  return structuredClone(value);
}

function serialize(value) {
  try {
    return JSON.stringify(
      value,
      null,
      2
    );
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

function sliceUtf8(
  value,
  maxBytes
) {
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

export class ToolResultStore {
  constructor({
    maxInlineBytes = 24000,
    maxStoredBytes = 200000,
    defaultChunkCharacters = 8000
  } = {}) {
    this.maxInlineBytes =
      Math.max(2000, maxInlineBytes);
    this.maxStoredBytes =
      Math.max(
        this.maxInlineBytes,
        maxStoredBytes
      );
    this.defaultChunkCharacters =
      Math.max(
        500,
        defaultChunkCharacters
      );
    this.entries = new Map();
  }

  capture(
    value,
    {
      toolName = "tool"
    } = {}
  ) {
    const serialized =
      serialize(value);
    const totalBytes =
      byteLength(serialized);

    if (
      totalBytes <=
      this.maxInlineBytes
    ) {
      return {
        value: clone(value),
        meta: {
          outputBytes:
            totalBytes,
          truncated: false
        }
      };
    }

    const resultId =
      crypto.randomUUID();
    const storedText =
      sliceUtf8(
        serialized,
        this.maxStoredBytes
      );
    const storedBytes =
      byteLength(storedText);
    const preview =
      storedText.slice(0, 1800);

    this.entries.set(
      resultId,
      {
        id: resultId,
        toolName,
        text: storedText,
        totalBytes,
        storedBytes,
        clipped:
          storedBytes < totalBytes,
        createdAt: Date.now()
      }
    );

    return {
      value: {
        ok:
          value?.ok === false
            ? false
            : true,
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
          clipped:
            storedBytes < totalBytes
        }
      },
      meta: {
        resultId,
        outputBytes:
          totalBytes,
        storedBytes,
        truncated: true,
        clipped:
          storedBytes < totalBytes
      }
    };
  }

  read(
    resultId,
    {
      offset = 0,
      limit =
        this.defaultChunkCharacters
    } = {}
  ) {
    const entry =
      this.entries.get(
        String(resultId ?? "")
      );

    if (!entry) {
      return {
        ok: false,
        error: {
          code:
            "TOOL_RESULT_NOT_FOUND",
          message:
            "找不到该工具结果，结果可能已过期或属于其他 Agent Run。",
          retryable: false
        }
      };
    }

    const start = Math.max(
      0,
      Math.round(
        Number(offset) || 0
      )
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
    const content =
      entry.text.slice(
        start,
        start + size
      );
    const nextOffset =
      start + content.length;

    return {
      ok: true,
      data: {
        resultId:
          entry.id,
        toolName:
          entry.toolName,
        content,
        offset: start,
        nextOffset:
          nextOffset <
          entry.text.length
            ? nextOffset
            : null,
        hasMore:
          nextOffset <
          entry.text.length
      },
      meta: {
        totalCharacters:
          entry.text.length,
        totalBytes:
          entry.totalBytes,
        storedBytes:
          entry.storedBytes,
        clipped:
          entry.clipped
      }
    };
  }

  list() {
    return [...this.entries.values()]
      .map((entry) => ({
        id: entry.id,
        toolName:
          entry.toolName,
        totalBytes:
          entry.totalBytes,
        storedBytes:
          entry.storedBytes,
        clipped:
          entry.clipped,
        createdAt:
          entry.createdAt
      }));
  }
}
