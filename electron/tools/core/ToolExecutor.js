import { tool } from "ai";

import {
  ToolAuditLog
} from "./ToolAuditLog.js";

import {
  TOOL_ERROR_TYPES,
  classifyToolError,
  shouldRetryToolError
} from "./toolErrors.js";

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
  retryable = false,
  type = ""
) {
  return {
    ok: false,
    error: {
      code,
      type,
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

function createAbortError(reason = "user-stop") {
  const error = new Error(
    reason === "user-stop"
      ? "工具调用已由用户取消。"
      : "工具调用已取消。"
  );
  error.name = "AbortError";
  error.code = "CANCELLED_BY_USER";
  return error;
}

function stableSignature(name, input) {
  try {
    return `${name}:${JSON.stringify(input)}`;
  } catch {
    return `${name}:${String(input)}`;
  }
}

function wait(ms, abortSignal) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      abortSignal?.removeEventListener(
        "abort",
        onAbort
      );
    };

    const onAbort = () => {
      cleanup();
      reject(
        createAbortError(
          abortSignal?.reason
        )
      );
    };

    timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    if (abortSignal?.aborted) {
      onAbort();
      return;
    }

    abortSignal?.addEventListener(
      "abort",
      onAbort,
      { once: true }
    );
  });
}

function runWithAbortAndTimeout(
  execution,
  {
    abortSignal = null,
    timeoutMs = 0
  } = {}
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      abortSignal?.removeEventListener(
        "abort",
        onAbort
      );
    };

    const settle = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback(value);
    };

    const onAbort = () => {
      settle(
        reject,
        createAbortError(
          abortSignal?.reason
        )
      );
    };

    if (abortSignal?.aborted) {
      onAbort();
      return;
    }

    abortSignal?.addEventListener(
      "abort",
      onAbort,
      { once: true }
    );

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        settle(
          reject,
          createTimeoutError(timeoutMs)
        );
      }, timeoutMs);
    }

    Promise.resolve(execution).then(
      (value) => settle(resolve, value),
      (error) => settle(reject, error)
    );
  });
}

function normalizedPolicy(
  definition,
  maxRetries
) {
  const policy =
    definition.retryPolicy ?? {};
  const configuredAttempts =
    Math.max(
      1,
      Number(policy.maxAttempts) || 1
    );
  const runtimeAttempts =
    Math.max(
      1,
      Number(maxRetries) + 1
    );

  return {
    ...policy,
    maxAttempts: Math.min(
      configuredAttempts,
      runtimeAttempts
    ),
    retryOn: Array.isArray(
      policy.retryOn
    )
      ? policy.retryOn
      : [],
    backoffMs: Math.max(
      0,
      Number(policy.backoffMs) || 0
    )
  };
}

