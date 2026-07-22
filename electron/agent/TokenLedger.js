import {
  estimateJsonTokens,
  estimateToolDefinitionsTokens,
  normalizeProviderUsage
} from "../context/tokenEstimator.js";

const LEDGER_VERSION = 1;
const ENTRY_LIMIT = 160;

function integer(value, maximum = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.min(maximum, Math.round(numeric)))
    : 0;
}

function clone(value) {
  return structuredClone(value);
}

function emptyProviderTotals() {
  return {
    requests: 0,
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    reportedRequests: 0
  };
}

function emptyEstimatedTotals() {
  return {
    contextInputTokens: 0,
    toolSchemaTokens: 0,
    toolArgumentTokens: 0,
    toolResultTokens: 0,
    totalInputTokens: 0
  };
}

function normalizedContextBreakdown(context = {}) {
  const budget = context?.budget ?? {};
  return {
    inputTokens: integer(budget.inputTokens),
    outputReserve: integer(budget.outputReserve),
    contextTokenBudget: integer(budget.contextTokenBudget),
    sections: (Array.isArray(budget.sections) ? budget.sections : [])
      .map((section) => ({
        id: String(section?.id ?? "").slice(0, 80),
        label: String(section?.label ?? "").slice(0, 120),
        tokens: integer(section?.tokens)
      }))
      .filter((section) => section.id || section.tokens)
      .slice(0, 40)
  };
}

export class TokenLedger {
  constructor({
    runId = "",
    goalId = "",
    taskId = "",
    providerId = "",
    modelId = "",
    context = null,
    now = () => Date.now()
  } = {}) {
    this.now = now;
    this.state = {
      version: LEDGER_VERSION,
      runId: String(runId ?? ""),
      goalId: String(goalId ?? ""),
      taskId: String(taskId ?? ""),
      providerId: String(providerId ?? ""),
      modelId: String(modelId ?? ""),
      startedAt: this.now(),
      updatedAt: this.now(),
      context: normalizedContextBreakdown(context ?? {}),
      provider: emptyProviderTotals(),
      estimated: emptyEstimatedTotals(),
      compaction: {
        count: 0,
        beforeTokens: 0,
        afterTokens: 0,
        removedTokens: 0,
        removedMessages: 0
      },
      tools: {
        definitionCount: 0,
        callCount: 0,
        resultCount: 0,
        cacheReuseCount: 0
      },
      entries: []
    };
    this.toolCalls = new Map();
    this.state.estimated.contextInputTokens = this.state.context.inputTokens;
    this.recomputeEstimatedTotal();
  }

  touch() {
    this.state.updatedAt = this.now();
  }

  append(entry) {
    this.state.entries.push({
      ...entry,
      at: integer(entry?.at || this.now())
    });
    this.state.entries = this.state.entries.slice(-ENTRY_LIMIT);
    this.touch();
  }

  recomputeEstimatedTotal() {
    const estimated = this.state.estimated;
    estimated.totalInputTokens =
      integer(estimated.contextInputTokens) +
      integer(estimated.toolSchemaTokens) +
      integer(estimated.toolArgumentTokens) +
      integer(estimated.toolResultTokens);
  }

  setToolDefinitions(definitions = []) {
    const normalized = (Array.isArray(definitions) ? definitions : []).map((definition) => ({
      name: definition?.name ?? "",
      description: definition?.description ?? "",
      inputSchema: definition?.inputSchema ?? null
    }));
    this.state.tools.definitionCount = normalized.length;
    this.state.estimated.toolSchemaTokens = estimateToolDefinitionsTokens(normalized);
    this.recomputeEstimatedTotal();
    this.append({
      type: "tool_schemas",
      count: normalized.length,
      estimatedTokens: this.state.estimated.toolSchemaTokens
    });
  }

  recordTool(record = {}) {
    const callId = String(record?.id ?? "").trim();
    if (!callId) return;
    const status = String(record?.status ?? "");
    const terminal = [
      "completed",
      "failed",
      "cancelled",
      "needs_confirmation",
      "needs_reconciliation"
    ].includes(status);
    const previous = this.toolCalls.get(callId) ?? {
      argumentTokens: 0,
      resultTokens: 0,
      terminal: false,
      cacheReused: false
    };
    const argumentTokens = estimateJsonTokens(record?.input ?? null);
    const resultTokens = terminal
      ? estimateJsonTokens(record?.output ?? record?.result ?? null)
      : previous.resultTokens;
    const cacheReused = Boolean(
      record?.output?.cacheReused === true ||
      record?.result?.cacheReused === true ||
      record?.meta?.cacheReused === true
    );

    this.state.estimated.toolArgumentTokens += argumentTokens - previous.argumentTokens;
    this.state.estimated.toolResultTokens += resultTokens - previous.resultTokens;
    if (!previous.terminal && terminal) {
      this.state.tools.callCount += 1;
      if (resultTokens > 0) this.state.tools.resultCount += 1;
    }
    if (!previous.cacheReused && cacheReused) {
      this.state.tools.cacheReuseCount += 1;
    }
    this.toolCalls.set(callId, {
      argumentTokens,
      resultTokens,
      terminal: previous.terminal || terminal,
      cacheReused: previous.cacheReused || cacheReused
    });
    this.recomputeEstimatedTotal();

    if (terminal && !previous.terminal) {
      this.append({
        type: "tool_call",
        callId,
        toolName: String(record?.name ?? "").slice(0, 100),
        status,
        argumentTokens,
        resultTokens,
        cacheReused
      });
    } else {
      this.touch();
    }
  }

