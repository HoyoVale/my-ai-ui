import {
  stepCountIs,
  streamText
} from "ai";

import {
  getSettings
} from "../../settings/settingsStore.js";

import {
  buildCapabilityContext
} from "../../context/capabilityContextBuilder.js";

import {
  renderPromptSections
} from "../../context/promptSections.js";

import {
  resolveActiveModelSettings
} from "../../settings/modelSettings.js";

import {
  appendResponseChunk,
  startResponseStream
} from "../../windows/response/index.js";

import {
  createModelRuntime
} from "../modelFactory.js";

import {
  formatAgentError,
  isAbortError
} from "../agentErrors.js";

import {
  getE2EToolWriteRequest,
  streamE2EResponse
} from "../e2eAgentDriver.js";

import {
  createAgentToolSession
} from "../../tools/createAgentToolSession.js";

import {
  mcpClientManager
} from "../../mcp/index.js";

import {
  declarativeHttpToolManager
} from "../../custom-tools/index.js";

import {
  inferRunStopReason,
  RUN_STOP_REASONS
} from "../runStopReasons.js";

import {
  inferLiveStepRole
} from "../stepText.js";

import {
  compactRunStepContext
} from "../contextCompaction.js";

import {
  PublicTextStreamSanitizer
} from "../PublicTextSanitizer.js";

import {
  hasActiveToolFailures
} from "../ToolErrorClassifier.js";

import {
  createFallbackFinalSummary
} from "../finalization.js";

import {
  RUN_OUTCOMES
} from "../RunStateMachine.js";

import {
  createAgentStreamTimeout
} from "../agentStreamTimeout.js";

import {
  CoreLiteRunLoop
} from "./CoreLiteRunLoop.js";

import {
  getTaskResultDirectory,
  settleResultValue
} from "../AgentRuntimeInternals.js";

function resolveRunInvocation(runtime, options = {}) {
  const session = options.session ?? runtime.activeRun;
  const runId = String(
    session?.runId ?? options.runId ?? ""
  ).trim();
  const conversationId = String(
    session?.conversationId ?? options.conversationId ?? ""
  ).trim();
  const abortController =
    session?.abortController ?? options.abortController;

  if (!session || !runId || !conversationId || !abortController) {
    const error = new Error(
      "Core Lite execution requires an active AgentRunSession."
    );
    error.code = "AGENT_RUN_SESSION_REQUIRED";
    throw error;
  }

  return {
    session,
    runId,
    conversationId,
    abortController
  };
}

function runtimeFinishEvent(outcome) {
  if (outcome === RUN_OUTCOMES.COMPLETED) {
    return "RUN_COMPLETED";
  }
  if ([
    RUN_OUTCOMES.CONTINUABLE,
    RUN_OUTCOMES.NEEDS_INPUT,
    RUN_OUTCOMES.BLOCKED,
    RUN_OUTCOMES.INTERRUPTED,
    RUN_OUTCOMES.NEEDS_RECONCILIATION,
    RUN_OUTCOMES.NEEDS_CONFIRMATION,
    RUN_OUTCOMES.UNKNOWN
  ].includes(outcome)) {
    return "RUN_INTERRUPTED";
  }
  return "RUN_FAILED";
}

