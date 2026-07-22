import {
  streamText
} from "ai";

import {
  conversationManager
} from "../../conversation/index.js";

import {
  platformKernel
} from "../../platform/index.js";

import {
  appendResponseChunk,
  endResponseStream
} from "../../windows/response/index.js";

import {
  isAbortError
} from "../agentErrors.js";

import {
  RUN_STOP_REASONS,
  isRecoverableRunFailure
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
    const runtimeRecovery = run.toolSession
      ?.getRuntimeRecovery?.() ?? null;
    const recoveryOutcome = recoveryOutcomeFromSnapshot(
      runtimeRecovery
    );
    const effectiveOutcome = recoveryOutcome || outcome;
    const effectiveStopReason = recoveryOutcome
      ? RUN_STOP_REASONS.INTERRUPTED
      : executionStopReason;

    if (run.platformRunId) {
      const platformStatus = effectiveOutcome === RUN_OUTCOMES.CANCELLED
        ? "cancelled"
        : effectiveOutcome === RUN_OUTCOMES.FAILED
          ? "failed"
          : effectiveOutcome === RUN_OUTCOMES.COMPLETED
            ? "completed"
            : "interrupted";
      const platformTaskStatus = platformStatus === "completed"
        ? "continuable"
        : platformStatus === "interrupted"
          ? "continuable"
          : platformStatus;
      platformKernel.finishAgentRun(
        run.platformRunId,
        run.runId,
        {
          status: platformStatus,
          outcome: effectiveOutcome,
          stopReason: effectiveStopReason,
          error: lastError,
          taskStatus: platformTaskStatus
        }
      );
      const currentPlatformRun = platformKernel.getRun(run.platformRunId);
      if (currentPlatformRun && currentPlatformRun.status !== "completed") {
        platformKernel.setRunStatus(
          run.platformRunId,
          platformStatus === "cancelled"
            ? "cancelled"
            : platformStatus === "failed"
              ? "failed"
              : "continuable",
          effectiveStopReason
        );
      }
    }
    const state = this.applyRunState(
      run.stateMachine.finalize({
        executionStopReason: effectiveStopReason,
        outcome: effectiveOutcome,
        lastError
      })
    );

    const orchestration =
      run.orchestrator?.snapshot?.();
    if (
      orchestration?.task?.status === "running" &&
      state.outcome !== RUN_OUTCOMES.COMPLETED
    ) {
      run.orchestrator.terminate(
        state.executionStopReason
      );
    }

    run.finalText = sanitizePublicAssistantText(content);
    if (!run.finalText) {
      run.finalText = "当前处理已经结束，但模型没有生成可公开显示的总结。";
    }
    if (run.skillRun) {
      const skillStatus = state.outcome === RUN_OUTCOMES.COMPLETED
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
        selectedToolNames: run.skillRun.selectedToolNames,
        missingRequired: run.skillRun.missingRequired
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
    run.activityStore?.updateCheckpoint(
      finalCheckpoint
    );
    if (run.persistentGoalId) {
      if (finalCheckpoint) {
        conversationManager.recordGoalCheckpoint({
          conversationId,
          goalId: run.persistentGoalId,
          checkpoint: finalCheckpoint
        });
      }
      conversationManager.recordGoalTokenUsage?.({
        conversationId,
        goalId: run.persistentGoalId,
        ledger: run.tokenLedger?.snapshot?.() ?? null
      });
      conversationManager.finishGoalRun({
        conversationId,
        goalId: run.persistentGoalId,
        runId,
        outcome: state.outcome,
        stopReason: state.executionStopReason,
        error: state.lastError,
        recoverable: isRecoverableRunFailure({
          stopReason: state.executionStopReason,
          records: run.toolSession?.getRecords?.() ?? run.toolCalls ?? []
        })
      });
    }

    const persistedFinalMessage = this.persistAssistantResponse({
      conversationId,
      content: run.finalText,
      status: state.messageStatus
    });
    conversationManager.finishExecutionThread?.({
      conversationId,
      threadId: run.executionThreadId,
      outcome: state.outcome,
      stopReason: state.executionStopReason,
      checkpoint: finalCheckpoint,
      planState: finalCheckpoint?.planState ?? null,
      workingState: finalCheckpoint?.workingState ?? null,
      lastAssistantMessageId:
        persistedFinalMessage?.message?.id ??
        persistedFinalMessage?.id ??
        run.replaceMessageId ?? "",
      resumable: state.resumable
    });
    run.approvalController?.close?.();
    const closePersistence =
      run.toolSession
        ?.closePersistence?.();

    if (closePersistence) {
      void Promise.resolve(
        closePersistence
      )
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

    /*
     * Response 窗口需要在 activeRun 被释放前收到最后一份结构化快照。
     * 否则错误兜底或本地总结只存在于旧的文本流中，工具活动与最终回复
     * 无法分区渲染。
     */
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

    const finalState = {
      ...state
    };
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
        ?.storeRuntimeCheckpoint?.(checkpoint, {
          runId,
          segmentId: this.activeRun.currentSegmentId
        });
    }
    await this.activeRun.toolSession
      ?.recordRuntimeEvent?.(
        hasUncertainEffects ? "RUN_INTERRUPTED" : "RUN_CANCELLED",
        {
          outcome: hasUncertainEffects ? "interrupted" : "cancelled",
          unresolvedTools: runtimeRecovery?.unresolvedCount ?? 0
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
        ? recoveryOutcomeFromSnapshot(runtimeRecovery) || RUN_OUTCOMES.UNKNOWN
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
    plan,
    executionStopReason,
    goalVerification = null,
    abortController
  }) {
    const maxAttempts =
      settings.tools
        ?.runtime
        ?.maxFinalizationAttempts ??
      1;
    const finalizationTimeoutMs =
      settings.tools
        ?.runtime
        ?.finalizationTimeoutMs ??
      30000;
    const finalizationBudget =
      createFinalizationBudget({
        timeoutMs: finalizationTimeoutMs
      });

    this.beginRunFinalization(
      executionStopReason
    );
    this.activeRun.currentStepText =
      "";
    this.activeRun.liveStepRole =
      LIVE_STEP_ROLES.NONE;
    this.persistActiveRunCheckpoint({
      status: "running"
    });

    this.setStatus({
      ...this.status
    });

    const instruction =
      createFinalizationInstruction({
        plan,
        records,
        executionStopReason,
        goalVerification
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

      this.activeRun
        .finalizationAttemptCount =
        attempt;
      this.activeRun.currentStepText =
        "";
      this.activeRun.liveStepRole =
        LIVE_STEP_ROLES.NONE;
      this.activeRun.finalText =
        "";

      this.setStatus({
        ...this.status
      });

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

          messages:
            context.messages,

          ...runtime.requestOptions,

          abortSignal:
            abortController.signal,

          timeout:
            finalizationBudget.timeoutFor(
              modelSettings.timeoutMs
            ),

          onError: ({ error }) => {
            console.error(
              "最终总结流式请求错误：",
              error
            );
          }
        });

        const publicStream = new PublicTextStreamSanitizer();
        for await (
          const textPart
          of result.textStream
        ) {
          if (
            !this.isCurrentRun(runId)
          ) {
            break;
          }

          if (textPart) {
            const publicChunk = publicStream.push(textPart);
            if (!publicChunk) continue;
            const firstFinalChunk = text.length === 0;
            text += publicChunk;
            this.activeRun.finalText = text;

            this.setStatus(
              { ...this.status },
              { immediate: firstFinalChunk }
            );

            appendResponseChunk(publicChunk);
          }
        }
        const finalPublicChunk = publicStream.flush();
        if (finalPublicChunk) {
          text += finalPublicChunk;
          this.activeRun.finalText = text;
          appendResponseChunk(finalPublicChunk);
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

      const normalized =
        sanitizeFinalizationText(
          text,
          executionStopReason
        );

      if (normalized) {
        this.noteProviderSuccess(runtime);
        this.activeRun.finalText =
          normalized;
        this.activeRun
          .currentStepText =
          "";
        this.setStatus({
          ...this.status
        });

        return {
          ok: true,
          text: normalized,
          attempts: attempt
        };
      }
    }

    const fallback =
      createFallbackFinalSummary({
        plan,
        records,
        executionStopReason
      });

    this.activeRun.finalText =
      fallback;
    this.activeRun.currentStepText =
      "";
    if (fallback) {
      appendResponseChunk(
        fallback
      );
    }

    this.setStatus({
      ...this.status
    });

    return {
      ok: Boolean(fallback),
      text: fallback,
      attempts: maxAttempts,
      fallback: true
    };
  }
};
