import {
  ToolBudget,
  ToolScopeBudget
} from "./ToolBudget.js";
import {
  ToolConcurrencyGuard
} from "./ToolConcurrencyGuard.js";
import {
  ToolEventStore
} from "./ToolEventStore.js";
import {
  ToolPolicyEngine
} from "./ToolPolicyEngine.js";
import {
  TOOL_ERROR_TYPES,
  classifyToolError,
  shouldRetryToolError
} from "./toolErrors.js";
import {
  isJsonSerializable,
  validateToolInput,
  validateToolOutput
} from "./toolContract.js";

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error ?? "工具执行失败。");
}

function normalizeOutput(output) {
  if (output && typeof output === "object" && "ok" in output) {
    return output;
  }
  return { ok: true, data: output };
}

function createRuntimeError(
  code,
  message,
  retryable = false,
  type = TOOL_ERROR_TYPES.EXECUTION_FAILED,
  category = "internal",
  details = undefined
) {
  return {
    ok: false,
    error: {
      code,
      type,
      category,
      message,
      retryable: Boolean(retryable),
      ...(details === undefined ? {} : { details })
    }
  };
}

function createTimeoutError(timeoutMs) {
  const error = new Error(
    `工具执行超过 ${Math.max(1, Math.round(timeoutMs / 1000))} 秒，已停止等待。`
  );
  error.code = "TOOL_TIMEOUT";
  return error;
}

function createAbortError(signal) {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  const error = new Error(
    signal?.reason === "user-stop"
      ? "工具调用已由用户取消。"
      : "工具调用已取消。"
  );
  error.name = "AbortError";
  error.code = "CANCELLED_BY_USER";
  return error;
}

function createAbortScope(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timeoutId = null;
  const onParentAbort = () => {
    controller.abort(parentSignal.reason);
  };

  if (parentSignal?.aborted) {
    onParentAbort();
  } else {
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  }

  if (!controller.signal.aborted && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      controller.abort(createTimeoutError(timeoutMs));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
  };
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
      abortSignal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(createAbortError(abortSignal));
    };
    timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    if (abortSignal?.aborted) {
      onAbort();
      return;
    }
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

function runWithAbort(execution, abortSignal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      abortSignal?.removeEventListener("abort", onAbort);
    };
    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => settle(reject, createAbortError(abortSignal));

    if (abortSignal?.aborted) {
      onAbort();
      return;
    }
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(execution).then(
      (value) => settle(resolve, value),
      (error) => settle(reject, error)
    );
  });
}

function normalizedPolicy(definition, maxRetries, idempotencyKey) {
  const policy = definition.retryPolicy ?? {};
  const configuredAttempts = Math.max(1, Number(policy.maxAttempts) || 1);
  const runtimeAttempts = Math.max(1, Number(maxRetries) + 1);
  const safeSideEffect = ["none", "read"].includes(
    definition.sideEffect ?? "none"
  );
  const idempotent =
    definition.idempotency === "natural" ||
    (definition.idempotency === "required" && Boolean(idempotencyKey));

  return {
    ...policy,
    maxAttempts:
      safeSideEffect || idempotent
        ? Math.min(configuredAttempts, runtimeAttempts)
        : 1,
    retryOn: Array.isArray(policy.retryOn) ? policy.retryOn : [],
    backoffMs: Math.max(0, Number(policy.backoffMs) || 0)
  };
}

function resolveConcurrencyKey(definition, input) {
  if (typeof definition.concurrencyKey === "function") {
    return String(definition.concurrencyKey(input) ?? "");
  }
  return String(definition.concurrencyKey ?? "");
}

function categoryForType(type) {
  return {
    [TOOL_ERROR_TYPES.INVALID_ARGUMENTS]: "invalid_input",
    [TOOL_ERROR_TYPES.PERMISSION_DENIED]: "permission_denied",
    [TOOL_ERROR_TYPES.NOT_FOUND]: "not_found",
    [TOOL_ERROR_TYPES.TIMEOUT]: "timeout",
    [TOOL_ERROR_TYPES.TEMPORARY_FAILURE]: "unavailable",
    [TOOL_ERROR_TYPES.CANCELLED]: "cancelled",
    [TOOL_ERROR_TYPES.RESULT_TOO_LARGE]: "invalid_output",
    [TOOL_ERROR_TYPES.INVALID_OUTPUT]: "invalid_output",
    [TOOL_ERROR_TYPES.POLICY_DENIED]: "policy_denied",
    [TOOL_ERROR_TYPES.CONFLICT]: "conflict",
    [TOOL_ERROR_TYPES.RATE_LIMITED]: "rate_limited"
  }[type] ?? "internal";
}

