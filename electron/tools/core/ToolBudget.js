import crypto from "node:crypto";

function canonicalize(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") {
      return { $bigint: String(value) };
    }
    return value;
  }

  if (seen.has(value)) {
    throw new TypeError("Cannot create a signature for a cyclic value.");
  }

  seen.add(value);
  const normalized = Array.isArray(value)
    ? value.map((item) => canonicalize(item, seen))
    : Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonicalize(value[key], seen)])
      );
  seen.delete(value);
  return normalized;
}

export function createToolSignature(name, input) {
  let serialized;

  try {
    serialized = JSON.stringify(canonicalize(input));
  } catch {
    serialized = String(input);
  }

  const digest = crypto
    .createHash("sha256")
    .update(serialized ?? "undefined")
    .digest("hex");

  return `${String(name)}:${digest}`;
}

export class ToolBudget {
  constructor({
    maxRequests = 100,
    maxTotalRequests = 2000,
    maxIdenticalRequests = 3,
    maxRetries = 1,
    deadline = 0
  } = {}) {
    this.maxRequests = Math.max(1, Number(maxRequests) || 100);
    this.maxTotalRequests = Math.max(this.maxRequests, Number(maxTotalRequests) || 2000);
    this.maxIdenticalRequests = Math.max(
      1,
      Number(maxIdenticalRequests) || 3
    );
    this.maxRetries = Math.max(0, Number(maxRetries) || 0);
    this.deadline = Math.max(0, Number(deadline) || 0);
    this.requestCount = 0;
    this.totalRequestCount = 0;
    this.unmeteredRequestCount = 0;
    this.executionCount = 0;
    this.retryCount = 0;
    this.deniedCount = 0;
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.signatures = new Map();
  }

  inspectRequest(
    name,
    input,
    {
      countsTowardLimit = true,
      countsTowardRepeatLimit = true
    } = {}
  ) {
    const signature = createToolSignature(name, input);
    const previous = this.signatures.get(signature) ?? 0;
    let rejection = null;
    this.totalRequestCount += 1;
    if (countsTowardLimit) {
      this.requestCount += 1;
    } else {
      this.unmeteredRequestCount += 1;
    }
    this.signatures.set(signature, previous + 1);

    if (this.totalRequestCount > this.maxTotalRequests) {
      rejection = {
        code: "TOOL_EMERGENCY_LIMIT",
        message: `工具总请求达到安全熔断上限 ${this.maxTotalRequests} 次。`
      };
    } else if (
      countsTowardLimit &&
      this.requestCount > this.maxRequests
    ) {
      rejection = {
        code: "TOOL_CALL_LIMIT",
        message: `本次任务最多允许请求 ${this.maxRequests} 次受限工具。`
      };
    } else if (
      countsTowardRepeatLimit &&
      previous >= this.maxIdenticalRequests
    ) {
      rejection = {
        code: "REPEATED_TOOL_CALL",
        message: `相同工具和参数已请求 ${previous} 次，没有必要继续重复。`
      };
    }
    try {
      this.bytesIn += Buffer.byteLength(JSON.stringify(input) ?? "", "utf8");
    } catch {
      // Input validation will report non-serializable values.
    }

    return { signature, rejection };
  }

  noteDenied() {
    this.deniedCount += 1;
  }

  noteExecution() {
    this.executionCount += 1;
  }

  noteRetry() {
    this.retryCount += 1;
  }

  noteOutput(output) {
    try {
      this.bytesOut += Buffer.byteLength(JSON.stringify(output) ?? "", "utf8");
    } catch {
      // Output validation reports non-serializable values separately.
    }
  }

  snapshot() {
    return {
      requestCount: this.requestCount,
      executionCount: this.executionCount,
      retryCount: this.retryCount,
      totalRequestCount: this.totalRequestCount,
      unmeteredRequestCount: this.unmeteredRequestCount,
      deniedCount: this.deniedCount,
      bytesIn: this.bytesIn,
      bytesOut: this.bytesOut,
      deadline: this.deadline
    };
  }
}

