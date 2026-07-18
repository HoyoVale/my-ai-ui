import {
  RUN_STOP_REASONS
} from "../runStopReasons.js";

function clone(value) {
  return structuredClone(value);
}

function text(value, maxLength = 1200) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function integer(value, fallback, minimum = 1) {
  const normalized = Math.round(Number(value));

  return Number.isFinite(normalized)
    ? Math.max(minimum, normalized)
    : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  }

  return value;
}

function progressSignature(plan = [], records = []) {
  const planState = (Array.isArray(plan) ? plan : [])
    .map((item) => ({
      id: text(item?.id, 80),
      status: text(item?.status, 40),
      reason: text(item?.reason, 240)
    }));
  const usefulTools = (Array.isArray(records) ? records : [])
    .filter((record) =>
      record?.status === "completed" &&
      !["report_progress", "update_plan"].includes(record?.name)
    )
    .map((record) => ({
      name: text(record?.name, 120),
      input: stableValue(record?.input ?? null),
      summary: text(
        record?.result?.summary ?? record?.output?.data?.message,
        360
      ),
      resultId: text(record?.result?.reference?.resultId, 120)
    }));

  return JSON.stringify({ plan: planState, tools: usefulTools });
}

function normalizeStep(step, fallbackNumber) {
  const toolCalls = Array.isArray(step?.toolCalls)
    ? step.toolCalls
    : [];

  return {
    number: integer(step?.stepNumber, fallbackNumber, 0),
    finishReason: text(step?.finishReason, 80),
    toolCalls: toolCalls.map((call) => ({
      id: text(call?.toolCallId ?? call?.id, 120),
      name: text(call?.toolName ?? call?.name, 120)
    })).slice(0, 24)
  };
}

function planState(plan = []) {
  const items = Array.isArray(plan) ? plan : [];

  return {
    unfinished: items.some((item) =>
      ["pending", "in_progress"].includes(item?.status)
    ),
    needsInput: items.some((item) => item?.status === "needs_input"),
    blocked: items.some((item) => item?.status === "blocked")
  };
}

export class LongTaskOrchestrator {
  constructor({
    goalId = "",
    taskId = "",
    runId = "",
    objective = "",
    maxSegmentSteps = 6,
    maxSegments = 6,
    maxNoProgressSegments = 2,
    startedAt = Date.now()
  } = {}) {
    this.goal = {
      id: text(goalId || taskId || runId, 120),
      objective: text(objective, 1200),
      status: "running"
    };
    this.task = {
      id: text(taskId || runId, 120),
      runId: text(runId, 120),
      status: "running",
      stopReason: ""
    };
    this.goal.taskIds = this.task.id ? [this.task.id] : [];
    this.task.segmentIds = [];

    this.limits = {
      maxSegmentSteps: integer(maxSegmentSteps, 6),
      maxSegments: integer(maxSegments, 6),
      maxNoProgressSegments: integer(maxNoProgressSegments, 2)
    };
    this.startedAt = Math.max(0, Number(startedAt) || Date.now());
    this.endedAt = null;
    this.noProgressSegments = 0;
    this.segments = [];
    this.activeSegment = null;
  }

  beginSegment({
    id = "",
    plan = [],
    records = [],
    startedAt = Date.now()
  } = {}) {
    if (this.activeSegment) {
      throw new Error("A task segment is already running.");
    }

    if (this.segments.length >= this.limits.maxSegments) {
      return null;
    }

    const index = this.segments.length + 1;
    const segment = {
      id: text(id, 120) || `${this.task.runId || this.task.id}-segment-${index}`,
      index,
      status: "running",
      startedAt: Math.max(0, Number(startedAt) || Date.now()),
      endedAt: null,
      durationMs: 0,
      stepCount: 0,
      steps: [],
      toolCallIds: [],
      finishReason: "",
      stopReason: "",
      madeProgress: false,
      checkpoint: null,
      baselineSignature: progressSignature(plan, records)
    };
    this.task.segmentIds.push(segment.id);

    this.activeSegment = segment;
    this.segments.push(segment);
    return clone(segment);
  }

  recordStep(step = {}) {
    if (!this.activeSegment) {
      return null;
    }

    const normalized = normalizeStep(
      step,
      this.activeSegment.steps.length
    );
    this.activeSegment.steps.push(normalized);
    this.activeSegment.stepCount = this.activeSegment.steps.length;
    this.activeSegment.toolCallIds.push(
      ...normalized.toolCalls
        .map((call) => call.id)
        .filter(Boolean)
    );

    return clone(normalized);
  }

