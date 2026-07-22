import {
  createFallbackFinalSummary,
  shouldRunFinalization
} from "./finalization.js";

import {
  isGracefulRunBoundary,
  RUN_STOP_REASONS
} from "./runStopReasons.js";

import {
  resolveRunOutcome
} from "./RunOutcomeResolver.js";

import {
  RUN_OUTCOMES
} from "./RunStateMachine.js";

function text(value) {
  return String(value ?? "").trim();
}

export class RunEngine {
  constructor({
    segmentLoop,
    finalizationPolicy = shouldRunFinalization,
    fallbackFactory = createFallbackFinalSummary,
    outcomeResolver = resolveRunOutcome,
    gracefulBoundary = isGracefulRunBoundary
  } = {}) {
    if (!segmentLoop) {
      throw new Error("RunEngine requires a segment loop.");
    }

    this.segmentLoop = segmentLoop;
    this.finalizationPolicy = finalizationPolicy;
    this.fallbackFactory = fallbackFactory;
    this.outcomeResolver = outcomeResolver;
    this.gracefulBoundary = gracefulBoundary;
  }

  async run({
    segmentCallbacks,
    getFinalText,
    setFinalText,
    appendFinalText = () => {},
    onLoopResult = () => {},
    runFinalization = async () => ({ ok: false })
  } = {}) {
    if (typeof getFinalText !== "function") {
      throw new Error("RunEngine requires getFinalText().");
    }

    if (typeof setFinalText !== "function") {
      throw new Error("RunEngine requires setFinalText().");
    }

    const loopResult = await this.segmentLoop.run(
      segmentCallbacks
    );

    if (loopResult.decision === "cancelled") {
      return {
        cancelled: true,
        loopResult,
        executionStopReason:
          RUN_STOP_REASONS.CANCELLED_BY_USER,
        records: loopResult.records ?? [],
        plan: loopResult.plan ?? [],
        finalText: text(getFinalText()),
        outcome: RUN_OUTCOMES.CANCELLED
      };
    }

    const records =
      loopResult.records ??
      segmentCallbacks?.getRecords?.() ??
      [];
    const plan =
      loopResult.plan ??
      segmentCallbacks?.getPlan?.() ??
      [];

    await onLoopResult({
      loopResult,
      records,
      plan
    });
    const finishReason =
      loopResult.execution?.finishReason ?? "unknown";
    const executionStopReason =
      loopResult.stopReason ?? RUN_STOP_REASONS.UNKNOWN;

    if (
      this.finalizationPolicy({
        finalText: getFinalText(),
        plan,
        records,
        finishReason,
        stopReason: executionStopReason
      })
    ) {
      await runFinalization({
        records,
        plan,
        finishReason,
        executionStopReason,
        loopResult,
        goalVerification: loopResult.verification ?? null
      });
    }

    let finalText = text(getFinalText());

    if (!finalText) {
      finalText = text(
        this.fallbackFactory({
          plan,
          records,
          executionStopReason,
          goalVerification: loopResult.verification ?? null
        })
      ) || "当前处理已经结束，但没有生成完整说明。";
      setFinalText(finalText);
      appendFinalText(finalText);
    }

    const resolved = this.outcomeResolver({
      stopReason: executionStopReason,
      records,
      plan,
      finalText,
      goalVerification: loopResult.verification ?? null,
      gracefulBoundary: this.gracefulBoundary
    });

    return {
      cancelled: false,
      loopResult,
      records,
      plan,
      finishReason,
      executionStopReason: resolved.stopReason,
      originalExecutionStopReason: executionStopReason,
      finalText,
      outcome: resolved.outcome,
      outcomeResolution: resolved
    };
  }
}