export class ToolExecutor {
  constructor({
    context = {},
    onRecord = null,
    onEvent = null,
    onExecutionComplete = null,
    getRecordMetadata = null,
    policyEngine = null,
    defaultTimeoutMs = 15000,
    maxToolCalls = 100,
    maxTotalToolCalls = 2000,
    maxIdenticalCalls = 3,
    runTimeoutMs = 1800000,
    resultStore = null,
    maxRetries = 1,
    maxConcurrent = 4,
    maxToolCallsPerStep = 16,
    maxToolCallsPerBatch = 24,
    budget = null,
    eventStore = null
  } = {}) {
    this.context = { ...context };
    this.onRecord = onRecord;
    this.onEvent = onEvent;
    this.onExecutionComplete = onExecutionComplete;
    this.getRecordMetadata = getRecordMetadata;
    this.defaultTimeoutMs = Math.max(0, Number(defaultTimeoutMs) || 0);
    this.runTimeoutMs = Math.max(0, Number(runTimeoutMs) || 0);
    this.resultStore = resultStore;
    this.maxRetries = Math.max(0, Math.min(2, Number(maxRetries) || 0));
    this.startedAt = Date.now();
    this.deadline = this.runTimeoutMs > 0
      ? this.startedAt + this.runTimeoutMs
      : 0;
    this.budget = budget ?? new ToolBudget({
      maxRequests: maxToolCalls,
      maxTotalRequests: maxTotalToolCalls,
      maxIdenticalRequests: maxIdenticalCalls,
      maxRetries: this.maxRetries,
      deadline: this.deadline
    });
    this.policyEngine = policyEngine ?? new ToolPolicyEngine();
    this.concurrency = new ToolConcurrencyGuard({ maxConcurrent });
    this.scopeBudget = new ToolScopeBudget({
      maxPerStep: maxToolCallsPerStep,
      maxPerBatch: maxToolCallsPerBatch
    });
    this.eventStore = eventStore ?? new ToolEventStore();
    this.callSequence = 0;
  }

  beginStep({
    stepId = "",
    segmentId = ""
  } = {}) {
    const normalizedStepId =
      String(stepId ?? "").trim() ||
      `${String(segmentId ?? this.context.segmentId ?? "run").trim() || "run"}:step`;

    return this.scopeBudget.beginStep(normalizedStepId);
  }

  endStep(stepId = "") {
    this.scopeBudget.endStep(stepId);
  }

  emit(record) {
    const event = this.eventStore.append({
      type: "tool_lifecycle",
      callId: record.id,
      toolId: record.toolId ?? record.name,
      name: record.name,
      status: record.status,
      attempt: record.attempt ?? 0,
      record
    });
    try {
      this.onEvent?.(event);
    } catch (error) {
      console.warn("工具事件监听器执行失败：", error);
    }
    try {
      this.onRecord?.(event.record);
    } catch (error) {
      console.warn("工具记录监听器执行失败：", error);
    }
    return event.record;
  }

