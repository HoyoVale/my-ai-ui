import {
  streamText
} from "ai";

import {
  appendResponseChunk,
  endResponseStream,
  replaceResponseText
} from "../../windows/response/index.js";

import {
  isCancellationRequested,
  throwIfAborted
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

import {
  FinalResponseStream
} from "./FinalResponseStream.js";

import {
  resolveProviderRetry,
  waitForProviderRetry
} from "../ProviderRetryPolicy.js";

import {
  composeTerminalResponse,
  resolveRunTerminalPresentation
} from "../RunTerminalPresentation.js";

function cancellationResolution(run) {
  const savePartial =
    run.runtimePreferences?.saveAbortedReplies !== false;
  const partialContent = savePartial
    ? resolveActiveRunText(run, { trim: true })
    : "";
  const runtimeRecovery =
    run.toolSession?.getRuntimeRecovery?.() ?? null;
  const hasUncertainEffects =
    Number(runtimeRecovery?.unresolvedCount) > 0;
  const executionStopReason = hasUncertainEffects
    ? RUN_STOP_REASONS.INTERRUPTED
    : RUN_STOP_REASONS.CANCELLED_BY_USER;
  const outcome = hasUncertainEffects
    ? recoveryOutcomeFromSnapshot(runtimeRecovery) ||
      RUN_OUTCOMES.UNKNOWN
    : RUN_OUTCOMES.CANCELLED;
  const terminal = resolveRunTerminalPresentation({
    outcome,
    stopReason: executionStopReason,
    resumable: hasUncertainEffects,
    runtimeRecovery
  });

  return {
    runtimeRecovery,
    hasUncertainEffects,
    terminal,
    content: [partialContent, terminal.message]
      .filter(Boolean)
      .join("\n\n"),
    executionStopReason,
    outcome
  };
}

function boundedCancellationWrite(operation, timeoutMs = 2000) {
  let timer = null;
  let operationPromise;

  try {
    operationPromise = Promise.resolve(operation());
  } catch (error) {
    operationPromise = Promise.reject(error);
  }

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        "Cancellation persistence timed out."
      );
      error.code = "CANCELLATION_PERSISTENCE_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([operationPromise, timeoutPromise])
    .finally(() => clearTimeout(timer));
}

async function settleCancellation(runtime, run, {
  runId,
  conversationId
}) {
  const settlementClaim = run.beginSettlement?.("cancelled");
  if (settlementClaim && settlementClaim.accepted === false) {
    return settlementClaim.promise;
  }

  const resolution = cancellationResolution(run);
  const checkpoint = runtime.buildActiveCheckpoint();
  const writes = [];

  if (checkpoint) {
    writes.push(
      boundedCancellationWrite(() =>
        run.toolSession?.storeRuntimeCheckpoint?.(
          checkpoint,
          {
            runId,
            scopeId: run.currentRunUnitId
          }
        )
      )
    );
  }

  writes.push(
    boundedCancellationWrite(() =>
      run.toolSession?.recordRuntimeEvent?.(
        resolution.hasUncertainEffects
          ? "RUN_INTERRUPTED"
          : "RUN_CANCELLED",
        {
          outcome: resolution.hasUncertainEffects
            ? "interrupted"
            : "cancelled",
          stopReason: resolution.executionStopReason,
          unresolvedTools:
            resolution.runtimeRecovery?.unresolvedCount ?? 0,
          runtimeFlavor: "core-lite"
        },
        { runId }
      )
    )
  );

  const writeResults = await Promise.allSettled(writes);
  for (const result of writeResults) {
    if (result.status === "rejected") {
      console.warn(
        "记录取消终态失败，将继续完成本地收尾：",
        result.reason
      );
    }
  }

  if (!runtime.isCurrentRun(runId) || runtime.activeRun !== run) {
    return null;
  }

  return runtime.finalizeRun({
    runId,
    conversationId,
    executionStopReason: resolution.executionStopReason,
    outcome: resolution.outcome,
    content: resolution.content,
    settlementClaim
  });
}

