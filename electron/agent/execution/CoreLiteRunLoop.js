import {
  createFallbackFinalSummary,
  shouldRunFinalization
} from "../finalization.js";

import {
  isGracefulRunBoundary,
  RUN_STOP_REASONS
} from "../runStopReasons.js";

import {
  resolveRunOutcome
} from "../RunOutcomeResolver.js";

import {
  RUN_OUTCOMES
} from "../RunStateMachine.js";

import {
  reconcileFinalResponse
} from "../finalization/CompletionEvidenceGate.js";

function text(value) {
  return String(value ?? "").trim();
}

function terminalBoundary(
  stopReason,
  source,
  decision = "checkpoint"
) {
  return {
    decision,
    stopReason,
    source,
    runUnit: null,
    execution: null,
    runOutcome: null,
    records: []
  };
}

export class CoreLiteRunLoop {
  constructor({
    session = null,
    runId = session?.runId,
    objective = session?.objective ?? "",
    runDeadline,
    signal = session?.abortController?.signal,
    isActive = () => true,
    now = () => Date.now(),
    finalizationPolicy = shouldRunFinalization,
    fallbackFactory = createFallbackFinalSummary,
    outcomeResolver = resolveRunOutcome,
    gracefulBoundary = isGracefulRunBoundary
  } = {}) {
    if (!String(runId ?? "").trim()) {
      throw new Error("CoreLiteRunLoop requires runId.");
    }

    this.session = session;
    this.runId = String(runId);
    this.objective = String(objective ?? "").trim();
    this.runDeadline =
      Number(runDeadline) || Number.POSITIVE_INFINITY;
    this.signal = signal;
    this.isActive = isActive;
    this.now = now;
    this.finalizationPolicy = finalizationPolicy;
    this.fallbackFactory = fallbackFactory;
    this.outcomeResolver = outcomeResolver;
    this.gracefulBoundary = gracefulBoundary;
  }

  async run({
    getRecords,
    createCheckpoint,
    executeRun,
    onRunStart = () => {},
    onRunComplete = () => {}
  } = {}) {
    if (typeof executeRun !== "function") {
      throw new Error("CoreLiteRunLoop requires executeRun().");
    }

    if (!this.canContinue()) {
      return terminalBoundary(
        RUN_STOP_REASONS.CANCELLED_BY_USER,
        "cancelled",
        "cancelled"
      );
    }

    const remainingRunMs = this.runDeadline - this.now();
    if (remainingRunMs <= 0) {
      return terminalBoundary(
        RUN_STOP_REASONS.AGENT_RUN_TIMEOUT,
        "run_timeout"
      );
    }

    const runUnit = {
      id: `run:${this.runId}`,
      index: 1,
      objective: this.objective
    };

    await onRunStart({
      runUnit,
      remainingRunMs,
      session: this.session
    });

    const execution = await executeRun({
      runUnit,
      remainingRunMs,
      session: this.session
    });

    if (!this.canContinue()) {
      return {
        ...terminalBoundary(
          RUN_STOP_REASONS.CANCELLED_BY_USER,
          "cancelled",
          "cancelled"
        ),
        runUnit,
        execution,
        records:
          execution?.records ?? getRecords?.() ?? []
      };
    }

    const records =
      execution?.records ?? getRecords?.() ?? [];
    const stopReason =
      execution?.executionStopReason ??
      RUN_STOP_REASONS.UNKNOWN;
    const checkpoint = createCheckpoint?.({
      runUnit,
      execution,
      records,
      session: this.session
    }) ?? null;
    const decision = stopReason === RUN_STOP_REASONS.COMPLETED
      ? "complete"
      : "checkpoint";
    const runOutcome = {
      decision,
      stopReason,
      verification: null,
      snapshot: null
    };

    await onRunComplete({
      runUnit,
      execution,
      runOutcome,
      records,
      checkpoint,
      session: this.session
    });

    return {
      ...runOutcome,
      source: "core_lite",
      runUnit,
      execution,
      runOutcome,
      records,
      checkpoint
    };
  }

  async runToCompletion({
    callbacks,
    getFinalText,
    setFinalText,
    appendFinalText = () => {},
    onLoopResult = () => {},
    runFinalization = async () => ({ ok: false })
  } = {}) {
    if (typeof getFinalText !== "function") {
      throw new Error(
        "CoreLiteRunLoop requires getFinalText()."
      );
    }

    if (typeof setFinalText !== "function") {
      throw new Error(
        "CoreLiteRunLoop requires setFinalText()."
      );
    }

    const loopResult = await this.run(callbacks);

    if (loopResult.decision === "cancelled") {
      return {
        cancelled: true,
        loopResult,
        executionStopReason:
          RUN_STOP_REASONS.CANCELLED_BY_USER,
        records: loopResult.records ?? [],
        finalText: text(getFinalText()),
        outcome: RUN_OUTCOMES.CANCELLED
      };
    }

    const records =
      loopResult.records ?? callbacks?.getRecords?.() ?? [];

    await onLoopResult({
      loopResult,
      records
    });

    const finishReason =
      loopResult.execution?.finishReason ?? "unknown";
    const executionStopReason =
      loopResult.stopReason ?? RUN_STOP_REASONS.UNKNOWN;

    if (
      this.finalizationPolicy({
        finalText: getFinalText(),
        records,
        finishReason,
        stopReason: executionStopReason
      })
    ) {
      await runFinalization({
        records,
        finishReason,
        executionStopReason,
        loopResult
      });
    }

    let finalText = text(getFinalText());

    if (!finalText) {
      finalText = text(
        this.fallbackFactory({
          records,
          executionStopReason
        })
      ) || "当前处理已经结束，但没有生成完整说明。";
      setFinalText(finalText);
      appendFinalText(finalText);
    }

    const resolved = this.outcomeResolver({
      stopReason: executionStopReason,
      records,
      finalText,
      gracefulBoundary: this.gracefulBoundary
    });
    const reconciled = reconcileFinalResponse({
      finalText,
      records,
      outcome: resolved.outcome,
      stopReason: resolved.stopReason
    });
    if (reconciled.text && reconciled.text !== finalText) {
      finalText = reconciled.text;
      setFinalText(finalText);
    }

    return {
      cancelled: false,
      loopResult,
      records,
      finishReason,
      executionStopReason: resolved.stopReason,
      originalExecutionStopReason: executionStopReason,
      finalText,
      outcome: resolved.outcome,
      outcomeResolution: resolved
    };
  }

  canContinue() {
    return (
      this.signal?.aborted !== true &&
      this.isActive()
    );
  }
}
