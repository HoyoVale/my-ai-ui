import {
  RUN_STOP_REASONS
} from "../runStopReasons.js";

function terminalBoundary(
  stopReason,
  source,
  decision = "checkpoint"
) {
  return {
    decision,
    stopReason,
    source,
    segment: null,
    segmentOutcome: null,
    plan: [],
    records: []
  };
}

export class CoreLiteRunLoop {
  constructor({
    runId,
    objective = "",
    runDeadline,
    signal,
    isActive = () => true,
    now = () => Date.now()
  } = {}) {
    if (!String(runId ?? "").trim()) {
      throw new Error("CoreLiteRunLoop requires runId.");
    }

    this.runId = String(runId);
    this.objective = String(objective ?? "").trim();
    this.runDeadline =
      Number(runDeadline) || Number.POSITIVE_INFINITY;
    this.signal = signal;
    this.isActive = isActive;
    this.now = now;
  }

  async run({
    getRecords,
    createCheckpoint,
    executeSegment,
    onSegmentStart = () => {},
    onSegmentComplete = () => {}
  } = {}) {
    if (typeof executeSegment !== "function") {
      throw new Error("CoreLiteRunLoop requires executeSegment().");
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

    const segment = {
      id: `run:${this.runId}`,
      index: 1,
      objective: this.objective
    };

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
        ...terminalBoundary(
          RUN_STOP_REASONS.CANCELLED_BY_USER,
          "cancelled",
          "cancelled"
        ),
        segment,
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
      segment,
      execution,
      plan: [],
      records
    }) ?? null;
    const decision = stopReason === RUN_STOP_REASONS.COMPLETED
      ? "complete"
      : "checkpoint";
    const segmentOutcome = {
      decision,
      stopReason,
      verification: null,
      snapshot: null
    };

    await onSegmentComplete({
      segment,
      execution,
      segmentOutcome,
      plan: [],
      records,
      checkpoint
    });

    return {
      ...segmentOutcome,
      source: "core_lite",
      segment,
      execution,
      plan: [],
      records,
      checkpoint
    };
  }

  canContinue() {
    return (
      this.signal?.aborted !== true &&
      this.isActive()
    );
  }
}
