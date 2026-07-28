import {
  conversationManager
} from "../../conversation/index.js";

import {
  createCoreLiteRunCheckpoint
} from "../CoreLiteCheckpoint.js";

import {
  resolveActiveRunText
} from "../activeRunText.js";

import {
  sanitizePublicAssistantText
} from "../PublicTextSanitizer.js";

import {
  classifyAgentStep,
  LIVE_STEP_ROLES
} from "../stepText.js";

import {
  RUN_STOP_REASONS
} from "../runStopReasons.js";

export const agentRunPersistence = {
  buildActiveCheckpoint() {
    if (!this.activeRun) {
      return null;
    }

    const runtimeCursor = this.activeRun.toolSession
      ?.getRuntimeCursor?.() ?? {};

    return createCoreLiteRunCheckpoint({
      taskId: this.activeRun.taskId,
      workspaceId:
        this.activeRun.workspaceId ?? "",
      workspaceSnapshot:
        this.activeRun.workspaceSnapshot ?? null,
      mode: this.activeRun.mode ?? "chat",
      modelSelection:
        this.activeRun.modelSelection ?? null,
      modelSnapshot:
        this.activeRun.modelSnapshot ?? null,
      skillId:
        this.activeRun.skillRuntime?.skill?.id ?? "",
      skillSnapshot:
        this.activeRun.skillRuntime?.skill ?? null,
      skillIds:
        this.activeRun.skillRuntime?.rootSkillIds ?? [],
      skillSnapshots:
        this.activeRun.skillRuntime?.skills ?? [],
      skillRoutingMode:
        this.activeRun.skillRuntime?.routingMode ?? "manual",
      skillSource:
        this.activeRun.skillRuntime?.source ?? "manual",
      skillRouter:
        this.activeRun.skillRuntime?.router ?? null,
      runId: this.activeRun.runId,
      parentRunId:
        this.activeRun.parentRunId ?? "",
      messageId:
        this.activeRun.replaceMessageId ?? "",
      resumedFromMessageId:
        this.activeRun.resumedFromMessageId ?? "",
      objective:
        this.activeRun.objective ?? "",
      phase:
        this.activeRun.phase ?? "executing",
      outcome:
        this.activeRun.outcome ?? "running",
      resumable:
        this.activeRun.resumable === true,
      publicStatus:
        this.activeRun.publicStatus ?? "running",
      records:
        this.activeRun.toolSession?.getRecords?.() ??
        this.activeRun.toolCalls ?? [],
      stopReason:
        this.activeRun.stopReason ?? "",
      contextCompactions:
        this.activeRun.contextCompactionCount ?? 0,
      continuationCount:
        this.activeRun.continuationCount ?? 0,
      toolRuntime:
        this.activeRun.toolSession
          ?.getRuntimeRecovery?.() ?? null,
      reportedReceiptIds:
        this.activeRun.reportedReceiptIds ?? [],
      partialResponse:
        this.activeRun.cancellation?.requested === true &&
        this.activeRun.runtimePreferences?.saveAbortedReplies === false
          ? ""
          : resolveActiveRunText(this.activeRun),
      partialResponseRole:
        this.activeRun.finalText
          ? "final"
          : this.activeRun.currentStepText
            ? "commentary"
            : "none",
      snapshotSource:
        "core-lite-agent-run-session",
      ...runtimeCursor
    });
  },

  ensureActiveAssistantMessage(
    conversationId
  ) {
    if (!this.activeRun) {
      return null;
    }

    if (this.activeRun.replaceMessageId) {
      this.persistActiveRunCheckpoint({
        status: "running"
      });
      return this.activeRun.replaceMessageId;
    }

    const checkpoint = this.buildActiveCheckpoint();
    this.activeRun.activityStore
      ?.updateCheckpoint(checkpoint);

    const persisted = this.persistAssistantResponse({
      conversationId,
      content: "",
      status: "running"
    });
    const message = persisted?.message ?? persisted;

    if (message?.id) {
      this.activeRun.replaceMessageId = message.id;
      this.activeRun.resumeInPlace = true;

      const updated = this.buildActiveCheckpoint();
      this.activeRun.activityStore
        ?.updateCheckpoint(updated);
      this.persistAssistantResponse({
        conversationId,
        content: "",
        status: "running"
      });
    }

    return this.activeRun.replaceMessageId;
  },

  persistActiveRunCheckpoint({
    status = "running",
    content = undefined
  } = {}) {
    if (
      !this.activeRun ||
      !this.activeRun.replaceMessageId
    ) {
      return null;
    }

    const checkpoint = this.buildActiveCheckpoint();
    this.activeRun.activityStore
      ?.updateCheckpoint(checkpoint);

    return this.persistAssistantResponse({
      conversationId: this.activeRun.conversationId,
      content: content === undefined
        ? resolveActiveRunText(this.activeRun)
        : String(content ?? ""),
      status
    });
  },

  upsertToolRecord(
    runId,
    record
  ) {
    if (!this.isCurrentRun(runId)) {
      return;
    }

    const records = this.activeRun.toolCalls;
    const index = records.findIndex(
      (item) => item.id === record.id
    );

    if (index >= 0) {
      records[index] = {
        ...records[index],
        ...structuredClone(record)
      };
    } else {
      records.push(structuredClone(record));
    }

    this.activeRun.activityStore?.upsertTool(record);

    if ([
      "retrying",
      "completed",
      "failed",
      "cancelled"
    ].includes(record.status)) {
      this.persistActiveRunCheckpoint({
        status: "running"
      });
    }

    this.setStatus({ ...this.status });
  },

  handleStepEnd(
    runId,
    step
  ) {
    if (!this.isCurrentRun(runId)) {
      return;
    }

    const classified = classifyAgentStep(step);
    this.activeRun.stepNumber =
      Number(step?.stepNumber) || 0;

    if (classified.kind === "commentary") {
      this.activeRun.activityStore?.recordCommentary({
        content: classified.text,
        phase: classified.phase,
        objective: classified.objective
      });
    } else if (classified.kind === "final") {
      this.activeRun.activityStore?.closeBatch(
        "completed"
      );
      this.activeRun.finalText = classified.text;
    }

    const providerUsage =
      step?.usage ?? step?.totalUsage ?? {};
    this.activeRun.tokenLedger?.recordProviderUsage(
      providerUsage,
      {
        phase: "execution",
        stepNumber: this.activeRun.stepNumber,
        requestId: String(
          step?.request?.id ?? step?.response?.id ?? ""
        )
      }
    );

    void this.activeRun.toolSession?.recordRuntimeEvent?.(
      "MODEL_STEP_COMPLETED",
      {
        stepNumber: this.activeRun.stepNumber,
        kind: classified.kind,
        hasToolCalls: classified.kind === "commentary"
      },
      {
        runId,
        scopeId: this.activeRun.currentRunUnitId
      }
    );

    this.activeRun.currentStepText = "";
    this.activeRun.liveStepRole = LIVE_STEP_ROLES.NONE;
    this.activeRun.toolSession?.endStep?.(
      `${this.activeRun.currentRunUnitId}:step:${this.activeRun.stepNumber}`
    );

    this.persistActiveRunCheckpoint({
      status: "running"
    });
    this.setStatus({ ...this.status });
  },

  persistAssistantResponse({
    conversationId,
    content,
    status = "complete",
    runOutcome = "",
    runPhase = "",
    runResumable = false,
    runTerminal = null
  }) {
    if (!this.activeRun) {
      return null;
    }

    content = sanitizePublicAssistantText(content);

    const saveToolHistory =
      this.activeRun.runtimePreferences
        ?.saveToolHistory !== false;
    const activitySnapshot =
      this.activeRun.activityStore?.snapshot?.() ?? null;
    const persistedActivity =
      !saveToolHistory && activitySnapshot
        ? {
            ...activitySnapshot,
            events: activitySnapshot.events.filter(
              (event) => event.type !== "tool"
            )
          }
        : activitySnapshot;

    const metadata = {
      durationMs: Math.max(
        1,
        Date.now() - this.activeRun.startedAt
      ),
      toolCalls: saveToolHistory
        ? this.activeRun.toolCalls
        : [],
      stopReason:
        this.activeRun.executionStopReason ??
        (status === "aborted"
          ? RUN_STOP_REASONS.CANCELLED_BY_USER
          : status === "running"
            ? ""
            : RUN_STOP_REASONS.COMPLETED),
      resumedFromMessageId:
        this.activeRun.resumedFromMessageId,
      taskId: this.activeRun.taskId,
      activity: persistedActivity,
      skillRun: this.activeRun.skillRun
        ? structuredClone(this.activeRun.skillRun)
        : null,
      tokenLedger:
        this.activeRun.tokenLedger?.snapshot?.() ?? null,
      diffSummary:
        this.activeRun.diffTracker?.snapshot?.() ?? null,
      runOutcome: String(
        runOutcome ||
        this.activeRun.stateMachine?.snapshot?.().outcome ||
        ""
      ),
      runPhase: String(
        runPhase ||
        this.activeRun.stateMachine?.snapshot?.().phase ||
        ""
      ),
      runResumable: runResumable === true,
      runTerminal:
        runTerminal ?? this.activeRun.terminal ?? null
    };

    if (this.activeRun.replaceMessageId) {
      return conversationManager.replaceAssistantMessage({
        conversationId,
        messageId: this.activeRun.replaceMessageId,
        content,
        status,
        preserveCreatedAt:
          Boolean(this.activeRun.resumeInPlace),
        ...metadata
      });
    }

    return conversationManager.appendMessage({
      conversationId,
      role: "assistant",
      content,
      status,
      ...metadata
    });
  }
};