export class ToolExecutor {
  constructor({
    context = {},
    onRecord = null,
    defaultTimeoutMs = 15000,
    maxToolCalls = 12,
    maxIdenticalCalls = 2,
    runTimeoutMs = 120000,
    resultStore = null,
    maxRetries = 1
  } = {}) {
    this.context = context;
    this.onRecord = onRecord;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.maxToolCalls = maxToolCalls;
    this.maxIdenticalCalls = maxIdenticalCalls;
    this.runTimeoutMs = runTimeoutMs;
    this.resultStore = resultStore;
    this.maxRetries = Math.max(
      0,
      Math.min(
        2,
        Number(maxRetries) || 0
      )
    );
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
      this.context.abortSignal
        ?.aborted
    ) {
      output = createRuntimeError(
        "CANCELLED_BY_USER",
        "工具调用已由用户取消。",
        false,
        TOOL_ERROR_TYPES.CANCELLED
      );
    } else if (
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
          planPermission.retryable === true,
          TOOL_ERROR_TYPES
            .INVALID_ARGUMENTS
        );
      } else if (
        definition.countsTowardLimit !== false
      ) {
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
        toolName: definition.name,
        cancelled:
          output.error?.type ===
          TOOL_ERROR_TYPES.CANCELLED
      }
    );

    this.emit({
      id,
      name: definition.name,
      title: definition.title,
      source: definition.source,
      riskLevel:
        definition.riskLevel,
      sideEffect:
        definition.sideEffect,
      status:
        output.error?.type ===
        TOOL_ERROR_TYPES.CANCELLED
          ? "cancelled"
          : "failed",
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
      ),
      attempt: 0,
      maxAttempts: 0
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
    const retryPolicy =
      normalizedPolicy(
        definition,
        this.maxRetries
      );

    const baseRecord = {
      id,
      name: definition.name,
      title: definition.title,
      source: definition.source,
      riskLevel:
        definition.riskLevel,
      sideEffect:
        definition.sideEffect,
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
      durationMs: 0,
      attempt: 0,
      maxAttempts:
        retryPolicy.maxAttempts
    };

    this.emit({
      ...baseRecord,
      status: "queued"
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

    if (
      definition.countsTowardLimit !== false
    ) {
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
    let lastFailure = null;

    for (
      let attempt = 1;
      attempt <= retryPolicy.maxAttempts;
      attempt += 1
    ) {
      this.emit({
        ...baseRecord,
        status: "running",
        startedAt,
        attempt,
        maxAttempts:
          retryPolicy.maxAttempts,
        lastError:
          lastFailure
      });

      try {
        const execution =
          definition.execute(
            input,
            {
              ...this.context,
              toolCallId: id,
              abortSignal,
              attempt,
              maxAttempts:
                retryPolicy.maxAttempts,
              definition
            }
          );
        const normalizedOutput =
          normalizeOutput(
            await runWithAbortAndTimeout(
              execution,
              {
                abortSignal,
                timeoutMs
              }
            )
          );

        if (normalizedOutput.ok === false) {
          const classified =
            classifyToolError(
              normalizedOutput,
              {
                abortSignal,
                retryable:
                  normalizedOutput
                    .error
                    ?.retryable
              }
            );
          const output = {
            ...normalizedOutput,
            error: {
              ...normalizedOutput.error,
              code:
                classified.code,
              type:
                classified.type,
              message:
                classified.message,
              retryable:
                classified.retryable
            }
          };

          if (
            shouldRetryToolError(
              classified,
              retryPolicy,
              attempt
            )
          ) {
            lastFailure =
              output.error;
            this.emit({
              ...baseRecord,
              status: "retrying",
              startedAt,
              attempt,
              maxAttempts:
                retryPolicy.maxAttempts,
              lastError:
                output.error,
              durationMs: Math.max(
                1,
                Date.now() - startedAt
              )
            });
            await wait(
              retryPolicy.backoffMs *
                attempt,
              abortSignal
            );
            continue;
          }

          const captured =
            this.captureFailure(
              output,
              {
                toolName:
                  definition.name,
                cancelled:
                  classified.type ===
                  TOOL_ERROR_TYPES
                    .CANCELLED
              }
            );
          const endedAt = Date.now();

          this.emit({
            ...baseRecord,
            status:
              classified.type ===
              TOOL_ERROR_TYPES
                .CANCELLED
                ? "cancelled"
                : "failed",
            output: captured.value,
            result: captured.result,
            meta: captured.meta,
            startedAt,
            endedAt,
            durationMs: Math.max(
              1,
              endedAt - startedAt
            ),
            attempt,
            maxAttempts:
              retryPolicy.maxAttempts,
            lastError:
              output.error
          });

          return output;
        }

        const captured =
          this.resultStore
            ? this.resultStore.capture(
                normalizedOutput,
                {
                  toolName:
                    definition.name
                }
              )
            : {
                value:
                  normalizedOutput,
                result: {
                  status: "success",
                  summary:
                    `${definition.title ?? definition.name}执行完成`,
                  preview: "",
                  data:
                    normalizedOutput,
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
        const endedAt = Date.now();

        this.context.planStore
          ?.noteToolExecution?.(
            definition.name
          );

        this.emit({
          ...baseRecord,
          status: "completed",
          output: captured.value,
          result: captured.result,
          meta: captured.meta,
          startedAt,
          endedAt,
          durationMs: Math.max(
            1,
            endedAt - startedAt
          ),
          attempt,
          maxAttempts:
            retryPolicy.maxAttempts,
          lastError:
            lastFailure
        });

        return captured.value;
      } catch (error) {
        const classified =
          classifyToolError(
            error,
            { abortSignal }
          );
        const cancelled =
          classified.type ===
          TOOL_ERROR_TYPES.CANCELLED;
        const output = {
          ok: false,
          error: {
            code:
              classified.code,
            type:
              classified.type,
            message: cancelled
              ? "工具调用已由用户取消。"
              : errorMessage(error),
            retryable:
              classified.retryable
          }
        };

        if (
          shouldRetryToolError(
            classified,
            retryPolicy,
            attempt
          )
        ) {
          lastFailure = output.error;
          this.emit({
            ...baseRecord,
            status: "retrying",
            startedAt,
            attempt,
            maxAttempts:
              retryPolicy.maxAttempts,
            lastError:
              output.error,
            durationMs: Math.max(
              1,
              Date.now() - startedAt
            )
          });
          await wait(
            retryPolicy.backoffMs *
              attempt,
            abortSignal
          );
          continue;
        }

        const captured =
          this.captureFailure(
            output,
            {
              toolName:
                definition.name,
              cancelled
            }
          );
        const endedAt = Date.now();

        this.emit({
          ...baseRecord,
          status: cancelled
            ? "cancelled"
            : "failed",
          output: captured.value,
          result: captured.result,
          meta: captured.meta,
          startedAt,
          endedAt,
          durationMs: Math.max(
            1,
            endedAt - startedAt
          ),
          attempt,
          maxAttempts:
            retryPolicy.maxAttempts,
          lastError:
            output.error
        });

        return output;
      }
    }

    return createRuntimeError(
      "TOOL_EXECUTION_FAILED",
      "工具执行失败。"
    );
  }

  buildToolSet(definitions) {
    return Object.fromEntries(
      definitions.map((definition) => [
        definition.name,
        tool({
          description:
            definition.description,
          inputSchema:
            definition.inputSchema,
          strict:
            definition.strict ?? false,
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