export const agentRunFinalization = {
  async finalizeRun({
    runId,
    conversationId,
    executionStopReason,
    outcome,
    content = "",
    lastError = "",
    error = null,
    providerClassification = null,
    closeResponse = true,
    settlementClaim = null
  } = {}) {
    if (!this.isCurrentRun(runId)) {
      return null;
    }

    const run = this.activeRun;
    const settlement = settlementClaim ?? run.beginSettlement?.(
      `finalize:${String(outcome || "unknown")}`
    );
    if (settlement && settlement.accepted === false) {
      return settlement.promise;
    }
    const settlementToken = settlement?.token ?? null;

    try {
      run.approvalController?.close?.();
      const toolSessionQuiesced = await run.toolSession?.quiesce?.(
        `terminal:${String(outcome || "unknown")}`
      );
      if (toolSessionQuiesced === false) {
        console.warn(
          "Tool Session 未能在收尾前完全静止，将按恢复状态结束运行。"
        );
      }

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
        run.cancellation?.requested === true
      ) {
        effectiveOutcome = RUN_OUTCOMES.CANCELLED;
        effectiveStopReason = RUN_STOP_REASONS.CANCELLED_BY_USER;
      }

      if (
        !recoveryOutcome &&
        effectiveOutcome === RUN_OUTCOMES.COMPLETED
      ) {
        const guardedResolution = resolveRunOutcome({
          stopReason: effectiveStopReason,
          records: rawRecords,
          finalText: content
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

      const terminal = resolveRunTerminalPresentation({
        outcome: state.outcome,
        stopReason: state.executionStopReason,
        resumable: state.resumable,
        records: run.toolCalls,
        runtimeRecovery,
        providerClassification:
          providerClassification ?? error?.providerClassification ?? null,
        finalizationFailure: run.finalizationFailure
      });
      run.terminal = terminal;
      const terminalContent = composeTerminalResponse(
        sanitizePublicAssistantText(content),
        terminal
      );

      const reconciledFinal = reconcileFinalResponse({
        finalText: terminalContent,
        records: run.toolCalls,
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

      replaceResponseText(run.finalText);

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
          resumable: state.resumable,
          terminal
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
        runResumable: state.resumable,
        runTerminal: terminal
      });

      this.setStatus({
        state: state.runtimeState,
        runId,
        conversationId,
        startedAt: run.startedAt,
        lastError: state.lastError || null,
        stopReason: state.executionStopReason,
        outcome: state.outcome,
        resumable: state.resumable,
        terminal
      }, { immediate: true });

      if (closeResponse) {
        endResponseStream();
      }

      const finalState = { ...state, terminal };
      if (
        state.outcome === RUN_OUTCOMES.CANCELLED ||
        run.cancellation?.requested === true
      ) {
        run.markCancellationSettled?.(state.endedAt);
      }

      const cleanupResults = await run.disposeResources?.(
        `terminal:${terminal.code}`
      ) ?? [];
      for (const cleanup of cleanupResults) {
        if (cleanup.ok === false) {
          console.warn(
            `清理运行资源失败（${cleanup.name}）：`,
            cleanup.error
          );
        }
      }

      if (this.activeRun === run) {
        this.activeRun = null;
      }
      this.setStatus({
        state: state.runtimeState,
        runId: null,
        conversationId,
        startedAt: null,
        lastError: state.lastError || null,
        stopReason: state.executionStopReason,
        outcome: state.outcome,
        resumable: state.resumable,
        terminal
      }, { immediate: true });

      run.lifecycle?.completeSettlement(
        settlementToken,
        finalState
      );
      return finalState;
    } catch (finalizationError) {
      console.error("Agent Run 收尾失败：", finalizationError);
      const fallbackState = {
        phase: "failed",
        outcome: RUN_OUTCOMES.FAILED,
        executionStopReason: RUN_STOP_REASONS.MODEL_ERROR,
        runtimeState: "error",
        messageStatus: "failed",
        activityStatus: "failed",
        resumable: false,
        endedAt: Date.now(),
        lastError: String(
          finalizationError?.message ?? "运行收尾失败。"
        ),
        terminal: resolveRunTerminalPresentation({
          outcome: RUN_OUTCOMES.FAILED,
          stopReason: RUN_STOP_REASONS.MODEL_ERROR,
          resumable: false
        })
      };
      run.terminal = fallbackState.terminal;
      run.finalText = composeTerminalResponse(
        sanitizePublicAssistantText(content),
        fallbackState.terminal
      ) || fallbackState.terminal.message;
      replaceResponseText(run.finalText);
      run.activityStore?.finalize(
        fallbackState.executionStopReason,
        fallbackState.endedAt,
        {
          status: fallbackState.activityStatus,
          outcome: fallbackState.outcome,
          resumable: false,
          terminal: fallbackState.terminal
        }
      );
      try {
        this.persistAssistantResponse({
          conversationId,
          content: run.finalText,
          status: fallbackState.messageStatus,
          runOutcome: fallbackState.outcome,
          runPhase: fallbackState.phase,
          runResumable: false,
          runTerminal: fallbackState.terminal
        });
      } catch (persistenceError) {
        console.error(
          "持久化收尾失败状态失败：",
          persistenceError
        );
      }
      await run.disposeResources?.("finalization-error");
      if (this.activeRun === run) {
        this.activeRun = null;
      }
      if (closeResponse) {
        endResponseStream();
      }
      this.setStatus({
        state: "error",
        runId: null,
        conversationId,
        startedAt: null,
        lastError: fallbackState.lastError,
        stopReason: fallbackState.executionStopReason,
        outcome: fallbackState.outcome,
        resumable: false,
        terminal: fallbackState.terminal
      }, { immediate: true });
      run.lifecycle?.completeSettlement(
        settlementToken,
        fallbackState
      );
      return fallbackState;
    }
  },

  async finishCancelledRun({
    runId,
    conversationId
  }) {
    if (!this.isCurrentRun(runId)) {
      return null;
    }

    const run = this.activeRun;
    run.requestCancellation?.(
      run.abortController?.signal?.reason ?? "user-stop"
    );

    if (!run.cancellationCompletion) {
      run.cancellationCompletion = settleCancellation(
        this,
        run,
        { runId, conversationId }
      );
    }

    return run.cancellationCompletion;
  },

  async runFinalization({
    runId,
    context,
    runtime,
    modelSettings,
    settings,
    records,
    executionStopReason,
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
      records,
      executionStopReason
    });
    const finalStream = new FinalResponseStream({
      isActive: () => this.isCurrentRun(runId),
      onAppend: (chunk) => {
        appendResponseChunk(chunk);
      },
      onReplace: (text) => {
        replaceResponseText(text);
      },
      onText: (text) => {
        if (!this.isCurrentRun(runId)) {
          return;
        }
        this.activeRun.finalText = text;
        this.setStatus(
          { ...this.status },
          { immediate: text === "" }
        );
      }
    });

    for (
      let attempt = 1;
      attempt <= maxAttempts;
      attempt += 1
    ) {
      if (abortController.signal.aborted) {
        throwIfAborted(abortController.signal);
      }
      if (!this.isCurrentRun(runId)) {
        return {
          ok: false,
          text: "",
          aborted: true
        };
      }

      this.activeRun.finalizationAttemptCount = attempt;
      this.activeRun.currentStepText = "";
      this.activeRun.liveStepRole = LIVE_STEP_ROLES.NONE;
      finalStream.reset();

      let text = "";
      const remainingFinalizationMs =
        finalizationBudget.remainingMs();
      if (remainingFinalizationMs <= 0) {
        break;
      }

      try {
        throwIfAborted(abortController.signal);
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
          maxRetries: 0,
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
          throwIfAborted(abortController.signal);
          if (!this.isCurrentRun(runId)) {
            break;
          }
          if (textPart) {
            const publicChunk =
              publicStream.push(textPart);
            if (publicChunk) {
              text += publicChunk;
              finalStream.append(publicChunk);
            }
          }
        }
        throwIfAborted(abortController.signal);
        const finalPublicChunk = publicStream.flush();
        if (finalPublicChunk) {
          text += finalPublicChunk;
          finalStream.append(finalPublicChunk);
        }

        throwIfAborted(abortController.signal);
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
        const cancellationRequested = isCancellationRequested(
          this.activeRun,
          abortController.signal
        );
        if (cancellationRequested) {
          throw error;
        }

        const classification = this.noteProviderFailure(runtime, error, {
          cancellationRequested
        });
        this.activeRun.finalizationFailure = {
          code: classification.code,
          category: classification.category,
          message: classification.message
        };
        const decision = resolveProviderRetry({
          error,
          attempt,
          maxRetries: Math.max(0, maxAttempts - 1),
          cancellationRequested,
          publicOutputStarted: Boolean(text),
          toolActivityStarted: false,
          allowAfterOutput: true,
          remainingMs: finalizationBudget.remainingMs()
        });

        if (!decision.retry) {
          console.warn(
            `最终总结第 ${attempt} 次尝试失败，将使用本地兜底：`,
            classification.code,
            classification.message
          );
          break;
        }

        this.activeRun.activityStore?.recordProgress({
          title: `最终回复生成失败，正在进行第 ${decision.nextAttempt} 次尝试`,
          status: "retrying"
        });
        console.warn(
          `最终总结第 ${attempt} 次尝试失败，将在 ${decision.delayMs}ms 后重试：`,
          classification.code
        );
        await waitForProviderRetry(
          decision.delayMs,
          abortController.signal
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
          finalText: normalized
        });
        const reconciled = reconcileFinalResponse({
          finalText: normalized,
          records,
          diffSummary:
            this.activeRun?.diffTracker?.snapshot?.() ?? null,
          outcome: resolution.outcome,
          stopReason: resolution.stopReason
        });
        const publicText =
          reconciled.text || normalized;

        this.noteProviderSuccess(runtime);
        this.activeRun.finalizationFailure = null;
        this.activeRun.currentStepText = "";
        finalStream.commit(publicText);

        return {
          ok: true,
          text: publicText,
          attempts: attempt,
          evidenceReconciled: reconciled.changed
        };
      }
    }

    const fallback = createFallbackFinalSummary({
      records,
      executionStopReason
    });
    const fallbackResolution = resolveRunOutcome({
      stopReason: executionStopReason,
      records,
      finalText: fallback
    });
    const reconciledFallback = reconcileFinalResponse({
      finalText: fallback,
      records,
      diffSummary:
        this.activeRun?.diffTracker?.snapshot?.() ?? null,
      outcome: fallbackResolution.outcome,
      stopReason: fallbackResolution.stopReason
    });
    const publicFallback =
      reconciledFallback.text || fallback;

    this.activeRun.currentStepText = "";
    finalStream.commit(publicFallback);

    return {
      ok: Boolean(publicFallback),
      text: publicFallback,
      attempts: maxAttempts,
      fallback: true
    };
  }
};