export const agentRunExecution = {
  async runE2EMessage(options = {}) {
    const {
      context,
      memories,
      settings
    } = options;
    const {
      session,
      runId,
      conversationId,
      abortController
    } = resolveRunInvocation(this, options);

    try {
      startResponseStream();

      const writeRequest = getE2EToolWriteRequest(
        context.messages
      );

      if (writeRequest) {
        const runSettings = settings ?? getSettings();
        const approvalController =
          this.createToolApprovalController(
            runId,
            runSettings,
            abortController.signal
          );
        session.approvalController =
          approvalController;
        session.toolSecurity =
          approvalController.securitySnapshot();

        const toolSession = createAgentToolSession({
          activeModel: { provider: "e2e" },
          getAgentStatus: () => this.getStatus(),
          abortSignal: abortController.signal,
          onRecord: (record) => {
            approvalController.markToolRecord(record);
            this.upsertToolRecord(runId, record);
          },
          authorizeTool: (request) =>
            approvalController.authorize(request),
          activityStore: session.activityStore,
          settings: runSettings,
          resultStoreDirectory: getTaskResultDirectory(
            session.taskId
          ),
          taskId: session.taskId,
          runId,
          workspaceId: session.workspaceId ?? "",
          mode: session.mode ?? "chat",
          segmentId: session.currentSegmentId,
          capabilityRequest:
            session.skillRuntime?.capabilityRequest ?? null
        });
        session.toolSession = toolSession;

        if (!toolSession.tools.write_text_file) {
          const error = new Error(
            "E2E Coding write tool is unavailable."
          );
          error.code = "E2E_WRITE_TOOL_UNAVAILABLE";
          throw error;
        }

        const writeResult =
          await toolSession.tools.write_text_file.execute(
            writeRequest,
            { toolCallId: "e2e-write-file" }
          );

        if (!writeResult?.ok) {
          const error = new Error(
            writeResult?.error?.message ??
            "E2E file write failed."
          );
          error.code =
            writeResult?.error?.code ?? "E2E_WRITE_FAILED";
          throw error;
        }

        const assistantText =
          `E2E_TOOL_WRITE_OK:${writeResult.data.path}`;
        session.finalText = assistantText;
        appendResponseChunk(assistantText);
        this.finalizeRun({
          runId,
          conversationId,
          executionStopReason: RUN_STOP_REASONS.COMPLETED,
          outcome: RUN_OUTCOMES.COMPLETED,
          content: assistantText
        });
        return;
      }

      await streamE2EResponse({
        messages: context.messages,
        memories,
        contextMetadata: context.metadata,
        signal: abortController.signal,
        onChunk: (textPart) => {
          if (!this.isCurrentRun(runId)) {
            return;
          }

          session.currentStepText += textPart;
          session.finalText =
            session.currentStepText;
          appendResponseChunk(textPart);
          this.setStatus({ ...this.status });
        }
      });

      if (abortController.signal.aborted) {
        await this.finishCancelledRun({
          runId,
          conversationId
        });
        return;
      }

      if (!this.isCurrentRun(runId)) {
        return;
      }

      const assistantText =
        session.finalText.trim();
      this.finalizeRun({
        runId,
        conversationId,
        executionStopReason: RUN_STOP_REASONS.COMPLETED,
        outcome: RUN_OUTCOMES.COMPLETED,
        content: assistantText || "任务已处理完成。"
      });
    } catch (error) {
      if (
        abortController.signal.aborted ||
        isAbortError(error)
      ) {
        await this.finishCancelledRun({
          runId,
          conversationId
        });
        return;
      }

      if (this.isCurrentRun(runId)) {
        const friendlyMessage = formatAgentError(error);
        const errorText = `⚠ ${friendlyMessage}`;
        appendResponseChunk(errorText);
        this.finalizeRun({
          runId,
          conversationId,
          executionStopReason: RUN_STOP_REASONS.MODEL_ERROR,
          outcome: RUN_OUTCOMES.FAILED,
          content: errorText,
          lastError: friendlyMessage
        });
      }
    }
  },

  async executeModelLoop({
    runId,
    runUnit,
    systemPrompt,
    context,
    runtime,
    modelSettings,
    toolSession,
    maxSteps,
    abortController,
    remainingRunMs,
    approvalTimeoutMs,
    defaultToolTimeoutMs
  }) {
    this.assertProviderAvailable(runtime);
    const result = streamText({
      model: runtime.model,
      system: systemPrompt,
      messages: context.messages,
      tools: toolSession.tools,
      stopWhen: stepCountIs(maxSteps),
      ...runtime.requestOptions,
      abortSignal: abortController.signal,
      timeout: createAgentStreamTimeout({
        modelTimeoutMs: modelSettings.timeoutMs,
        remainingRunMs,
        approvalTimeoutMs,
        defaultToolTimeoutMs,
        hasApprovalGatedTools: toolSession.definitions.some(
          (definition) => [
            "local_write",
            "remote_write",
            "destructive"
          ].includes(definition.runtimeContract?.effect)
        )
      }),
      prepareStep: ({
        stepNumber,
        initialMessages,
        responseMessages
      }) => {
        if (
          stepNumber < 4 ||
          !this.isCurrentRun(runId)
        ) {
          return undefined;
        }

        const compacted = compactRunStepContext({
          initialMessages,
          responseMessages,
          checkpoint: this.buildActiveCheckpoint(),
          contextTokenBudget:
            modelSettings.contextTokenBudget,
          outputReserve:
            modelSettings.maxOutputTokens ?? 4096
        });

        if (!compacted.compacted) {
          return undefined;
        }

        this.activeRun.contextCompactionCount += 1;
        this.activeRun.tokenLedger?.recordCompaction(compacted);
        this.persistActiveRunCheckpoint({
          status: "running"
        });

        return {
          messages: compacted.messages,
          instructions: [
            systemPrompt,
            compacted.checkpointInstruction,
            "Earlier tool details were compacted to protect the context budget. Use saved tool results and receipts; do not repeat completed work."
          ].filter(Boolean).join("\n\n")
        };
      },
      onStepStart: ({ stepNumber }) => {
        if (!this.isCurrentRun(runId)) {
          return;
        }

        this.activeRun.currentStepText = "";
        this.activeRun.liveStepRole = inferLiveStepRole({
          records: toolSession.getRecords()
        });
        this.activeRun.stepNumber =
          Number(stepNumber) || 0;
        const stepId =
          `${runUnit.id}:step:${this.activeRun.stepNumber}`;
        this.activeRun.toolSession?.beginStep?.({
          stepId,
          segmentId: runUnit.id
        });
        void this.activeRun.toolSession?.recordRuntimeEvent?.(
          "MODEL_STEP_STARTED",
          {
            stepId,
            stepNumber: this.activeRun.stepNumber
          },
          { runId, segmentId: runUnit.id }
        );
        this.setStatus({ ...this.status });
      },
      onStepEnd: (step) => {
        this.handleStepEnd(runId, step);
      },
      onError: ({ error }) => {
        console.error("模型流式请求错误：", error);
      }
    });

    const publicStream = new PublicTextStreamSanitizer();
    for await (const textPart of result.textStream) {
      if (!this.isCurrentRun(runId)) {
        break;
      }

      if (textPart) {
        const publicChunk = publicStream.push(textPart);
        if (publicChunk) {
          this.activeRun.currentStepText += publicChunk;
          appendResponseChunk(publicChunk);
          this.setStatus({ ...this.status });
        }
      }
    }
    const finalPublicChunk = publicStream.flush();
    if (finalPublicChunk && this.isCurrentRun(runId)) {
      this.activeRun.currentStepText += finalPublicChunk;
      appendResponseChunk(finalPublicChunk);
    }

    const records = toolSession.getRecords();
    const finishReason = await settleResultValue(
      result.finishReason,
      "unknown"
    );
    const steps = await settleResultValue(
      result.steps,
      []
    );
    const executionStopReason = inferRunStopReason({
      records,
      finishReason,
      steps,
      maxSteps
    });
    const segmentRecords = records.filter(
      (record) => record?.segmentId === runUnit.id
    );
    const batchFailed = hasActiveToolFailures(
      segmentRecords
    );
    this.activeRun.activityStore?.closeBatch(
      batchFailed ? "failed" : "completed"
    );

    this.noteProviderSuccess(runtime);
    return {
      records,
      finishReason,
      steps,
      executionStopReason,
      finalText: this.activeRun.finalText
    };
  },

  async runMessage(options = {}) {
    const {
      context,
      settings
    } = options;
    const {
      session,
      runId,
      conversationId,
      abortController
    } = resolveRunInvocation(this, options);

    let runtime = null;
    try {
      const runSettings = settings ?? getSettings();
      const modelSettings = resolveActiveModelSettings(
        runSettings.model
      );
      runtime = createModelRuntime(modelSettings);
      const runtimeSettings =
        runSettings.tools?.runtime ?? {};

      const mcpDefinitions = await mcpClientManager
        .prepareForAgent(runSettings)
        .catch((error) => {
          console.warn(
            "MCP 工具准备失败，将继续使用其他工具：",
            error
          );
          return [];
        });
      const externalDefinitions = [
        ...mcpDefinitions,
        ...declarativeHttpToolManager
          .getToolDefinitions(runSettings)
      ];

      const approvalController =
        this.createToolApprovalController(
          runId,
          runSettings,
          abortController.signal
        );
      session.approvalController =
        approvalController;
      session.toolSecurity =
        approvalController.securitySnapshot();

      const toolSession = createAgentToolSession({
        activeModel: modelSettings,
        externalDefinitions,
        getAgentStatus: () => this.getStatus(),
        abortSignal: abortController.signal,
        onRecord: (record) => {
          approvalController.markToolRecord(record);
          session?.tokenLedger?.recordTool(record);
          this.upsertToolRecord(runId, record);
        },
        authorizeTool: (request) =>
          approvalController.authorize(request),
        activityStore: session.activityStore,
        settings: runSettings,
        resultStoreDirectory: getTaskResultDirectory(
          session.taskId
        ),
        taskId: session.taskId,
        runId,
        workspaceId: session.workspaceId ?? "",
        mode: session.mode ?? "chat",
        getSegmentId: () =>
          session.currentSegmentId,
        segmentId: session.currentSegmentId,
        capabilityRequest:
          session.skillRuntime?.capabilityRequest ?? null,
        onFileMutation: (mutation) => {
          if (!this.isCurrentRun(runId)) {
            return;
          }
          session.diffTracker?.record?.(mutation);
          this.setStatus({ ...this.status });
        }
      });

      session.toolSession = toolSession;
      session.tokenLedger?.setToolDefinitions(
        toolSession.definitions
      );

      if (session.skillRun) {
        const resolution = toolSession.capabilityResolution;
        session.skillRun = {
          ...session.skillRun,
          selectedToolNames: [
            ...(resolution?.selectedToolNames ?? [])
          ],
          missingRequired: [
            ...(resolution?.missingRequired ?? [])
          ]
        };
        session.activityStore?.recordSkill({
          skill: session.skillRuntime.skill,
          skills: session.skillRuntime.skills,
          source: session.skillRuntime.source,
          router: session.skillRuntime.router,
          status: "running",
          selectedToolNames:
            session.skillRun.selectedToolNames,
          missingRequired:
            session.skillRun.missingRequired
        });
        if (
          session.skillRun.missingRequired.length > 0
        ) {
          const error = new Error(
            `Skill 缺少必需能力：${session.skillRun.missingRequired.join(", ")}`
          );
          error.code = "SKILL_CAPABILITY_MISSING";
          throw error;
        }
      }

      await toolSession.recordRuntimeEvent?.(
        "RUN_STARTED",
        {
          objective: session.objective,
          continuationCount:
            session.continuationCount,
          skillId:
            session.skillRuntime?.skill?.id ?? "",
          skillIds:
            session.skillRuntime?.rootSkillIds ?? [],
          skillSource:
            session.skillRuntime?.source ?? "none",
          runtimeFlavor: "core-lite"
        },
        { runId }
      );
      await toolSession.reconcileRuntime?.();
      const runtimeRecovery =
        toolSession.getRuntimeRecovery?.();
      if (runtimeRecovery?.unresolvedCount > 0) {
        session.activityStore?.recordRecovery(
          runtimeRecovery
        );
      }

      const activeCapabilityContext =
        buildCapabilityContext({
          toolSettings: runSettings.tools,
          toolManifest: toolSession.definitions
        });
      const activePromptSections =
        (context.promptSections ?? []).map((section) =>
          section.id === "capabilities"
            ? {
                ...section,
                content: activeCapabilityContext
              }
            : section
        );

      if (activePromptSections.length > 0) {
        context.promptSections = activePromptSections;
        context.system = [
          renderPromptSections(activePromptSections),
          context.runtimeInstructions
        ].filter(Boolean).join("\n\n");
      }

      startResponseStream();

      const maxSteps = runtimeSettings.maxSteps ?? 6;
      const runTimeoutMs =
        runtimeSettings.runTimeoutMs ??
        modelSettings.timeoutMs;
      const runDeadline =
        session.startedAt + runTimeoutMs;
      const runLoop = new CoreLiteRunLoop({
        session,
        runDeadline,
        isActive: () => this.isCurrentRun(runId)
      });

      const runResult = await runLoop.runToCompletion({
        callbacks: {
          getRecords: () => toolSession.getRecords(),
          createCheckpoint: () =>
            this.buildActiveCheckpoint(),
          onRunStart: async ({ runUnit }) => {
            session.currentSegmentId = runUnit.id;
            await toolSession.recordRuntimeEvent?.(
              "SEGMENT_STARTED",
              {
                segmentIndex: 1,
                objective: session.objective,
                runtimeFlavor: "core-lite"
              },
              { runId, segmentId: runUnit.id }
            );
            this.markRunExecuting();
            this.persistActiveRunCheckpoint({
              status: "running"
            });
            session.activityStore?.recordProgress({
              title: "开始执行任务",
              status: "running"
            });
          },
          executeRun: ({
            runUnit,
            remainingRunMs
          }) => this.executeModelLoop({
            runId,
            runUnit,
            systemPrompt: context.system,
            context,
            runtime,
            modelSettings,
            toolSession,
            maxSteps,
            abortController,
            remainingRunMs,
            approvalTimeoutMs:
              runSettings.tools?.security?.approval?.timeoutMs,
            defaultToolTimeoutMs:
              runtimeSettings.defaultTimeoutMs
          }),
          onRunComplete: async ({
            runUnit,
            runOutcome,
            checkpoint
          }) => {
            const completed =
              runOutcome.stopReason ===
              RUN_STOP_REASONS.COMPLETED;
            session.activityStore?.recordProgress({
              title: completed
                ? "任务执行完成"
                : "当前进展已整理",
              status: completed ? "completed" : "failed",
              stopReason: runOutcome.stopReason
            });
            await toolSession.recordRuntimeEvent?.(
              "SEGMENT_COMMITTED",
              {
                decision: runOutcome.decision,
                stopReason: runOutcome.stopReason,
                checkpointStored: Boolean(checkpoint),
                runtimeFlavor: "core-lite"
              },
              { runId, segmentId: runUnit.id }
            );
            if (checkpoint) {
              await toolSession.storeRuntimeCheckpoint?.(
                {
                  ...checkpoint,
                  toolRuntime:
                    toolSession.getRuntimeRecovery?.(),
                  ...toolSession.getRuntimeCursor?.()
                },
                { runId, segmentId: runUnit.id }
              );
            }
          }
        },
        getFinalText: () => session.finalText,
        setFinalText: (value) => {
          session.finalText = value;
        },
        appendFinalText: (value) => {
          appendResponseChunk(value);
        },
        onLoopResult: ({ records }) => {
          if (!this.isCurrentRun(runId)) {
            return;
          }
          session.toolCalls = records;
        },
        runFinalization: ({
          records,
          executionStopReason
        }) => this.runFinalization({
          runId,
          context,
          runtime,
          modelSettings,
          settings: runSettings,
          records,
          executionStopReason,
          abortController
        })
      });

      if (
        abortController.signal.aborted ||
        runResult.cancelled
      ) {
        await this.finishCancelledRun({
          runId,
          conversationId
        });
        return;
      }

      if (!this.isCurrentRun(runId)) {
        return;
      }

      const finalCheckpoint = this.buildActiveCheckpoint();
      if (finalCheckpoint) {
        await toolSession.storeRuntimeCheckpoint?.(
          finalCheckpoint,
          { runId }
        );
      }
      await toolSession.recordRuntimeEvent?.(
        runtimeFinishEvent(runResult.outcome),
        {
          outcome: runResult.outcome,
          stopReason: runResult.executionStopReason,
          runtimeFlavor: "core-lite"
        },
        { runId }
      );

      this.finalizeRun({
        runId,
        conversationId,
        executionStopReason:
          runResult.executionStopReason,
        outcome: runResult.outcome,
        content:
          runResult.finalText || "任务已处理完成。"
      });
    } catch (error) {
      this.noteProviderFailure(runtime, error);
      if (
        abortController.signal.aborted ||
        isAbortError(error)
      ) {
        await this.finishCancelledRun({
          runId,
          conversationId
        });
        return;
      }

      const friendlyMessage = formatAgentError(error);
      console.error("Agent 运行失败：", error);

      if (!this.isCurrentRun(runId)) {
        return;
      }

      const records =
        session.toolSession?.getRecords?.() ??
        session.toolCalls ?? [];
      const hasRecoverableState = records.some(
        (record) => record?.status === "completed"
      );
      const executionStopReason = hasRecoverableState
        ? RUN_STOP_REASONS.MODEL_RECOVERY
        : RUN_STOP_REASONS.MODEL_ERROR;

      if (hasRecoverableState) {
        session.toolCalls = records;
        session.activityStore?.recordProgress({
          title: "当前进展已整理",
          status: "completed",
          stopReason: executionStopReason
        });
        const fallback = createFallbackFinalSummary({
          records,
          executionStopReason
        });
        const recoveryCheckpoint =
          this.buildActiveCheckpoint();
        if (recoveryCheckpoint) {
          await session.toolSession
            ?.storeRuntimeCheckpoint?.(
              recoveryCheckpoint,
              { runId }
            );
        }
        await session.toolSession
          ?.recordRuntimeEvent?.(
            "RUN_INTERRUPTED",
            {
              outcome: "continuable",
              stopReason: executionStopReason,
              error: friendlyMessage,
              runtimeFlavor: "core-lite"
            },
            { runId }
          );

        startResponseStream();
        appendResponseChunk(fallback);
        this.finalizeRun({
          runId,
          conversationId,
          executionStopReason,
          outcome: RUN_OUTCOMES.CONTINUABLE,
          content: fallback
        });
        return;
      }

      await session.toolSession
        ?.recordRuntimeEvent?.(
          "RUN_FAILED",
          {
            outcome: "failed",
            stopReason: executionStopReason,
            error: friendlyMessage,
            runtimeFlavor: "core-lite"
          },
          { runId }
        );
      const failedCheckpoint =
        this.buildActiveCheckpoint();
      if (failedCheckpoint) {
        await session.toolSession
          ?.storeRuntimeCheckpoint?.(
            failedCheckpoint,
            { runId }
          );
      }

      const errorText = `⚠ ${friendlyMessage}`;
      startResponseStream();
      appendResponseChunk(errorText);
      this.finalizeRun({
        runId,
        conversationId,
        executionStopReason,
        outcome: RUN_OUTCOMES.FAILED,
        content: errorText,
        lastError: friendlyMessage
      });
    }
  }
};
