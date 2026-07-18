import { tool } from "ai";

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

function createTimeoutError(timeoutMs) {
  const error = new Error(
    `工具执行超过 ${Math.round(timeoutMs / 1000)} 秒，已停止等待。`
  );
  error.code = "TOOL_TIMEOUT";
  return error;
}

function stableSignature(name, input) {
  try {
    return `${name}:${JSON.stringify(input)}`;
  } catch {
    return `${name}:${String(input)}`;
  }
}

function isCancelled(
  error,
  abortSignal
) {
  return Boolean(
    abortSignal?.aborted ||
    error?.name === "AbortError" ||
    error?.code === "ABORT_ERR" ||
    error?.code === "CANCELLED_BY_USER"
  );
}

export class ToolExecutor {
  constructor({
    context = {},
    onRecord = null,
    defaultTimeoutMs = 15000,
    maxToolCalls = 12,
    maxIdenticalCalls = 2,
    runTimeoutMs = 120000,
    resultStore = null
  } = {}) {
    this.context = context;
    this.onRecord = onRecord;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.maxToolCalls = maxToolCalls;
    this.maxIdenticalCalls = maxIdenticalCalls;
    this.runTimeoutMs = runTimeoutMs;
    this.resultStore = resultStore;
    this.startedAt = Date.now();
    this.callCount = 0;
    this.signatures = new Map();
    this.auditLog = new ToolAuditLog();
  }

  emit(record) {
    const merged = this.auditLog.upsert(record);
    this.onRecord?.(merged);
    return merged;
  }

  captureFailure(output, options = {}) {
    if (this.resultStore) {
      return this.resultStore.captureFailure(
        output,
        options
      );
    }

    return {
      value: output,
      result: {
        status: options.cancelled
          ? "cancelled"
          : "error",
        summary:
          output?.error?.message ??
          "工具执行失败。",
        preview: "",
        error: output?.error,
        truncated: false,
        originalBytes: 0,
        storedBytes: 0,
        clipped: false
      },
      meta: {
        outputBytes: 0,
        storedBytes: 0,
        truncated: false,
        clipped: false
      }
    };
  }

  rejectBeforeExecution(
    definition,
    input,
    id,
    queuedAt
  ) {
    let output = null;

    if (
      this.runTimeoutMs > 0 &&
      queuedAt - this.startedAt >
        this.runTimeoutMs
    ) {
      output = createRuntimeError(
        "AGENT_RUN_TIMEOUT",
        "本次 Agent 任务已超过允许的总运行时间。"
      );
    } else if (
      definition.countsTowardLimit !== false &&
      this.callCount >=
      this.maxToolCalls
    ) {
      output = createRuntimeError(
        "TOOL_CALL_LIMIT",
        `本次回复最多允许调用 ${this.maxToolCalls} 次工具。`
      );
    } else {
      const planPermission =
        this.context.planStore
          ?.canRunTool?.(
            definition.name,
            input
          );

      if (
        planPermission &&
        planPermission.ok === false
      ) {
        output = createRuntimeError(
          planPermission.code,
          planPermission.message,
          planPermission.retryable === true
        );
      } else if (definition.countsTowardLimit !== false) {
        const signature = stableSignature(
          definition.name,
          input
        );
        const count =
          this.signatures.get(signature) ?? 0;

        if (
          count >= this.maxIdenticalCalls
        ) {
          output = createRuntimeError(
            "REPEATED_TOOL_CALL",
            `相同工具和参数已调用 ${count} 次，没有必要继续重复。`
          );
        }
      }
    }

    if (!output) {
      return null;
    }

    const endedAt = Date.now();
    const batch =
      this.context.getActiveBatch
        ?.() ?? null;
    const captured = this.captureFailure(
      output,
      {
        toolName: definition.name
      }
    );

    this.emit({
      id,
      name: definition.name,
      title: definition.title,
      status: "failed",
      batch,
      input,
      output: captured.value,
      result: captured.result,
      meta: captured.meta,
      queuedAt,
      startedAt: null,
      endedAt,
      durationMs: Math.max(
        1,
        endedAt - queuedAt
      )
    });

    return output;
  }

