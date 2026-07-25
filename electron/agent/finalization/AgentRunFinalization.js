import {
  streamText
} from "ai";

import {
  appendResponseChunk,
  endResponseStream
} from "../../windows/response/index.js";

import {
  isAbortError
} from "../agentErrors.js";

import {
  RUN_STOP_REASONS
} from "../runStopReasons.js";

import {
  LIVE_STEP_ROLES
} from "../stepText.js";

import {
  resolveActiveRunText
} from "../activeRunText.js";

import {
  PublicTextStreamSanitizer,
  sanitizePublicAssistantText
} from "../PublicTextSanitizer.js";

import {
  createFallbackFinalSummary,
  createFinalizationInstruction,
  sanitizeFinalizationText
} from "../finalization.js";

import {
  RUN_OUTCOMES,
  recoveryOutcomeFromSnapshot
} from "../RunStateMachine.js";

import {
  resolveRunOutcome
} from "../RunOutcomeResolver.js";

import {
  reconcileFinalResponse
} from "./CompletionEvidenceGate.js";

import {
  terminalizeToolRecords
} from "./ActivityTerminalizer.js";

import {
  createFinalizationBudget
} from "../finalizationBudget.js";

import {
  settleResultValue
} from "../AgentRuntimeInternals.js";

export const agentRunFinalization = {
  finalizeRun({
    runId,
    conversationId,
    executionStopReason,
    outcome,
    content = "",
    lastError = "",
    closeResponse = true
  } = {}) {
    if (!this.isCurrentRun(runId)) {
      return null;
    }

    const run = this.activeRun;
    const runtimeRecovery =
      run.toolSession?.getRuntimeRecovery?.() ?? null;
    const recoveryOutcome = recoveryOutcomeFromSnapshot(
      runtimeRecovery
    );
    const rawRecords =
      run.toolSession?.getRecords?.() ??
      run.toolCalls ?? [];

    let effectiveOutcome = recoveryOutcome || outcome;
    let effectiveStopReason = recoveryOutcome
      ? RUN_STOP_REASONS.INTERRUPTED
      : executionStopReason;

    if (
      !recoveryOutcome &&
      effectiveOutcome === RUN_OUTCOMES.COMPLETED
    ) {
      const guardedResolution = resolveRunOutcome({
        stopReason: effectiveStopReason,
        records: rawRecords,
        plan: [],
        finalText: content,
        goalVerification: null
      });

      effectiveOutcome = guardedResolution.outcome;
      if (effectiveOutcome !== RUN_OUTCOMES.COMPLETED) {
        if (
          guardedResolution.completionEvidence
            .failures.hasActive
        ) {
          effectiveStopReason = RUN_STOP_REASONS.TOOL_ERROR;
        } else if (
          guardedResolution.completionEvidence
            .openRecordIds.length > 0
        ) {
          effectiveStopReason = RUN_STOP_REASONS.INTERRUPTED;
        } else {
          effectiveStopReason = guardedResolution.stopReason;
        }
      }
    }

    const state = this.applyRunState(
      run.stateMachine.finalize({
        executionStopReason: effectiveStopReason,
        outcome: effectiveOutcome,
        lastError
      })
    );

    run.toolCalls = terminalizeToolRecords(
      rawRecords,
      {
        outcome: state.outcome,
        activityStatus: state.activityStatus,
        endedAt: state.endedAt
      }
    );

    const reconciledFinal = reconcileFinalResponse({
      finalText: sanitizePublicAssistantText(content),
      records: run.toolCalls,
      plan: [],
      goalVerification: null,
      diffSummary: run.diffTracker?.snapshot?.() ?? null,
      outcome: state.outcome,
      stopReason: state.executionStopReason,
      lastError: state.lastError
    });
    run.completionEvidence = reconciledFinal.evidence;
    run.finalText = sanitizePublicAssistantText(
      reconciledFinal.text
    );
    if (!run.finalText) {
      run.finalText =
        "当前处理已经结束，但模型没有生成可公开显示的总结。";
    }

    if (run.skillRun) {
      const skillStatus =
        state.outcome === RUN_OUTCOMES.COMPLETED
          ? "completed"
          : state.outcome === RUN_OUTCOMES.CANCELLED
            ? "cancelled"
            : state.outcome === RUN_OUTCOMES.FAILED
              ? "failed"
              : "interrupted";
      run.skillRun = {
        ...run.skillRun,
        status: skillStatus,
        endedAt: state.endedAt
      };
      run.activityStore?.recordSkill({
        skill: run.skillRuntime.skill,
        skills: run.skillRuntime.skills,
        source: run.skillRuntime.source,
        router: run.skillRuntime.router,
        status: skillStatus,
        selectedToolNames:
          run.skillRun.selectedToolNames,
        missingRequired:
          run.skillRun.missingRequired
      }, state.endedAt);
    }

    run.activityStore?.finalize(
      state.executionStopReason,
      state.endedAt,
      {
        status: state.activityStatus,
        outcome: state.outcome,
        resumable: state.resumable
      }
    );
    const finalCheckpoint = this.buildActiveCheckpoint();
    run.activityStore?.updateCheckpoint(finalCheckpoint);

    this.persistAssistantResponse({
      conversationId,
      content: run.finalText,
      status: state.messageStatus,
      runOutcome: state.outcome,
      runPhase: state.phase,
      runResumable: state.resumable
    });

    run.approvalController?.close?.();
    const closePersistence =
      run.toolSession?.closePersistence?.();
    if (closePersistence) {
      void Promise.resolve(closePersistence)
        .then((closed) => {
          if (closed === false) {
            console.warn(
              "工具事件持久化仍有待写入数据，将在应用退出前重试。"
            );
          }
        })
        .catch((error) => {
          console.warn(
            "关闭工具事件持久化失败：",
            error
          );
        });
    }

    this.setStatus({
      state: state.runtimeState,
      runId,
      conversationId,
      startedAt: run.startedAt,
      lastError: state.lastError || null,
      stopReason: state.executionStopReason,
      outcome: state.outcome,
      resumable: state.resumable
    }, { immediate: true });

    if (closeResponse) {
      endResponseStream();
    }

    const finalState = { ...state };
    this.activeRun = null;
    this.setStatus({
      state: state.runtimeState,
      runId: null,
      conversationId,
      startedAt: null,
      lastError: state.lastError || null,
      stopReason: state.executionStopReason,
      outcome: state.outcome,
      resumable: state.resumable
    }, { immediate: true });

    return finalState;
  },

  async finishCancelledRun({
    runId,
    conversationId
  }) {
    if (!this.isCurrentRun(runId)) {
      return;
    }

    const savePartial =
      this.activeRun.runtimePreferences
        ?.saveAbortedReplies !== false;
    const partialContent = savePartial
      ? resolveActiveRunText(
          this.activeRun,
          { trim: true }
        )
      : "";
    const runtimeRecovery = this.activeRun
      .toolSession
      ?.getRuntimeRecovery?.();
    const hasUncertainEffects =
      Number(runtimeRecovery?.unresolvedCount) > 0;
    const recoveryNotice = hasUncertainEffects
      ? "已停止继续执行，但有工具操作的最终状态尚未确认。请先核验或确认这些操作，再继续任务。"
      : "";
    const content = [
      partialContent,
      recoveryNotice
    ].filter(Boolean).join("\n\n");

    const checkpoint = this.buildActiveCheckpoint();
    if (checkpoint) {
      await this.activeRun.toolSession
        ?.storeRuntimeCheckpoint?.(
          checkpoint,
          {
            runId,
            segmentId:
              this.activeRun.currentSegmentId
          }
        );
    }
    await this.activeRun.toolSession
      ?.recordRuntimeEvent?.(
        hasUncertainEffects
          ? "RUN_INTERRUPTED"
          : "RUN_CANCELLED",
        {
          outcome: hasUncertainEffects
            ? "interrupted"
            : "cancelled",
          unresolvedTools:
            runtimeRecovery?.unresolvedCount ?? 0,
          runtimeFlavor: "core-lite"
        },
        { runId }
      );

    this.finalizeRun({
      runId,
      conversationId,
      executionStopReason: hasUncertainEffects
        ? RUN_STOP_REASONS.INTERRUPTED
        : RUN_STOP_REASONS.CANCELLED_BY_USER,
      outcome: hasUncertainEffects
        ? recoveryOutcomeFromSnapshot(runtimeRecovery) ||
          RUN_OUTCOMES.UNKNOWN
        : RUN_OUTCOMES.CANCELLED,
      content
    });
  },

  async runFinalization({
    runId,
    context,
    runtime,
    modelSettings,
    settings,
    records,
    plan: _plan = [],
    executionStopReason,
    goalVerification: _goalVerification = null,
    abortController
  }) {
    const maxAttempts =
      settings.tools?.runtime?.maxFinalizationAttempts ?? 1;
    const finalizationTimeoutMs =
      settings.tools?.runtime?.finalizationTimeoutMs ?? 30000;
    const finalizationBudget = createFinalizationBudget({
      timeoutMs: finalizationTimeoutMs
    });

    this.beginRunFinalization(executionStopReason);
    this.activeRun.currentStepText = "";
    this.activeRun.liveStepRole = LIVE_STEP_ROLES.NONE;
    this.persistActiveRunCheckpoint({
      status: "running"
    });
    this.setStatus({ ...this.status });

    const instruction = createFinalizationInstruction({
      plan: [],
      records,
      executionStopReason,
      goalVerification: null
    });

    for (
      let attempt = 1;
      attempt <= maxAttempts;
      attempt += 1
    ) {
      if (
        abortController.signal.aborted ||
        !this.isCurrentRun(runId)
      ) {
        return {
          ok: false,
          text: "",
          aborted: true
        };
      }

      this.activeRun.finalizationAttemptCount = attempt;
      this.activeRun.currentStepText = "";
      this.activeRun.liveStepRole = LIVE_STEP_ROLES.NONE;
      this.activeRun.finalText = "";
      this.setStatus({ ...this.status });

      let text = "";
      const remainingFinalizationMs =
        finalizationBudget.remainingMs();
      if (remainingFinalizationMs <= 0) {
        break;
      }

      try {
        this.assertProviderAvailable(runtime);
        const result = streamText({
          model: runtime.model,
          system: [
            context.system,
            instruction,
            attempt > 1
              ? "The previous finalization attempt returned no usable text. Return a concise final answer now."
              : ""
          ].filter(Boolean).join("\n\n"),
          messages: context.messages,
          ...runtime.requestOptions,
          abortSignal: abortController.signal,
          timeout: finalizationBudget.timeoutFor(
            modelSettings.timeoutMs
          ),
          onError: ({ error }) => {
            console.error(
              "最终总结流式请求错误：",
              error
            );
          }
        });

        const publicStream =
          new PublicTextStreamSanitizer();
        for await (const textPart of result.textStream) {
          if (!this.isCurrentRun(runId)) {
            break;
          }
          if (textPart) {
            const publicChunk =
              publicStream.push(textPart);
            if (publicChunk) {
              text += publicChunk;
            }
          }
        }
        const finalPublicChunk = publicStream.flush();
        if (finalPublicChunk) {
          text += finalPublicChunk;
        }

        const finalizationUsage = await settleResultValue(
          result.usage,
          {}
        );
        this.activeRun.tokenLedger?.recordProviderUsage(
          finalizationUsage,
          {
            phase: "finalization",
            stepNumber: attempt
          }
        );
      } catch (error) {
        if (
          abortController.signal.aborted ||
          isAbortError(error)
        ) {
          throw error;
        }

        this.noteProviderFailure(runtime, error);
        console.warn(
          `最终总结第 ${attempt} 次尝试失败，准备使用下一次尝试或本地兜底：`,
          error
        );
        continue;
      }

      const normalized = sanitizeFinalizationText(
        text,
        executionStopReason
      );
      if (normalized) {
        const resolution = resolveRunOutcome({
          stopReason: executionStopReason,
          records,
          plan: [],
          finalText: normalized,
          goalVerification: null
        });
        const reconciled = reconcileFinalResponse({
          finalText: normalized,
          records,
          plan: [],
          goalVerification: null,
          diffSummary:
            this.activeRun?.diffTracker?.snapshot?.() ?? null,
          outcome: resolution.outcome,
          stopReason: resolution.stopReason
        });
        const publicText =
          reconciled.text || normalized;

        this.noteProviderSuccess(runtime);
        this.activeRun.finalText = publicText;
        this.activeRun.currentStepText = "";
        appendResponseChunk(publicText);
        this.setStatus({ ...this.status });

        return {
          ok: true,
          text: publicText,
          attempts: attempt,
          evidenceReconciled: reconciled.changed
        };
      }
    }

    const fallback = createFallbackFinalSummary({
      plan: [],
      records,
      executionStopReason
    });
    const fallbackResolution = resolveRunOutcome({
      stopReason: executionStopReason,
      records,
      plan: [],
      finalText: fallback,
      goalVerification: null
    });
    const reconciledFallback = reconcileFinalResponse({
      finalText: fallback,
      records,
      plan: [],
      goalVerification: null,
      diffSummary:
        this.activeRun?.diffTracker?.snapshot?.() ?? null,
      outcome: fallbackResolution.outcome,
      stopReason: fallbackResolution.stopReason
    });
    const publicFallback =
      reconciledFallback.text || fallback;

    this.activeRun.finalText = publicFallback;
    this.activeRun.currentStepText = "";
    if (publicFallback) {
      appendResponseChunk(publicFallback);
    }
    this.setStatus({ ...this.status });

    return {
      ok: Boolean(publicFallback),
      text: publicFallback,
      attempts: maxAttempts,
      fallback: true
    };
  }
};
