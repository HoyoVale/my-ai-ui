import {
  RUN_STOP_REASONS
} from "../runStopReasons.js";

function terminalBoundary(stopReason, source) {
  return {
    decision: "checkpoint",
    stopReason,
    source,
    segment: null,
    segmentOutcome: null
  };
}

export class SegmentExecutionLoop {
  constructor({
    orchestrator,
    runDeadline,
    signal,
    isActive = () => true,
    now = () => Date.now()
  } = {}) {
    if (!orchestrator) {
      throw new Error("SegmentExecutionLoop requires an orchestrator.");
    }

    this.orchestrator = orchestrator;
    this.runDeadline = Number(runDeadline) || Number.POSITIVE_INFINITY;
    this.signal = signal;
    this.isActive = isActive;
    this.now = now;
  }

  async run({
    getPlan,
    getRecords,
    getCompletionContext,
    createCheckpoint,
    executeSegment,
    onSegmentStart = () => {},
    onSegmentComplete = () => {},
    onContinue = () => {}
  } = {}) {
    if (typeof executeSegment !== "function") {
      throw new Error("SegmentExecutionLoop requires executeSegment().");
    }

    while (this.canContinue()) {
      const remainingRunMs = this.runDeadline - this.now();

      if (remainingRunMs <= 0) {
        this.orchestrator.terminate(
          RUN_STOP_REASONS.AGENT_RUN_TIMEOUT
        );
        return terminalBoundary(
          RUN_STOP_REASONS.AGENT_RUN_TIMEOUT,
          "run_timeout"
        );
      }

      const planBefore = getPlan?.() ?? [];
      const recordsBefore = getRecords?.() ?? [];
      const segment = this.orchestrator.beginSegment({
        plan: planBefore,
        records: recordsBefore
      });

      if (!segment) {
        this.orchestrator.terminate(
          RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT
        );
        return terminalBoundary(
          RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT,
          "segment_limit"
        );
      }

      await onSegmentStart({
        segment,
        remainingRunMs
      });

      const execution = await executeSegment({
        segment,
        remainingRunMs
      });

      if (!this.canContinue()) {
        return {
          decision: "cancelled",
          stopReason: RUN_STOP_REASONS.CANCELLED_BY_USER,
          source: "cancelled",
          segment,
          segmentOutcome: null,
          execution
        };
      }

      const plan = execution?.plan ?? getPlan?.() ?? [];
      const records = execution?.records ?? getRecords?.() ?? [];
      const checkpoint = createCheckpoint?.({
        segment,
        execution,
        plan,
        records
      }) ?? null;
      const segmentOutcome = this.orchestrator.completeSegment({
        stopReason:
          execution?.executionStopReason ?? RUN_STOP_REASONS.UNKNOWN,
        finishReason: execution?.finishReason ?? "",
        plan,
        records,
        finalText: execution?.finalText ?? "",
        completionContext: getCompletionContext?.({
          segment,
          execution,
          plan,
          records
        }) ?? {},
        checkpoint
      });
      const committedCheckpoint = checkpoint
        ? {
            ...checkpoint,
            orchestration: segmentOutcome.snapshot
          }
        : null;

      await onSegmentComplete({
        segment,
        execution,
        segmentOutcome,
        plan,
        records,
        checkpoint: committedCheckpoint
      });

      if (segmentOutcome.decision !== "continue") {
        return {
          ...segmentOutcome,
          source: "segment_outcome",
          execution,
          plan,
          records,
          checkpoint: committedCheckpoint
        };
      }

      await onContinue({
        segment,
        execution,
        segmentOutcome,
        plan,
        records,
        checkpoint: committedCheckpoint
      });
    }

    return {
      decision: "cancelled",
      stopReason: RUN_STOP_REASONS.CANCELLED_BY_USER,
      source: "cancelled",
      segment: null,
      segmentOutcome: null
    };
  }

  canContinue() {
    return (
      this.signal?.aborted !== true &&
      this.isActive()
    );
  }
}