  completeSegment({
    stopReason = RUN_STOP_REASONS.UNKNOWN,
    finishReason = "",
    plan = [],
    records = [],
    finalText = "",
    checkpoint = null,
    endedAt = Date.now()
  } = {}) {
    if (!this.activeSegment) {
      throw new Error("No task segment is running.");
    }

    const segment = this.activeSegment;
    const end = Math.max(segment.startedAt, Number(endedAt) || Date.now());
    const currentPlanState = planState(plan);
    const madeProgress =
      (stopReason === RUN_STOP_REASONS.COMPLETED && Boolean(text(finalText))) ||
      progressSignature(plan, records) !== segment.baselineSignature;

    segment.status = "completed";
    segment.endedAt = end;
    segment.durationMs = Math.max(0, end - segment.startedAt);
    segment.finishReason = text(finishReason, 80);
    segment.stopReason = text(stopReason, 80);
    segment.madeProgress = madeProgress;
    segment.checkpoint = checkpoint && typeof checkpoint === "object"
      ? {
          phase: text(checkpoint.phase, 40),
          stopReason: text(checkpoint.stopReason, 80),
          counts: clone(checkpoint.counts ?? {}),
          plan: clone(checkpoint.plan ?? [])
        }
      : null;
    segment.toolCallIds = [
      ...new Set([
        ...segment.toolCallIds,
        ...(Array.isArray(records) ? records : [])
          .filter((record) => record?.segmentId === segment.id)
          .map((record) => text(record?.id, 120))
          .filter(Boolean)
      ])
    ];

    this.noProgressSegments = madeProgress
      ? 0
      : this.noProgressSegments + 1;
    this.activeSegment = null;

    let decision = "stop";
    let finalStopReason = stopReason;

    if (currentPlanState.needsInput) {
      finalStopReason = RUN_STOP_REASONS.NEEDS_INPUT;
    } else if (currentPlanState.blocked && !currentPlanState.unfinished) {
      finalStopReason = RUN_STOP_REASONS.BLOCKED;
    } else if (stopReason === RUN_STOP_REASONS.COMPLETED) {
      decision = "complete";
    } else if (
      [
        RUN_STOP_REASONS.AGENT_STEP_LIMIT,
        RUN_STOP_REASONS.PLAN_INCOMPLETE
      ].includes(stopReason)
    ) {
      if (this.segments.length >= this.limits.maxSegments) {
        finalStopReason = RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT;
      } else if (
        this.noProgressSegments >= this.limits.maxNoProgressSegments
      ) {
        finalStopReason = RUN_STOP_REASONS.NO_PROGRESS;
      } else {
        decision = "continue";
      }
    }

    if (decision !== "continue") {
      this.task.stopReason = text(finalStopReason, 80);
      this.task.status = decision === "complete" ? "completed" :
        finalStopReason === RUN_STOP_REASONS.NEEDS_INPUT ? "needs_input" :
          finalStopReason === RUN_STOP_REASONS.BLOCKED ? "blocked" : "failed";
      this.goal.status = this.task.status;
      this.endedAt = end;
    }

    return {
      decision,
      stopReason: finalStopReason,
      madeProgress,
      noProgressSegments: this.noProgressSegments,
      segment: clone(segment),
      snapshot: this.snapshot()
    };
  }

  terminate(
    stopReason = RUN_STOP_REASONS.UNKNOWN,
    endedAt = Date.now()
  ) {
    const end = Math.max(this.startedAt, Number(endedAt) || Date.now());

    if (this.activeSegment) {
      this.activeSegment.status =
        stopReason === RUN_STOP_REASONS.CANCELLED_BY_USER
          ? "cancelled" : "failed";
      this.activeSegment.stopReason = text(stopReason, 80);
      this.activeSegment.endedAt = end;
      this.activeSegment.durationMs = Math.max(
        0,
        end - this.activeSegment.startedAt
      );
      this.activeSegment = null;
    }

    this.task.stopReason = text(stopReason, 80);
    this.task.status =
      stopReason === RUN_STOP_REASONS.CANCELLED_BY_USER
        ? "cancelled"
        : stopReason === RUN_STOP_REASONS.NEEDS_INPUT
          ? "needs_input"
          : stopReason === RUN_STOP_REASONS.BLOCKED
            ? "blocked"
            : "failed";
    this.goal.status = this.task.status;
    this.endedAt = end;

    return this.snapshot();
  }

  currentSegmentId() {
    return this.activeSegment?.id ?? "";
  }

  snapshot({ compact = false } = {}) {
    return {
      version: 1,
      goal: clone(this.goal),
      task: clone(this.task),
      limits: clone(this.limits),
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      currentSegmentId: this.currentSegmentId(),
      segmentCount: this.segments.length,
      noProgressSegments: this.noProgressSegments,
      segments: this.segments.map((segment) => {
        const copy = clone(segment);
        delete copy.baselineSignature;

        if (compact) {
          copy.toolCallIds = copy.toolCallIds.slice(-12);
          copy.steps = copy.steps.map((step) => ({
            number: step.number,
            finishReason: step.finishReason,
            toolCalls: step.toolCalls.slice(0, 4)
          }));
          if (copy.checkpoint) {
            copy.checkpoint = {
              phase: copy.checkpoint.phase,
              stopReason: copy.checkpoint.stopReason,
              counts: copy.checkpoint.counts
            };
          }
        }

        return copy;
      })
    };
  }
}