  async execute(
    definition,
    input,
    options = {}
  ) {
    const id = String(
      options.toolCallId ??
      `${definition.name}-${Date.now()}`
    );
    const queuedAt = Date.now();
    const planStep =
      this.context.planStore
        ?.getExecutionState?.()
        ?.active ?? null;
    const batch =
      this.context.getActiveBatch
        ?.() ?? null;
    const timeoutMs =
      definition.timeoutMs ??
      this.defaultTimeoutMs;
    const abortSignal =
      options.abortSignal ??
      this.context.abortSignal;

    this.emit({
      id,
      name: definition.name,
      title: definition.title,
      status: "queued",
      batch,
      planStep:
        planStep
          ? {
              id: planStep.id,
              title: planStep.title
            }
          : null,
      input,
      queuedAt,
      startedAt: null,
      endedAt: null,
      durationMs: 0
    });

    const rejected = this.rejectBeforeExecution(
      definition,
      input,
      id,
      queuedAt
    );

    if (rejected) {
      return rejected;
    }

    if (definition.countsTowardLimit !== false) {
      this.callCount += 1;
      const signature = stableSignature(
        definition.name,
        input
      );
      this.signatures.set(
        signature,
        (this.signatures.get(signature) ?? 0) + 1
      );
    }

    const startedAt = Date.now();

    this.emit({
      id,
      name: definition.name,
      title: definition.title,
      status: "running",
      batch,
      planStep:
        planStep
          ? {
              id: planStep.id,
              title: planStep.title
            }
          : null,
      input,
      queuedAt,
      startedAt,
      endedAt: null,
      durationMs: 0
    });

    let timeoutId = null;

    try {
      const execution = Promise.resolve(
        definition.execute(
          input,
          {
            ...this.context,
            toolCallId: id,
            abortSignal
          }
        )
      );

      const timed = timeoutMs > 0
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

      const normalizedOutput = normalizeOutput(
        await timed
      );

      const captured =
        normalizedOutput.ok === false
          ? this.captureFailure(
              normalizedOutput,
              {
                toolName: definition.name
              }
            )
          : this.resultStore
            ? this.resultStore.capture(
                normalizedOutput,
                {
                  toolName: definition.name
                }
              )
            : {
                value: normalizedOutput,
                result: {
                  status: "success",
                  summary:
                    `${definition.title ?? definition.name}执行完成`,
                  preview: "",
                  data: normalizedOutput,
                  truncated: false,
                  originalBytes: 0,
                  storedBytes: 0,
                  clipped: false
                },
                meta: {
                  outputBytes: 0,
                  storedBytes: 0,
                  truncated: false,
                  clipped: false
                }
              };

      const output = captured.value;
      const endedAt = Date.now();
      const status = output.ok === false
        ? "failed"
        : "completed";

      if (status === "completed") {
        this.context.planStore
          ?.noteToolExecution?.(
            definition.name
          );
      }

      this.emit({
        id,
        name: definition.name,
        title: definition.title,
        status,
        batch,
        planStep:
          planStep
            ? {
                id: planStep.id,
                title: planStep.title
              }
            : null,
        input,
        output,
        result: captured.result,
        meta: captured.meta,
        queuedAt,
        startedAt,
        endedAt,
        durationMs: Math.max(
          1,
          endedAt - startedAt
        )
      });

      return output;
    } catch (error) {
      const cancelled = isCancelled(
        error,
        abortSignal
      );
      const output = {
        ok: false,
        error: {
          code: cancelled
            ? "CANCELLED_BY_USER"
            : error?.code ??
              "TOOL_EXECUTION_FAILED",
          message: cancelled
            ? "工具调用已由用户取消。"
            : errorMessage(error),
          retryable:
            !cancelled &&
            error?.code ===
              "TOOL_TIMEOUT"
        }
      };
      const captured = this.captureFailure(
        output,
        {
          toolName: definition.name,
          cancelled
        }
      );
      const endedAt = Date.now();

      this.emit({
        id,
        name: definition.name,
        title: definition.title,
        batch,
        status: cancelled
          ? "cancelled"
          : "failed",
        planStep:
          planStep
            ? {
                id: planStep.id,
                title: planStep.title
              }
            : null,
        input,
        output: captured.value,
        result: captured.result,
        meta: captured.meta,
        queuedAt,
        startedAt,
        endedAt,
        durationMs: Math.max(
          1,
          endedAt - startedAt
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
      definitions.map((definition) => [
        definition.name,
        tool({
          description: definition.description,
          inputSchema: definition.inputSchema,
          strict: definition.strict ?? false,
          execute: (input, options) =>
            this.execute(
              definition,
              input,
              options
            )
        })
      ])
    );
  }

  getRecords() {
    return this.auditLog.list();
  }

  getCallCount() {
    return this.callCount;
  }
}
