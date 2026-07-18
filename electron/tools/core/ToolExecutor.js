import {
  tool
} from "ai";

import {
  ToolAuditLog
} from "./ToolAuditLog.js";

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(
    error ??
    "工具执行失败。"
  );
}

function normalizeOutput(output) {
  if (
    output &&
    typeof output === "object" &&
    "ok" in output
  ) {
    return output;
  }

  return {
    ok: true,
    data: output
  };
}

function createTimeoutError(
  timeoutMs
) {
  const error = new Error(
    `工具执行超过 ${Math.round(timeoutMs / 1000)} 秒，已停止等待。`
  );
  error.code = "TOOL_TIMEOUT";
  return error;
}

export class ToolExecutor {
  constructor({
    context = {},
    onRecord = null,
    defaultTimeoutMs = 15000
  } = {}) {
    this.context = context;
    this.onRecord = onRecord;
    this.defaultTimeoutMs =
      defaultTimeoutMs;
    this.auditLog =
      new ToolAuditLog();
  }

  emit(record) {
    const normalized =
      this.auditLog.upsert(record);

    this.onRecord?.(normalized);
  }

  async execute(
    definition,
    input,
    options = {}
  ) {
    const id =
      String(
        options.toolCallId ??
        `${definition.name}-${Date.now()}`
      );

    const startedAt = Date.now();
    const timeoutMs =
      definition.timeoutMs ??
      this.defaultTimeoutMs;

    this.emit({
      id,
      name: definition.name,
      title: definition.title,
      status: "running",
      input,
      durationMs: 0
    });

    let timeoutId = null;

    try {
      const execution =
        Promise.resolve(
          definition.execute(
            input,
            {
              ...this.context,
              toolCallId: id,
              abortSignal:
                options.abortSignal ??
                this.context.abortSignal
            }
          )
        );

      const timed =
        timeoutMs > 0
          ? Promise.race([
              execution,
              new Promise(
                (_resolve, reject) => {
                  timeoutId = setTimeout(
                    () => {
                      reject(
                        createTimeoutError(
                          timeoutMs
                        )
                      );
                    },
                    timeoutMs
                  );
                }
              )
            ])
          : execution;

      const output =
        normalizeOutput(
          await timed
        );

      const record = {
        id,
        name: definition.name,
        title: definition.title,
        status:
          output.ok === false
            ? "error"
            : "complete",
        input,
        output,
        durationMs:
          Math.max(
            1,
            Date.now() -
            startedAt
          )
      };

      this.emit(record);

      return output;
    } catch (error) {
      const output = {
        ok: false,
        error: {
          code:
            error?.code ??
            "TOOL_EXECUTION_FAILED",
          message:
            errorMessage(error),
          retryable:
            error?.code ===
            "TOOL_TIMEOUT"
        }
      };

      this.emit({
        id,
        name: definition.name,
        title: definition.title,
        status: "error",
        input,
        output,
        durationMs:
          Math.max(
            1,
            Date.now() -
            startedAt
          )
      });

      return output;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  buildToolSet(definitions) {
    return Object.fromEntries(
      definitions.map(
        (definition) => [
          definition.name,
          tool({
            description:
              definition.description,
            inputSchema:
              definition.inputSchema,
            strict:
              definition.strict ??
              false,
            execute:
              (input, options) =>
                this.execute(
                  definition,
                  input,
                  options
                )
          })
        ]
      )
    );
  }

  getRecords() {
    return this.auditLog.list();
  }
}
