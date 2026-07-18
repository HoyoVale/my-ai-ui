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

function createRuntimeError(
  code,
  message,
  retryable = false
) {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable
    }
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

function stableSignature(
  name,
  input
) {
  try {
    return `${name}:${JSON.stringify(input)}`;
  } catch {
    return `${name}:${String(input)}`;
  }
}

export class ToolExecutor {
  constructor({
    context = {},
    onRecord = null,
    defaultTimeoutMs = 15000,
    maxToolCalls = 12,
    maxIdenticalCalls = 2,
    runTimeoutMs = 120000
  } = {}) {
    this.context = context;
    this.onRecord = onRecord;
    this.defaultTimeoutMs =
      defaultTimeoutMs;
    this.maxToolCalls =
      maxToolCalls;
    this.maxIdenticalCalls =
      maxIdenticalCalls;
    this.runTimeoutMs =
      runTimeoutMs;
    this.startedAt = Date.now();
    this.callCount = 0;
    this.signatures = new Map();
    this.auditLog =
      new ToolAuditLog();
  }

  emit(record) {
    const normalized =
      this.auditLog.upsert(record);

    this.onRecord?.(normalized);
  }

  rejectBeforeExecution(
    definition,
    input,
    id,
    startedAt
  ) {
    let output = null;

    if (
      this.runTimeoutMs > 0 &&
      startedAt - this.startedAt >
        this.runTimeoutMs
    ) {
      output = createRuntimeError(
        "AGENT_RUN_TIMEOUT",
        "本次 Agent 任务已超过允许的总运行时间。"
      );
    } else if (
      this.callCount >=
      this.maxToolCalls
    ) {
      output = createRuntimeError(
        "TOOL_CALL_LIMIT",
        `本次回复最多允许调用 ${this.maxToolCalls} 次工具。`
      );
    } else {
      const signature =
        stableSignature(
          definition.name,
          input
        );
      const count =
        this.signatures.get(signature) ??
        0;

      if (
        count >=
        this.maxIdenticalCalls
      ) {
        output = createRuntimeError(
          "REPEATED_TOOL_CALL",
          `相同工具和参数已调用 ${count} 次，没有必要继续重复。`
        );
      }
    }

    if (!output) {
      return null;
    }

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

    const rejected =
      this.rejectBeforeExecution(
        definition,
        input,
        id,
        startedAt
      );

    if (rejected) {
      return rejected;
    }

    this.callCount += 1;
    const signature =
      stableSignature(
        definition.name,
        input
      );
    this.signatures.set(
      signature,
      (this.signatures.get(signature) ?? 0) + 1
    );

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