export class ToolScopeBudget {
  constructor({
    maxPerStep = 16,
    maxPerBatch = 24
  } = {}) {
    this.maxPerStep = Math.max(1, Number(maxPerStep) || 16);
    this.maxPerBatch = Math.max(1, Number(maxPerBatch) || 24);
    this.currentStepId = "";
    this.stepCounts = new Map();
    this.batchCounts = new Map();
    this.trippedSteps = new Set();
    this.trippedBatches = new Set();
  }

  beginStep(stepId) {
    this.currentStepId = String(stepId ?? "").trim();
    return this.currentStepId;
  }

  endStep(stepId = this.currentStepId) {
    const normalized = String(stepId ?? "").trim();

    if (!normalized || normalized === this.currentStepId) {
      this.currentStepId = "";
    }
  }

  inspect({
    stepId = this.currentStepId,
    batchId = ""
  } = {}) {
    const normalizedStep = String(stepId ?? "").trim() || "unscoped-step";
    const normalizedBatch = String(batchId ?? "").trim() || normalizedStep;

    if (this.trippedSteps.has(normalizedStep)) {
      return {
        code: "TOOL_STEP_LIMIT",
        message: `单个模型步骤最多允许 ${this.maxPerStep} 个工具调用。`,
        stepId: normalizedStep,
        batchId: normalizedBatch,
        stepCount: this.stepCounts.get(normalizedStep) ?? this.maxPerStep + 1,
        batchCount: this.batchCounts.get(normalizedBatch) ?? 0,
        suppressed: true
      };
    }

    if (this.trippedBatches.has(normalizedBatch)) {
      return {
        code: "TOOL_BATCH_LIMIT",
        message: `单个工具批次最多允许 ${this.maxPerBatch} 个工具调用。`,
        stepId: normalizedStep,
        batchId: normalizedBatch,
        stepCount: this.stepCounts.get(normalizedStep) ?? 0,
        batchCount: this.batchCounts.get(normalizedBatch) ?? this.maxPerBatch + 1,
        suppressed: true
      };
    }

    const stepCount = (this.stepCounts.get(normalizedStep) ?? 0) + 1;
    const batchCount = (this.batchCounts.get(normalizedBatch) ?? 0) + 1;

    this.stepCounts.set(normalizedStep, stepCount);
    this.batchCounts.set(normalizedBatch, batchCount);

    if (stepCount > this.maxPerStep) {
      this.trippedSteps.add(normalizedStep);
      return {
        code: "TOOL_STEP_LIMIT",
        message: `单个模型步骤最多允许 ${this.maxPerStep} 个工具调用。`,
        stepId: normalizedStep,
        batchId: normalizedBatch,
        stepCount,
        batchCount,
        firstBoundary: true
      };
    }

    if (batchCount > this.maxPerBatch) {
      this.trippedBatches.add(normalizedBatch);
      return {
        code: "TOOL_BATCH_LIMIT",
        message: `单个工具批次最多允许 ${this.maxPerBatch} 个工具调用。`,
        stepId: normalizedStep,
        batchId: normalizedBatch,
        stepCount,
        batchCount,
        firstBoundary: true
      };
    }

    return {
      code: "",
      stepId: normalizedStep,
      batchId: normalizedBatch,
      stepCount,
      batchCount
    };
  }

  snapshot() {
    return {
      currentStepId: this.currentStepId,
      maxPerStep: this.maxPerStep,
      maxPerBatch: this.maxPerBatch,
      stepCounts: Object.fromEntries(this.stepCounts),
      batchCounts: Object.fromEntries(this.batchCounts),
      trippedSteps: [...this.trippedSteps],
      trippedBatches: [...this.trippedBatches]
    };
  }
}