  recordProviderUsage(source = {}, {
    phase = "execution",
    stepNumber = 0,
    requestId = ""
  } = {}) {
    const usage = normalizeProviderUsage(source);
    const totals = this.state.provider;
    totals.requests += 1;
    totals.steps += phase === "execution" ? 1 : 0;
    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.reasoningTokens += usage.reasoningTokens;
    totals.cachedInputTokens += usage.cachedInputTokens;
    totals.totalTokens += usage.totalTokens;
    totals.reportedRequests += usage.reported ? 1 : 0;
    this.append({
      type: "provider_usage",
      phase: String(phase),
      stepNumber: integer(stepNumber, 100000),
      requestId: String(requestId ?? "").slice(0, 160),
      usage
    });
    return usage;
  }

  recordCompaction({
    estimatedTokens = 0,
    compactedTokens = 0,
    removedMessages = 0
  } = {}) {
    const before = integer(estimatedTokens);
    const after = integer(compactedTokens);
    this.state.compaction.count += 1;
    this.state.compaction.beforeTokens += before;
    this.state.compaction.afterTokens += after;
    this.state.compaction.removedTokens += Math.max(0, before - after);
    this.state.compaction.removedMessages += integer(removedMessages);
    this.append({
      type: "context_compaction",
      beforeTokens: before,
      afterTokens: after,
      removedTokens: Math.max(0, before - after),
      removedMessages: integer(removedMessages)
    });
  }

  snapshot() {
    this.recomputeEstimatedTotal();
    return clone(this.state);
  }
}

export function aggregateTokenLedgers(ledgers = []) {
  const result = {
    version: LEDGER_VERSION,
    runCount: 0,
    provider: emptyProviderTotals(),
    estimated: emptyEstimatedTotals(),
    compaction: {
      count: 0,
      beforeTokens: 0,
      afterTokens: 0,
      removedTokens: 0,
      removedMessages: 0
    },
    tools: {
      definitionCount: 0,
      callCount: 0,
      resultCount: 0,
      cacheReuseCount: 0
    }
  };
  for (const source of Array.isArray(ledgers) ? ledgers : []) {
    if (!source || typeof source !== "object") continue;
    result.runCount += 1;
    for (const key of Object.keys(result.provider)) {
      result.provider[key] += integer(source.provider?.[key]);
    }
    for (const key of Object.keys(result.estimated)) {
      result.estimated[key] += integer(source.estimated?.[key]);
    }
    for (const key of Object.keys(result.compaction)) {
      result.compaction[key] += integer(source.compaction?.[key]);
    }
    result.tools.definitionCount = Math.max(
      result.tools.definitionCount,
      integer(source.tools?.definitionCount)
    );
    result.tools.callCount += integer(source.tools?.callCount);
    result.tools.resultCount += integer(source.tools?.resultCount);
    result.tools.cacheReuseCount += integer(source.tools?.cacheReuseCount);
  }
  return result;
}

export function sanitizeTokenLedgerSnapshot(source) {
  if (!source || typeof source !== "object") return null;
  const provider = emptyProviderTotals();
  const estimated = emptyEstimatedTotals();
  const compaction = {
    count: 0,
    beforeTokens: 0,
    afterTokens: 0,
    removedTokens: 0,
    removedMessages: 0
  };
  const tools = {
    definitionCount: 0,
    callCount: 0,
    resultCount: 0,
    cacheReuseCount: 0
  };
  for (const key of Object.keys(provider)) provider[key] = integer(source.provider?.[key]);
  for (const key of Object.keys(estimated)) estimated[key] = integer(source.estimated?.[key]);
  for (const key of Object.keys(compaction)) compaction[key] = integer(source.compaction?.[key]);
  for (const key of Object.keys(tools)) tools[key] = integer(source.tools?.[key]);
  return {
    version: LEDGER_VERSION,
    runId: String(source.runId ?? "").slice(0, 120),
    goalId: String(source.goalId ?? "").slice(0, 120),
    taskId: String(source.taskId ?? "").slice(0, 120),
    providerId: String(source.providerId ?? "").slice(0, 120),
    modelId: String(source.modelId ?? "").slice(0, 200),
    startedAt: integer(source.startedAt),
    updatedAt: integer(source.updatedAt),
    context: normalizedContextBreakdown({ budget: source.context ?? {} }),
    provider,
    estimated,
    compaction,
    tools,
    entries: (Array.isArray(source.entries) ? source.entries : [])
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        type: String(entry.type ?? "").slice(0, 80),
        phase: String(entry.phase ?? "").slice(0, 80),
        toolName: String(entry.toolName ?? "").slice(0, 100),
        status: String(entry.status ?? "").slice(0, 80),
        callId: String(entry.callId ?? "").slice(0, 160),
        stepNumber: integer(entry.stepNumber, 100000),
        estimatedTokens: integer(entry.estimatedTokens),
        argumentTokens: integer(entry.argumentTokens),
        resultTokens: integer(entry.resultTokens),
        beforeTokens: integer(entry.beforeTokens),
        afterTokens: integer(entry.afterTokens),
        removedTokens: integer(entry.removedTokens),
        removedMessages: integer(entry.removedMessages),
        count: integer(entry.count),
        cacheReused: entry.cacheReused === true,
        usage: entry.usage ? normalizeProviderUsage(entry.usage) : undefined,
        at: integer(entry.at)
      }))
      .slice(-ENTRY_LIMIT)
  };
}