  captureFailure(output, options = {}) {
    if (this.resultStore) {
      return this.resultStore.captureFailure(output, options);
    }
    return {
      value: output,
      result: {
        status: options.cancelled ? "cancelled" : "error",
        summary: output?.error?.message ?? "工具执行失败。",
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

  finishRejected(baseRecord, output) {
    this.budget.noteDenied();
    this.budget.noteOutput(output);
    const endedAt = Date.now();
    const cancelled = output.error?.type === TOOL_ERROR_TYPES.CANCELLED;
    const gracefulBoundary =
      output.error?.category === "budget_exceeded";
    const captured = this.captureFailure(output, {
      toolName: baseRecord.name,
      cancelled,
      callId: baseRecord.id,
      taskId: baseRecord.taskId,
      segmentId: baseRecord.segmentId
    });
    this.emit({
      ...baseRecord,
      activityVisibility:
        gracefulBoundary
          ? "developer"
          : baseRecord.activityVisibility,
      gracefulBoundary,
      status: cancelled ? "cancelled" : "failed",
      output: captured.value,
      result: captured.result,
      meta: { ...captured.meta, budget: this.budget.snapshot() },
      endedAt,
      durationMs: Math.max(1, endedAt - baseRecord.queuedAt),
      attempt: 0,
      maxAttempts: 0
    });
    return output;
  }

  effectiveTimeout(definition, options, now) {
    const requested = Math.max(
      0,
      Number(definition.timeoutMs ?? this.defaultTimeoutMs) || 0
    );
    const deadlines = [this.deadline, Number(options.deadline) || 0]
      .filter((value) => value > 0);
    const remaining = deadlines.length
      ? Math.max(0, Math.min(...deadlines) - now)
      : 0;

    if (requested > 0 && remaining > 0) {
      return Math.min(requested, remaining);
    }
    return requested || remaining;
  }

  async execute(definition, input, options = {}) {
    const id = String(
      options.toolCallId ??
        `${definition.name}-${Date.now()}-${++this.callSequence}`
    );
    const queuedAt = Date.now();
    let recordMetadata = options.metadata ?? {};
    try {
      recordMetadata =
        (await this.getRecordMetadata?.({
          definition,
          input,
          callId: id
        })) ?? recordMetadata;
    } catch (error) {
      console.warn("工具记录元数据读取失败：", error);
    }
    const taskId = String(options.taskId ?? this.context.taskId ?? "");
    const segmentId = String(options.segmentId ?? this.context.segmentId ?? "");
    const baseRecord = {
      id,
      toolId: definition.id ?? definition.name,
      name: definition.name,
      title: definition.title,
      source: definition.source,
      riskLevel: definition.riskLevel,
      sideEffect: definition.sideEffect,
      countsTowardLimit:
        definition.countsTowardLimit !== false,
      countsTowardRepeatLimit:
        definition.countsTowardRepeatLimit === undefined
          ? definition.countsTowardLimit !== false
          : definition.countsTowardRepeatLimit !== false,
      activityVisibility:
        definition.activityVisibility ?? "normal",
      taskId,
      segmentId,
      batch: recordMetadata.batch ?? null,
      planStep: recordMetadata.planStep ?? null,
      input,
      queuedAt,
      startedAt: null,
      endedAt: null,
      durationMs: 0,
      attempt: 0,
      maxAttempts: 0
    };
    const scopeCheck = this.scopeBudget.inspect({
      stepId:
        options.stepId ??
        this.scopeBudget.currentStepId,
      batchId:
        recordMetadata.batch?.id ??
        options.batchId ??
        segmentId
    });
    baseRecord.stepId = scopeCheck.stepId;
    baseRecord.batchId = scopeCheck.batchId;
    baseRecord.scope = {
      stepCount: scopeCheck.stepCount,
      batchCount: scopeCheck.batchCount
    };
    if (scopeCheck.code) {
      const scopedError = createRuntimeError(
        scopeCheck.code,
        scopeCheck.message,
        false,
        TOOL_ERROR_TYPES.EXECUTION_FAILED,
        "budget_exceeded",
        {
          stepId: scopeCheck.stepId,
          batchId: scopeCheck.batchId,
          stepCount: scopeCheck.stepCount,
          batchCount: scopeCheck.batchCount
        }
      );

      if (scopeCheck.suppressed) {
        return scopedError;
      }

      this.emit({ ...baseRecord, status: "queued" });
      return this.finishRejected(
        baseRecord,
        scopedError
      );
    }

    this.emit({ ...baseRecord, status: "queued" });

    const budgetCheck = this.budget.inspectRequest(
      definition.name,
      input,
      {
        countsTowardLimit:
          definition.countsTowardLimit !== false,
        countsTowardRepeatLimit:
          definition.countsTowardRepeatLimit === undefined
            ? definition.countsTowardLimit !== false
            : definition.countsTowardRepeatLimit !== false
      }
    );
    if (this.context.abortSignal?.aborted) {
      return this.finishRejected(
        baseRecord,
        createRuntimeError(
          "CANCELLED_BY_USER",
          "工具调用已由用户取消。",
          false,
          TOOL_ERROR_TYPES.CANCELLED,
          "cancelled"
        )
      );
    }
    if (this.deadline > 0 && queuedAt >= this.deadline) {
      return this.finishRejected(
        baseRecord,
        createRuntimeError(
          "AGENT_RUN_TIMEOUT",
          "本次任务已超过允许的总运行时间。",
          false,
          TOOL_ERROR_TYPES.TIMEOUT,
          "timeout"
        )
      );
    }
    if (budgetCheck.rejection) {
      return this.finishRejected(
        baseRecord,
        createRuntimeError(
          budgetCheck.rejection.code,
          budgetCheck.rejection.message,
          false,
          TOOL_ERROR_TYPES.EXECUTION_FAILED,
          "budget_exceeded"
        )
      );
    }

    const validatedInput = validateToolInput(definition, input);
    if (!validatedInput.ok) {
      return this.finishRejected(
        baseRecord,
        createRuntimeError(
          validatedInput.code,
          validatedInput.message,
          false,
          TOOL_ERROR_TYPES.INVALID_ARGUMENTS,
          "invalid_input"
        )
      );
    }
    if (!isJsonSerializable(validatedInput.value)) {
      return this.finishRejected(
        baseRecord,
        createRuntimeError(
          "INVALID_TOOL_ARGUMENTS",
          "工具参数必须是可序列化的 JSON 值。",
          false,
          TOOL_ERROR_TYPES.INVALID_ARGUMENTS,
          "invalid_input"
        )
      );
    }

    let policyDecision;
    try {
      policyDecision = await this.policyEngine.evaluate({
        definition: {
          id: definition.id ?? definition.name,
          name: definition.name,
          version: definition.version ?? 1,
          source: definition.source ?? "builtin",
          riskLevel: definition.riskLevel ?? "none",
          sideEffect: definition.sideEffect ?? "none"
        },
        input: validatedInput.value,
        taskId,
        segmentId,
        callId: id,
        capabilities: this.context.capabilities ?? null,
        mode: this.context.mode ?? "interactive"
      });
    } catch (error) {
      return this.finishRejected(
        baseRecord,
        createRuntimeError(
          "POLICY_EVALUATION_FAILED",
          errorMessage(error),
          false,
          TOOL_ERROR_TYPES.EXECUTION_FAILED,
          "internal"
        )
      );
    }

    if (policyDecision.decision !== "allow") {
      const approval = policyDecision.decision === "require_approval";
      return this.finishRejected(
        baseRecord,
        createRuntimeError(
          approval ? "APPROVAL_REQUIRED" : policyDecision.code,
          policyDecision.message,
          false,
          TOOL_ERROR_TYPES.PERMISSION_DENIED,
          approval ? "approval_required" : "policy_denied",
          approval ? policyDecision.request : policyDecision.details
        )
      );
    }

    const timeoutMs = this.effectiveTimeout(definition, options, Date.now());
    if (timeoutMs <= 0 && (this.deadline > 0 || Number(options.deadline) > 0)) {
      return this.finishRejected(
        baseRecord,
        createRuntimeError(
          "TOOL_TIMEOUT",
          "工具调用在开始前已超过截止时间。",
          false,
          TOOL_ERROR_TYPES.TIMEOUT,
          "timeout"
        )
      );
    }

    const scope = createAbortScope(this.context.abortSignal, timeoutMs);
    let release = null;
    try {
      release = await this.concurrency.acquire(
        resolveConcurrencyKey(definition, validatedInput.value),
        scope.signal
      );
      this.budget.noteExecution();
      return await this.executeAuthorized(
        definition,
        validatedInput.value,
        options,
        baseRecord,
        scope.signal
      );
    } catch (error) {
      const classified = classifyToolError(error, { abortSignal: scope.signal });
      return this.finishRejected(
        baseRecord,
        createRuntimeError(
          classified.code,
          classified.message,
          false,
          classified.type,
          categoryForType(classified.type)
        )
      );
    } finally {
      release?.();
      scope.cleanup();
    }
  }

  async executeAuthorized(
    definition,
    input,
    options,
    baseRecord,
    abortSignal
  ) {
    const retryPolicy = normalizedPolicy(
      definition,
      this.maxRetries,
      options.idempotencyKey
    );
    const startedAt = Date.now();
    let lastFailure = null;

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      this.emit({
        ...baseRecord,
        status: "running",
        startedAt,
        attempt,
        maxAttempts: retryPolicy.maxAttempts,
        lastError: lastFailure
      });

      try {
        const rawOutput = await runWithAbort(
          definition.execute(input, {
            ...this.context,
            callId: baseRecord.id,
            toolCallId: baseRecord.id,
            taskId: baseRecord.taskId,
            segmentId: baseRecord.segmentId,
            attempt,
            maxAttempts: retryPolicy.maxAttempts,
            deadline: this.deadline,
            abortSignal,
            idempotencyKey: options.idempotencyKey ?? "",
            metadata: options.metadata ?? null
          }),
          abortSignal
        );
        const validatedOutput = validateToolOutput(definition, rawOutput);
        if (!validatedOutput.ok) {
          throw Object.assign(new Error(validatedOutput.message), {
            code: validatedOutput.code
          });
        }
        const normalizedOutput = normalizeOutput(validatedOutput.value);
        if (!isJsonSerializable(normalizedOutput)) {
          throw Object.assign(
            new Error("工具输出必须是可序列化的 JSON 值。"),
            { code: "INVALID_TOOL_OUTPUT" }
          );
        }

        if (normalizedOutput.ok === false) {
          const classified = classifyToolError(normalizedOutput, {
            abortSignal
          });
          const output = {
            ...normalizedOutput,
            error: {
              ...normalizedOutput.error,
              code: classified.code,
              type: classified.type,
              category: categoryForType(classified.type),
              message: classified.message,
              retryable: classified.retryable
            }
          };

          if (shouldRetryToolError(classified, retryPolicy, attempt)) {
            lastFailure = output.error;
            this.budget.noteRetry();
            this.emit({
              ...baseRecord,
              status: "retrying",
              startedAt,
              attempt,
              maxAttempts: retryPolicy.maxAttempts,
              lastError: output.error,
              durationMs: Math.max(1, Date.now() - startedAt)
            });
            await wait(retryPolicy.backoffMs * attempt, abortSignal);
            continue;
          }

          return this.finishExecutionFailure(
            baseRecord,
            output,
            startedAt,
            attempt,
            retryPolicy.maxAttempts,
            classified.type === TOOL_ERROR_TYPES.CANCELLED
          );
        }

        const captured = this.resultStore
          ? this.resultStore.capture(normalizedOutput, {
              toolName: definition.name,
              callId: baseRecord.id,
              taskId: baseRecord.taskId,
              segmentId: baseRecord.segmentId
            })
          : {
              value: normalizedOutput,
              result: {
                status: "success",
                summary: `${definition.title ?? definition.name}执行完成`,
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
        const endedAt = Date.now();
        this.budget.noteOutput(captured.value);

        try {
          await this.onExecutionComplete?.({
            definition,
            input,
            output: captured.value,
            callId: baseRecord.id
          });
        } catch (error) {
          console.warn("工具完成回调执行失败：", error);
        }

        this.emit({
          ...baseRecord,
          status: "completed",
          output: captured.value,
          result: captured.result,
          meta: { ...captured.meta, budget: this.budget.snapshot() },
          startedAt,
          endedAt,
          durationMs: Math.max(1, endedAt - startedAt),
          attempt,
          maxAttempts: retryPolicy.maxAttempts,
          lastError: lastFailure
        });
        return captured.value;
      } catch (error) {
        const classified = classifyToolError(error, { abortSignal });
        const output = createRuntimeError(
          classified.code,
          classified.type === TOOL_ERROR_TYPES.CANCELLED
            ? "工具调用已由用户取消。"
            : errorMessage(error),
          classified.retryable,
          classified.type,
          categoryForType(classified.type)
        );

        if (shouldRetryToolError(classified, retryPolicy, attempt)) {
          lastFailure = output.error;
          this.budget.noteRetry();
          this.emit({
            ...baseRecord,
            status: "retrying",
            startedAt,
            attempt,
            maxAttempts: retryPolicy.maxAttempts,
            lastError: output.error,
            durationMs: Math.max(1, Date.now() - startedAt)
          });
          await wait(retryPolicy.backoffMs * attempt, abortSignal);
          continue;
        }

        return this.finishExecutionFailure(
          baseRecord,
          output,
          startedAt,
          attempt,
          retryPolicy.maxAttempts,
          classified.type === TOOL_ERROR_TYPES.CANCELLED
        );
      }
    }

    return createRuntimeError("TOOL_EXECUTION_FAILED", "工具执行失败。");
  }

  finishExecutionFailure(
    baseRecord,
    output,
    startedAt,
    attempt,
    maxAttempts,
    cancelled
  ) {
    this.budget.noteOutput(output);
    const captured = this.captureFailure(output, {
      toolName: baseRecord.name,
      cancelled,
      callId: baseRecord.id,
      taskId: baseRecord.taskId,
      segmentId: baseRecord.segmentId
    });
    const endedAt = Date.now();
    this.emit({
      ...baseRecord,
      status: cancelled ? "cancelled" : "failed",
      output: captured.value,
      result: captured.result,
      meta: { ...captured.meta, budget: this.budget.snapshot() },
      startedAt,
      endedAt,
      durationMs: Math.max(1, endedAt - startedAt),
      attempt,
      maxAttempts,
      lastError: output.error
    });
    return output;
  }

  getRecords() {
    return this.eventStore.projectRecords();
  }

  getEvents() {
    return this.eventStore.list();
  }

  getBudget() {
    return {
      ...this.budget.snapshot(),
      scopes: this.scopeBudget.snapshot()
    };
  }

  getCallCount() {
    return this.budget.requestCount;
  }
}
