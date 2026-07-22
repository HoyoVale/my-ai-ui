import {
  conversationManager
} from "../../conversation/index.js";

import {
  createRunCheckpoint
} from "../runCheckpoint.js";

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

import {
  deriveGoalWorkingState
} from "../AgentRuntimeInternals.js";

export const agentRunPersistence = {
  buildActiveCheckpoint() {
    if (!this.activeRun) {
      return null;
    }

    const runtimeCursor = this.activeRun.toolSession
      ?.getRuntimeCursor?.() ?? {};

    return createRunCheckpoint({
      executionThreadId: this.activeRun.executionThreadId,
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
      goalId: this.activeRun.goalId,
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
      plan:
        this.activeRun.toolSession
          ?.getPlan?.() ??
        this.activeRun.initialPlan ?? [],
      planState:
        this.activeRun.toolSession
          ?.getPlanState?.() ??
        this.activeRun.initialPlanState ??
        this.activeRun.initialPlan ?? [],
      records:
        this.activeRun.toolSession
          ?.getRecords?.() ??
        this.activeRun.toolCalls ?? [],
      stopReason:
        this.activeRun.stopReason ?? "",
      contextCompactions:
        this.activeRun.contextCompactionCount ?? 0,
      continuationCount:
        this.activeRun.continuationCount ?? 0,
      previousSegmentCount:
        this.activeRun.previousSegmentCount ?? 0,
      orchestration:
        this.activeRun.orchestrator
          ?.snapshot?.({ compact: true }) ?? null,
      toolRuntime:
        this.activeRun.toolSession
          ?.getRuntimeRecovery?.() ?? null,
      workingState:
        deriveGoalWorkingState(this.activeRun),
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

    const checkpoint =
      this.buildActiveCheckpoint();
    this.activeRun.activityStore
      ?.updateCheckpoint(checkpoint);

    const persisted =
      this.persistAssistantResponse({
        conversationId,
        content: "",
        status: "running"
      });
    const message =
      persisted?.message ?? persisted;

    if (message?.id) {
      this.activeRun.replaceMessageId =
        message.id;
      this.activeRun.resumeInPlace = true;

      const updated =
        this.buildActiveCheckpoint();
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
    status = "running"
  } = {}) {
    if (
      !this.activeRun ||
      !this.activeRun.replaceMessageId
    ) {
      return null;
    }

    const checkpoint =
      this.buildActiveCheckpoint();
    this.activeRun.activityStore
      ?.updateCheckpoint(checkpoint);

    const persisted = this.persistAssistantResponse({
      conversationId:
        this.activeRun.conversationId,
      content:
        resolveActiveRunText(
          this.activeRun
        ),
      status
    });
    if (this.activeRun.persistentGoalId) {
      conversationManager.recordGoalTokenUsage?.({
        conversationId: this.activeRun.conversationId,
        goalId: this.activeRun.persistentGoalId,
        ledger: this.activeRun.tokenLedger?.snapshot?.() ?? null
      });
    }
    conversationManager.recordExecutionThreadCheckpoint?.({
      conversationId: this.activeRun.conversationId,
      threadId: this.activeRun.executionThreadId,
      checkpoint,
      planState: checkpoint?.planState ?? null,
      workingState: checkpoint?.workingState ?? null,
      runId: this.activeRun.runId
    });
    return persisted;
  },

  upsertToolRecord(
    runId,
    record
  ) {
    if (
      !this.isCurrentRun(runId)
    ) {
      return;
    }

    const records =
      this.activeRun.toolCalls;

    const index =
      records.findIndex(
        (item) =>
          item.id === record.id
      );

    if (index >= 0) {
      records[index] = {
        ...records[index],
        ...structuredClone(record)
      };
    } else {
      records.push(
        structuredClone(record)
      );
    }

    this.activeRun
      .activityStore
      ?.upsertTool(record);

    if (
      [
        "retrying",
        "completed",
        "failed",
        "cancelled"
      ].includes(record.status)
    ) {
      this.persistActiveRunCheckpoint({
        status: "running"
      });
    }

    this.setStatus({
      ...this.status
    });
  },

  handleStepEnd(
    runId,
    step
  ) {
    if (!this.isCurrentRun(runId)) {
      return;
    }

    const classified =
      classifyAgentStep(step);

    this.activeRun.stepNumber =
      Number(step?.stepNumber) || 0;

    this.activeRun.orchestrator
      ?.recordStep(step);

    if (
      classified.kind ===
        "commentary"
    ) {
      this.activeRun
        .activityStore
        ?.recordCommentary({
          content:
            classified.text,
          phase:
            classified.phase,
          objective:
            classified.objective
        });
    } else if (
      classified.kind ===
        "final"
    ) {
      this.activeRun
        .activityStore
        ?.closeBatch(
          "completed"
        );
      this.activeRun.finalText =
        classified.text;
    }

    const providerUsage = step?.usage ?? step?.totalUsage ?? {};
    this.activeRun.tokenLedger?.recordProviderUsage(
      providerUsage,
      {
        phase: "execution",
        stepNumber: this.activeRun.stepNumber,
        requestId: String(step?.request?.id ?? step?.response?.id ?? "")
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
        segmentId: this.activeRun.currentSegmentId
      }
    );

    this.activeRun.currentStepText =
      "";
    this.activeRun.liveStepRole =
      LIVE_STEP_ROLES.NONE;
    this.activeRun.toolSession?.endStep?.(
      `${this.activeRun.currentSegmentId}:step:${this.activeRun.stepNumber}`
    );

    this.persistActiveRunCheckpoint({
      status: "running"
    });

    this.setStatus({
      ...this.status
    });
  },

  persistAssistantResponse({
    conversationId,
    content,
    status = "complete"
  }) {
    if (!this.activeRun) {
      return null;
    }

    content = sanitizePublicAssistantText(content);

    const saveToolHistory =
      this.activeRun.runtimePreferences
        ?.saveToolHistory !== false;
    const activitySnapshot =
      this.activeRun
        .activityStore
        ?.snapshot?.() ?? null;
    const persistedActivity =
      !saveToolHistory &&
      activitySnapshot
        ? {
            ...activitySnapshot,
            events:
              activitySnapshot.events
                .filter(
                  (event) =>
                    event.type !==
                    "tool"
                )
          }
        : activitySnapshot;

    const metadata = {
      durationMs:
        Math.max(
          1,
          Date.now() -
          this.activeRun.startedAt
        ),
      toolCalls:
        saveToolHistory
          ? this.activeRun
              .toolCalls
          : [],
      plan:
        this.activeRun
          .toolSession
          ?.getPlan?.() ??
        this.activeRun
          .initialPlan ?? [],
      planState:
        this.activeRun
          .toolSession
          ?.getPlanState?.() ??
        this.activeRun
          .initialPlanState ??
        this.activeRun
          .initialPlan ?? [],
      stopReason:
        this.activeRun.executionStopReason ??
        (status === "aborted"
          ? RUN_STOP_REASONS.CANCELLED_BY_USER
          : status === "running"
            ? ""
            : RUN_STOP_REASONS.COMPLETED),
      resumedFromMessageId:
        this.activeRun
          .resumedFromMessageId,
      taskId:
        this.activeRun.taskId,
      executionThreadId:
        this.activeRun.executionThreadId,
      activity:
        persistedActivity,
      skillRun:
        this.activeRun.skillRun
          ? structuredClone(this.activeRun.skillRun)
          : null,
      tokenLedger:
        this.activeRun.tokenLedger?.snapshot?.() ?? null,
      diffSummary:
        this.activeRun.diffTracker?.snapshot?.() ?? null
    };

    if (
      this.activeRun
        .replaceMessageId
    ) {
      return conversationManager
        .replaceAssistantMessage({
          conversationId,
          messageId:
            this.activeRun
              .replaceMessageId,
          content,
          status,
          preserveCreatedAt:
            Boolean(
              this.activeRun
                .resumeInPlace
            ),
          ...metadata
        });
    }

    return conversationManager
      .appendMessage({
        conversationId,
        role: "assistant",
        content,
        status,
        ...metadata
      });
  }
};
