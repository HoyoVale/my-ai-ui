import crypto from "node:crypto";

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
  isUnsafeToolEffect,
  publicToolRuntimeContract
} from "./ToolRuntimeContract.js";

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

function shouldCountCircuitFailure(error = {}) {
  const category = String(error?.category ?? "");
  const type = String(error?.type ?? "");

  if (["cancelled", "invalid_input", "permission_denied", "policy_denied", "approval_required", "budget_exceeded", "conflict"].includes(category)) {
    return false;
  }

  return [
    "timeout",
    "unavailable",
    "rate_limited",
    "internal",
    "persistence"
  ].includes(category) || [
    TOOL_ERROR_TYPES.TIMEOUT,
    TOOL_ERROR_TYPES.TEMPORARY_FAILURE,
    TOOL_ERROR_TYPES.RATE_LIMITED,
    TOOL_ERROR_TYPES.EXECUTION_FAILED
  ].includes(type);
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
    eventStore = null,
    executionLedger = null,
    circuitBreakers = null,
    faultInjector = null
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
    this.executionLedger = executionLedger;
    this.circuitBreakers = circuitBreakers;
    this.faultInjector = typeof faultInjector === "function"
      ? faultInjector
      : null;
    this.callSequence = 0;
  }

  async injectFault(boundary, details = {}) {
    if (!this.faultInjector) {
      return;
    }
    await this.faultInjector(String(boundary ?? ""), {
      ...details,
      timestamp: Date.now()
    });
  }

  circuitKey(definition) {
    return String(
      definition?.circuitBreakerKey ??
      definition?.id ??
      definition?.name ??
      ""
    );
  }

  noteCircuitSuccess(definition) {
    this.circuitBreakers?.recordSuccess?.(
      this.circuitKey(definition),
      { label: definition?.title ?? definition?.name ?? "工具" }
    );
  }

  noteCircuitFailure(definition, error) {
    this.circuitBreakers?.recordFailure?.(
      this.circuitKey(definition),
      error,
      {
        counted: shouldCountCircuitFailure(error),
        label: definition?.title ?? definition?.name ?? "工具"
      }
    );
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
      displayTitle:
        definition.presentation?.title ??
        definition.title,
      displayDescription:
        definition.presentation?.description ??
        definition.description ??
        "",
      toolsets: [...(definition.toolsets ?? [])],
      source: definition.source,
      riskLevel: definition.riskLevel,
      sideEffect: definition.sideEffect,
      runtimeContract: {
        effect: definition.runtimeContract?.effect ?? "read",
        retryMode: definition.runtimeContract?.retryMode ?? "safe",
        supportsAbort: definition.runtimeContract?.supportsAbort === true,
        supportsResume: definition.runtimeContract?.supportsResume === true
      },
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
      maxAttempts: 0,
      runtime: {
        state: "planned",
        replayed: false,
        recovery: "none"
      }
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
      return this.finishRejected(baseRecord, scopedError);
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
          title: definition.title ?? definition.name,
          version: definition.version ?? 1,
          source: definition.source ?? "builtin",
          riskLevel: definition.riskLevel ?? "none",
          sideEffect: definition.sideEffect ?? "none",
          runtimeContract: publicToolRuntimeContract(
            definition.runtimeContract ?? {}
          )
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

    const circuitDecision = this.circuitBreakers?.beforeRequest?.(
      this.circuitKey(definition),
      { label: definition.title ?? definition.name }
    );
    if (circuitDecision && circuitDecision.ok === false) {
      return this.finishRejected(
        baseRecord,
        createRuntimeError(
          "TOOL_CIRCUIT_OPEN",
          "该工具连续失败后已暂时停用，请稍后重试。",
          true,
          TOOL_ERROR_TYPES.TEMPORARY_FAILURE,
          "unavailable",
          { retryAfterMs: circuitDecision.retryAfterMs ?? 0 }
        )
      );
    }
    if (circuitDecision?.state) {
      baseRecord.runtime.circuitState = circuitDecision.state;
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

    let ledgerCall = null;
    let effectiveIdempotencyKey = String(options.idempotencyKey ?? "");

    if (this.executionLedger) {
      let prepared;
      try {
        prepared = await this.executionLedger.prepare({
          definition,
          input: validatedInput.value,
          callId: id,
          segmentId,
          explicitIdempotencyKey: effectiveIdempotencyKey
        });
      } catch (error) {
        return this.finishRejected(
          baseRecord,
          createRuntimeError(
            "TOOL_PREPARE_FAILED",
            `无法持久化工具执行准备状态：${errorMessage(error)}`,
            true,
            TOOL_ERROR_TYPES.TEMPORARY_FAILURE,
            "persistence"
          )
        );
      }

      await this.injectFault("after_prepare", {
        definition,
        input: validatedInput.value,
        callId: id,
        prepared
      });

      if (prepared.replayed && definition.runtimeContract?.canVerify) {
        const verification = await this.executionLedger.verifyReceipt(
          definition,
          prepared.receipt,
          {
            input: validatedInput.value,
            callId: id
          }
        );
        if (!verification.ok) {
          const output = createRuntimeError(
            "TOOL_RECEIPT_VERIFICATION_FAILED",
            verification.status === "not_applied"
              ? "已保存的工具收据与当前文件状态不一致，需要核验后再继续。"
              : "无法确认已保存工具收据对应的外部状态。",
            false,
            TOOL_ERROR_TYPES.CONFLICT,
            "needs_reconciliation",
            {
              receiptId: prepared.receipt?.receiptId ?? "",
              verificationStatus: verification.status,
              evidence: verification.evidence ?? null
            }
          );
          this.emit({
            ...baseRecord,
            status: "needs_reconciliation",
            output,
            lastError: output.error,
            endedAt: Date.now(),
            runtime: {
              state: "needs_reconciliation",
              replayed: false,
              recovery: "needs_reconciliation",
              receiptId: prepared.receipt?.receiptId ?? ""
            }
          });
          return output;
        }
      }

      if (prepared.replayed) {
        const receipt = prepared.receipt;
        const endedAt = Date.now();
        const replayedRecord = {
          ...baseRecord,
          status: receipt.status === "success" ? "completed" :
            receipt.status === "cancelled" ? "cancelled" : "failed",
          output: receipt.output,
          result: receipt.result,
          startedAt: receipt.startedAt || endedAt,
          endedAt,
          durationMs: 0,
          attempt: receipt.attempt || 1,
          maxAttempts: receipt.attempt || 1,
          runtime: {
            state: "reported",
            replayed: true,
            recovery: "replay_receipt",
            receiptId: receipt.receiptId,
            checksum: receipt.checksum
          }
        };
        this.emit(replayedRecord);
        return structuredClone(receipt.output);
      }

      if (!prepared.ok) {
        const needsConfirmation = prepared.code === "TOOL_CONFIRMATION_REQUIRED";
        const leased = prepared.code === "TOOL_CALL_LEASED";
        const output = createRuntimeError(
          prepared.code,
          needsConfirmation
            ? "此前的写操作结果无法自动确认，需要用户确认后才能继续。"
            : leased
              ? "相同的工具操作正在由另一个执行器处理，请稍后重试。"
              : "此前的写操作状态不确定，需要先核验实际结果。",
          leased,
          TOOL_ERROR_TYPES.CONFLICT,
          leased
            ? "conflict"
            : needsConfirmation
              ? "needs_confirmation"
              : "needs_reconciliation",
          {
            previousCallId: prepared.previousCall?.callId ?? "",
            state: prepared.state ?? "",
            lease: prepared.lease ?? null
          }
        );
        const status = leased
          ? "failed"
          : needsConfirmation
            ? "needs_confirmation"
            : "needs_reconciliation";
        this.emit({
          ...baseRecord,
          status,
          output,
          lastError: output.error,
          endedAt: Date.now(),
          runtime: {
            state: prepared.state ?? status,
            replayed: false,
            recovery: leased
              ? "in_progress"
              : needsConfirmation
                ? "needs_confirmation"
                : "needs_reconciliation"
          }
        });
        return output;
      }

      ledgerCall = prepared.call;
      effectiveIdempotencyKey = ledgerCall.idempotencyKey || effectiveIdempotencyKey;
      baseRecord.runtime = {
        state: "prepared",
        replayed: false,
        recovery: "none",
        idempotencyKey: effectiveIdempotencyKey,
        leaseOwnerId: ledgerCall.lease?.ownerId ?? ""
      };
    }

    const scope = createAbortScope(this.context.abortSignal, timeoutMs);
    let release = null;
    let heartbeatId = null;
    try {
      release = await this.concurrency.acquire(
        resolveConcurrencyKey(definition, validatedInput.value),
        scope.signal,
        { exclusive: definition.exclusiveConcurrency === true }
      );
      if (ledgerCall) {
        ledgerCall = await this.executionLedger.markDispatched(
          ledgerCall,
          { dispatchedAt: Date.now() }
        );
        await this.injectFault("after_dispatch", {
          definition,
          input: validatedInput.value,
          callId: id,
          ledgerCall
        });
        const heartbeatMs = Math.max(
          1_000,
          Number(definition.runtimeContract?.heartbeatMs) || 10_000
        );
        heartbeatId = setInterval(() => {
          void this.executionLedger.heartbeat(ledgerCall).catch((error) => {
            console.warn("工具 Lease 心跳更新失败：", error);
          });
        }, heartbeatMs);
        heartbeatId.unref?.();
      }
      this.budget.noteExecution();
      return await this.executeAuthorized(
        definition,
        validatedInput.value,
        {
          ...options,
          idempotencyKey: effectiveIdempotencyKey
        },
        baseRecord,
        scope.signal,
        ledgerCall
      );
    } catch (error) {
      const classified = classifyToolError(error, { abortSignal: scope.signal });
      this.noteCircuitFailure(definition, {
        ...classified,
        category: categoryForType(classified.type)
      });
      if (ledgerCall && isUnsafeToolEffect(definition.runtimeContract)) {
        try {
          const unresolved = await this.executionLedger.markUnknown(
            ledgerCall,
            { reason: classified.message, error: classified }
          );
          const output = createRuntimeError(
            "TOOL_EFFECT_UNKNOWN",
            "工具执行器已停止等待，但写操作是否生效尚不确定。",
            false,
            TOOL_ERROR_TYPES.CONFLICT,
            unresolved.state === "needs_confirmation"
              ? "needs_confirmation"
              : "needs_reconciliation"
          );
          this.emit({
            ...baseRecord,
            status: unresolved.state,
            output,
            lastError: output.error,
            endedAt: Date.now(),
            runtime: {
              ...baseRecord.runtime,
              state: unresolved.state,
              recovery: unresolved.state
            }
          });
          return output;
        } catch (ledgerError) {
          console.warn("无法记录不确定的工具副作用：", ledgerError);
        }
      }
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
      if (heartbeatId) {
        clearInterval(heartbeatId);
      }
      release?.();
      scope.cleanup();
    }
  }

  async executeAuthorized(
    definition,
    input,
    options,
    baseRecord,
    abortSignal,
    ledgerCall = null
  ) {
    const retryPolicy = normalizedPolicy(
      definition,
      this.maxRetries,
      options.idempotencyKey
    );
    const startedAt = Date.now();
    let lastFailure = null;

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      if (ledgerCall) {
        ledgerCall.attempt = attempt;
      }
      this.emit({
        ...baseRecord,
        status: "running",
        startedAt,
        attempt,
        maxAttempts: retryPolicy.maxAttempts,
        lastError: lastFailure,
        runtime: {
          ...baseRecord.runtime,
          state: "dispatched",
          attempt
        }
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
            metadata: options.metadata ?? null,
            onWriteBoundary: async (boundary, details = {}) => {
              await this.injectFault(`write:${boundary}`, {
                definition,
                input,
                callId: baseRecord.id,
                ledgerCall,
                ...details
              });
            }
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
        const reservedReceiptId = ledgerCall ? crypto.randomUUID() : "";
        if (
          reservedReceiptId &&
          normalizedOutput?.ok !== false &&
          normalizedOutput?.data &&
          typeof normalizedOutput.data === "object" &&
          Object.hasOwn(normalizedOutput.data, "receiptId")
        ) {
          normalizedOutput.data.receiptId = reservedReceiptId;
        }
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
              durationMs: Math.max(1, Date.now() - startedAt),
              runtime: {
                ...baseRecord.runtime,
                state: "dispatched",
                attempt,
                recovery: "retrying"
              }
            });
            await wait(retryPolicy.backoffMs * attempt, abortSignal);
            continue;
          }

          return await this.finishExecutionFailure(
            definition,
            baseRecord,
            output,
            startedAt,
            attempt,
            retryPolicy.maxAttempts,
            classified.type === TOOL_ERROR_TYPES.CANCELLED,
            ledgerCall
          );
        }

        const effectEvidence =
          normalizedOutput?.data?.effectEvidence ??
          normalizedOutput?.effectEvidence ??
          null;
        if (ledgerCall && isUnsafeToolEffect(definition.runtimeContract)) {
          ledgerCall = await this.executionLedger.markEffectConfirmed(
            ledgerCall,
            {
              confirmedAt: Date.now(),
              evidence: effectEvidence
            }
          );
          await this.injectFault("after_effect", {
            definition,
            input,
            callId: baseRecord.id,
            ledgerCall,
            output: normalizedOutput,
            effectEvidence
          });
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
        if (
          normalizedOutput?.safety &&
          captured.value &&
          typeof captured.value === "object" &&
          !captured.value.safety
        ) {
          captured.value.safety = structuredClone(normalizedOutput.safety);
        }

        const endedAt = Date.now();
        this.budget.noteOutput(captured.value);

        let receipt = null;
        if (ledgerCall) {
          receipt = await this.executionLedger.storeReceipt(
            ledgerCall,
            {
              receiptId: reservedReceiptId,
              status: "success",
              output: captured.value,
              result: captured.result,
              attempt,
              startedAt,
              endedAt,
              metadata: {
                ...captured.meta,
                effectEvidence
              }
            }
          );
          await this.injectFault("after_receipt", {
            definition,
            input,
            callId: baseRecord.id,
            ledgerCall,
            receipt
          });
        }

        try {
          await this.onExecutionComplete?.({
            definition,
            input,
            output: captured.value,
            callId: baseRecord.id,
            receipt
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
          lastError: lastFailure,
          runtime: {
            ...baseRecord.runtime,
            state: receipt ? "receipt_stored" : "completed",
            replayed: false,
            recovery: "none",
            receiptId: receipt?.receiptId ?? "",
            checksum: receipt?.checksum ?? ""
          }
        });

        if (ledgerCall && receipt) {
          await this.executionLedger.markReported(ledgerCall, receipt);
          await this.injectFault("after_report", {
            definition,
            input,
            callId: baseRecord.id,
            ledgerCall,
            receipt
          });
        }
        this.noteCircuitSuccess(definition);
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
            durationMs: Math.max(1, Date.now() - startedAt),
            runtime: {
              ...baseRecord.runtime,
              state: "dispatched",
              attempt,
              recovery: "retrying"
            }
          });
          await wait(retryPolicy.backoffMs * attempt, abortSignal);
          continue;
        }

        return await this.finishExecutionFailure(
          definition,
          baseRecord,
          output,
          startedAt,
          attempt,
          retryPolicy.maxAttempts,
          classified.type === TOOL_ERROR_TYPES.CANCELLED,
          ledgerCall
        );
      }
    }

    return createRuntimeError("TOOL_EXECUTION_FAILED", "工具执行失败。");
  }

  async finishExecutionFailure(
    definition,
    baseRecord,
    output,
    startedAt,
    attempt,
    maxAttempts,
    cancelled,
    ledgerCall = null
  ) {
    this.noteCircuitFailure(definition, output?.error);
    this.budget.noteOutput(output);
    const captured = this.captureFailure(output, {
      toolName: baseRecord.name,
      cancelled,
      callId: baseRecord.id,
      taskId: baseRecord.taskId,
      segmentId: baseRecord.segmentId
    });
    const endedAt = Date.now();

    if (
      ledgerCall &&
      isUnsafeToolEffect(definition.runtimeContract) &&
      ["cancelled", "timeout"].includes(output.error?.category)
    ) {
      await this.executionLedger.requestCancellation(
        ledgerCall,
        { reason: output.error?.code ?? "cancelled" }
      );
      const unresolved = await this.executionLedger.markUnknown(
        ledgerCall,
        {
          reason: output.error?.message ?? "",
          error: output.error
        }
      );
      const needsConfirmation = unresolved.state === "needs_confirmation";
      const uncertainOutput = createRuntimeError(
        "TOOL_EFFECT_UNKNOWN",
        needsConfirmation
          ? "工具已停止等待，但该写操作无法自动确认，请由用户决定是否继续。"
          : "工具已停止等待，但该写操作是否生效尚不确定，需要先核验实际状态。",
        false,
        TOOL_ERROR_TYPES.CONFLICT,
        needsConfirmation ? "needs_confirmation" : "needs_reconciliation",
        { originalError: output.error }
      );
      this.emit({
        ...baseRecord,
        status: unresolved.state,
        output: uncertainOutput,
        result: captured.result,
        meta: { ...captured.meta, budget: this.budget.snapshot() },
        startedAt,
        endedAt,
        durationMs: Math.max(1, endedAt - startedAt),
        attempt,
        maxAttempts,
        lastError: uncertainOutput.error,
        runtime: {
          ...baseRecord.runtime,
          state: unresolved.state,
          recovery: needsConfirmation
            ? "needs_confirmation"
            : "needs_reconciliation"
        }
      });
      return uncertainOutput;
    }

    let receipt = null;
    if (ledgerCall) {
      receipt = await this.executionLedger.markFailure(
        ledgerCall,
        {
          status: cancelled ? "cancelled" : "error",
          cancelled,
          error: output.error,
          output: captured.value,
          result: captured.result,
          startedAt,
          endedAt,
          metadata: captured.meta
        }
      );
    }

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
      lastError: output.error,
      runtime: {
        ...baseRecord.runtime,
        state: receipt ? "receipt_stored" : (cancelled ? "cancelled" : "failed"),
        recovery: receipt ? "replay_receipt" : "none",
        receiptId: receipt?.receiptId ?? "",
        checksum: receipt?.checksum ?? ""
      }
    });

    if (ledgerCall && receipt) {
      await this.executionLedger.markReported(ledgerCall, receipt);
    }
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
