import {
  stepCountIs,
  streamText
} from "ai";

import {
  conversationManager
} from "../../conversation/index.js";

import {
  platformKernel
} from "../../platform/index.js";

import {
  createDelegationToolDefinition
} from "../../platform/delegationTools.js";

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
  inferLiveStepRole,
  LIVE_STEP_ROLES
} from "../stepText.js";

import {
  compactRunStepContext
} from "../contextCompaction.js";

import {
  createCheckpointInstruction
} from "../runCheckpoint.js";

import {
  createGoalVerificationInstruction
} from "../GoalCompletionVerifier.js";

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
  LongTaskOrchestrator
} from "../orchestration/LongTaskOrchestrator.js";

import {
  RUN_OUTCOMES
} from "../RunStateMachine.js";

import {
  RunEngine
} from "../RunEngine.js";

import {
  createAgentStreamTimeout
} from "../agentStreamTimeout.js";

import {
  SegmentExecutionLoop
} from "../orchestration/SegmentExecutionLoop.js";

import {
  deriveGoalWorkingState,
  getTaskResultDirectory,
  settleResultValue
} from "../AgentRuntimeInternals.js";

export const agentRunExecution = {
  async runE2EMessage({
    runId,
    conversationId,
    context,
    memories,
    settings,
    abortController
  }) {
    try {
      startResponseStream();

      const writeRequest = getE2EToolWriteRequest(
        context.messages
      );

      if (writeRequest) {
        const runSettings = settings ?? getSettings();
        const approvalController = this.createToolApprovalController(
          runId,
          runSettings,
          abortController.signal
        );
        this.activeRun.approvalController = approvalController;
        this.activeRun.toolSecurity = approvalController.securitySnapshot();

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
          activityStore: this.activeRun.activityStore,
          settings: runSettings,
          initialPlan:
            this.activeRun.initialPlanState ??
            this.activeRun.initialPlan,
          resultStoreDirectory: getTaskResultDirectory(
            this.activeRun.taskId
          ),
          taskId: this.activeRun.taskId,
          runId,
          workspaceId: this.activeRun.workspaceId ?? "",
          mode: this.activeRun.mode ?? "chat",
          segmentId: "e2e-approved-write",
          capabilityRequest: this.activeRun.skillRuntime?.capabilityRequest ?? null
        });
        this.activeRun.toolSession = toolSession;

        if (!toolSession.tools.write_text_file) {
          const error = new Error(
            "E2E Coding write tool is unavailable."
          );
          error.code = "E2E_WRITE_TOOL_UNAVAILABLE";
          throw error;
        }

        await toolSession.tools.update_plan.execute(
          {
            items: [
              {
                id: "write",
                title: "Write an approved file",
                status: "in_progress"
              }
            ]
          },
          { toolCallId: "e2e-plan-write" }
        );

        const writeResult = await toolSession.tools.write_text_file.execute(
          writeRequest,
          { toolCallId: "e2e-write-file" }
        );

        if (!writeResult?.ok) {
          const error = new Error(
            writeResult?.error?.message ?? "E2E file write failed."
          );
          error.code = writeResult?.error?.code ?? "E2E_WRITE_FAILED";
          throw error;
        }

        await toolSession.tools.update_plan.execute(
          {
            items: [
              {
                id: "write",
                title: "Write an approved file",
                status: "completed"
              }
            ]
          },
          { toolCallId: "e2e-plan-complete" }
        );

        const assistantText = `E2E_TOOL_WRITE_OK:${writeResult.data.path}`;
        this.activeRun.finalText = assistantText;
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
        messages:
          context.messages,
        memories,
        contextMetadata:
          context.metadata,
        signal:
          abortController.signal,

        onChunk: (
          textPart
        ) => {
          if (
            !this.isCurrentRun(
              runId
            )
          ) {
            return;
          }

          this.activeRun
            .currentStepText +=
            textPart;
          this.activeRun.finalText =
            this.activeRun
              .currentStepText;

          appendResponseChunk(
            textPart
          );

          this.setStatus({
            ...this.status
          });
        }
      });

      if (
        abortController
          .signal
          .aborted
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

      const assistantText =
        this.activeRun
          .finalText
          .trim();

      this.finalizeRun({
        runId,
        conversationId,
        executionStopReason:
          RUN_STOP_REASONS.COMPLETED,
        outcome: RUN_OUTCOMES.COMPLETED,
        content:
          assistantText || "任务已处理完成。"
      });
    } catch (error) {
      if (
        abortController
          .signal
          .aborted ||
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
          executionStopReason:
            RUN_STOP_REASONS.MODEL_ERROR,
          outcome: RUN_OUTCOMES.FAILED,
          content: errorText,
          lastError: friendlyMessage
        });
      }
    }
  },

  async executeAgentSegment({
    runId,
    segment,
    segmentSystem,
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
      system: segmentSystem,
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
            segmentSystem,
            compacted.checkpointInstruction,
            "Earlier tool details were compacted to protect the context budget. Use the checkpoint and result references; do not repeat completed work."
          ].filter(Boolean).join("\n\n")
        };
      },
      onStepStart: ({ stepNumber }) => {
        if (!this.isCurrentRun(runId)) {
          return;
        }

        this.activeRun.currentStepText = "";
        this.activeRun.liveStepRole =
          inferLiveStepRole({
            records: toolSession.getRecords()
          });
        this.activeRun.stepNumber =
          Number(stepNumber) || 0;
        const stepId = `${segment.id}:step:${this.activeRun.stepNumber}`;
        this.activeRun.toolSession?.beginStep?.({
          stepId,
          segmentId: segment.id
        });
        void this.activeRun.toolSession?.recordRuntimeEvent?.(
          "MODEL_STEP_STARTED",
          { stepId, stepNumber: this.activeRun.stepNumber },
          { runId, segmentId: segment.id }
        );
        this.setStatus({
          ...this.status
        });
      },
      onStepEnd: (step) => {
        this.handleStepEnd(runId, step);
      },
      onError: ({ error }) => {
        console.error(
          "模型流式请求错误：",
          error
        );
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
          this.setStatus({
            ...this.status
          });
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
    const plan = toolSession.getPlan();
    const executionStopReason = inferRunStopReason({
      records,
      finishReason,
      steps,
      maxSteps,
      plan
    });
    const segmentRecords = records.filter(
      (record) => record?.segmentId === segment.id
    );
    const batchFailed = hasActiveToolFailures(segmentRecords);
    this.activeRun.activityStore?.closeBatch(
      batchFailed ? "failed" : "completed"
    );

    this.noteProviderSuccess(runtime);
    return {
      records,
      finishReason,
      steps,
      plan,
      executionStopReason,
      finalText: this.activeRun.finalText
    };
  },

  async runMessage({
    runId,
    conversationId,
    context,
    settings,
    abortController
  }) {
    let runtime = null;
    try {
      const runSettings = settings ?? getSettings();
      const modelSettings = resolveActiveModelSettings(
        runSettings.model
      );
      runtime = createModelRuntime(modelSettings);
      const runtimeSettings = runSettings.tools?.runtime ?? {};
      const orchestrator = new LongTaskOrchestrator({
        goal: this.activeRun.goalSpec,
        goalId: this.activeRun.goalId,
        taskId: this.activeRun.taskId,
        runId,
        objective: this.activeRun.objective,
        maxSegmentSteps: runtimeSettings.maxSteps ?? 6,
        maxSegments: this.activeRun.goalSpec?.autoContinue === false
          ? 1
          : runtimeSettings.maxSegments ?? 6,
        maxNoProgressSegments:
          runtimeSettings.maxNoProgressSegments ?? 2,
        startedAt: this.activeRun.startedAt
      });
      this.activeRun.orchestrator = orchestrator;

      const mcpDefinitions = await mcpClientManager
        .prepareForAgent(runSettings)
        .catch((error) => {
          console.warn("MCP 工具准备失败，将继续使用其他工具：", error);
          return [];
        });
      const externalDefinitions = [
        ...mcpDefinitions,
        ...declarativeHttpToolManager.getToolDefinitions(runSettings),
        ...(this.activeRun.platformRunId
          ? [createDelegationToolDefinition({
              getPlatformRunId: () => this.activeRun?.platformRunId ?? ""
            })]
          : [])
      ];

      const approvalController = this.createToolApprovalController(
        runId,
        runSettings,
        abortController.signal
      );
      this.activeRun.approvalController = approvalController;
      this.activeRun.toolSecurity = approvalController.securitySnapshot();

      const toolSession = createAgentToolSession({
        activeModel: modelSettings,
        externalDefinitions,
        getAgentStatus: () => this.getStatus(),
        abortSignal: abortController.signal,
        onRecord: (record) => {
          approvalController.markToolRecord(record);
          this.activeRun?.tokenLedger?.recordTool(record);
          this.upsertToolRecord(runId, record);
        },
        authorizeTool: (request) =>
          approvalController.authorize(request),
        onPlanChange: (plan, change) => {
          if (!this.isCurrentRun(runId)) {
            return;
          }

          if (change?.scope !== "step_work") {
            this.activeRun.activityStore?.recordPlan(
              plan,
              Date.now(),
              change
            );
          }

          if (this.activeRun.persistentGoalId && change?.planState) {
            const persisted = change.authorityAction === "replan"
              ? conversationManager.replanGoal({
                  conversationId,
                  goalId: this.activeRun.persistentGoalId,
                  planState: change.planState,
                  reason: change.reason,
                  failedAssumption: change.failedAssumption,
                  runId
                })
              : conversationManager.recordGoalPlan({
                  conversationId,
                  goalId: this.activeRun.persistentGoalId,
                  planState: change.planState,
                  runId,
                  authorityAction: change.authorityAction ?? "progress"
                });
            if (persisted?.ok === false) {
              console.warn("Goal 顶层计划持久化失败：", persisted);
            }
          }

          this.activeRun.workingState =
            deriveGoalWorkingState(this.activeRun);
          this.persistActiveRunCheckpoint({
            status: "running"
          });
          this.setStatus({
            ...this.status
          });
        },
        activityStore: this.activeRun.activityStore,
        settings: runSettings,
        initialPlan:
          this.activeRun.initialPlanState ??
          this.activeRun.initialPlan,
        resultStoreDirectory: getTaskResultDirectory(
          this.activeRun.taskId
        ),
        taskId: this.activeRun.taskId,
        runId,
        workspaceId:
          this.activeRun.workspaceId ?? "",
        mode: this.activeRun.mode ?? "chat",
        getSegmentId: () => orchestrator.currentSegmentId(),
        segmentId: runId,
        capabilityRequest: this.activeRun.skillRuntime?.capabilityRequest ?? null,
        onFileMutation: (mutation) => {
          if (!this.isCurrentRun(runId)) return;
          this.activeRun.diffTracker?.record?.(mutation);
          this.setStatus({ ...this.status });
        }
      });

      this.activeRun.toolSession = toolSession;
      this.activeRun.tokenLedger?.setToolDefinitions(toolSession.definitions);
      if (this.activeRun.skillRun) {
        const resolution = toolSession.capabilityResolution;
        this.activeRun.skillRun = {
          ...this.activeRun.skillRun,
          selectedToolNames: [...(resolution?.selectedToolNames ?? [])],
          missingRequired: [...(resolution?.missingRequired ?? [])]
        };
        this.activeRun.activityStore?.recordSkill({
          skill: this.activeRun.skillRuntime.skill,
          skills: this.activeRun.skillRuntime.skills,
          source: this.activeRun.skillRuntime.source,
          router: this.activeRun.skillRuntime.router,
          status: "running",
          selectedToolNames: this.activeRun.skillRun.selectedToolNames,
          missingRequired: this.activeRun.skillRun.missingRequired
        });
        if (this.activeRun.skillRun.missingRequired.length > 0) {
          const error = new Error(
            `Skill 缺少必需能力：${this.activeRun.skillRun.missingRequired.join(", ")}`
          );
          error.code = "SKILL_CAPABILITY_MISSING";
          throw error;
        }
      }
      await toolSession.recordRuntimeEvent?.(
        "RUN_STARTED",
        {
          goalId: this.activeRun.goalId,
          objective: this.activeRun.objective,
          continuationCount: this.activeRun.continuationCount,
          skillId: this.activeRun.skillRuntime?.skill?.id ?? "",
          skillIds: this.activeRun.skillRuntime?.rootSkillIds ?? [],
          skillSource: this.activeRun.skillRuntime?.source ?? "none"
        },
        { runId }
      );
      await toolSession.reconcileRuntime?.();
      const runtimeRecovery = toolSession.getRuntimeRecovery?.();
      if (runtimeRecovery?.unresolvedCount > 0) {
        this.activeRun.activityStore?.recordRecovery(
          runtimeRecovery
        );
      }
      const activeCapabilityContext = buildCapabilityContext({
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
        runtimeSettings.runTimeoutMs ?? modelSettings.timeoutMs;
      const runDeadline = this.activeRun.startedAt + runTimeoutMs;
      let segmentSystem = context.system;

      const segmentLoop = new SegmentExecutionLoop({
        orchestrator,
        runDeadline,
        signal: abortController.signal,
        isActive: () => this.isCurrentRun(runId)
      });

      const runEngine = new RunEngine({
        segmentLoop
      });

      const engineResult = await runEngine.run({
        segmentCallbacks: {
          getPlan: () => toolSession.getPlan(),
          getRecords: () => toolSession.getRecords(),
          getCompletionContext: () => ({
            mode: this.activeRun.mode ?? "chat",
            availableToolNames: Object.keys(toolSession.tools ?? {}),
            runtimeRecovery: toolSession.getRuntimeRecovery?.() ?? null
          }),
          createCheckpoint: () => {
            const checkpoint = this.buildActiveCheckpoint();
            if (checkpoint) {
              checkpoint.orchestration = null;
            }
            return checkpoint;
          },
          onSegmentStart: async ({ segment }) => {
            this.activeRun.currentSegmentId = segment.id;
            if (this.activeRun.persistentGoalId) {
              conversationManager.heartbeatGoal({
                conversationId,
                goalId: this.activeRun.persistentGoalId,
                runId,
                phase: "executing"
              });
            }
            await toolSession.recordRuntimeEvent?.(
              "SEGMENT_STARTED",
              {
                segmentIndex: segment.index,
                objective: segment.objective ?? this.activeRun.objective
              },
              { runId, segmentId: segment.id }
            );
            this.markRunExecuting();
            this.persistActiveRunCheckpoint({
              status: "running"
            });
            this.activeRun.activityStore?.recordProgress({
              title:
                segment.index === 1
                  ? "开始执行任务"
                  : "继续执行任务",
              status: "running"
            });
          },
          executeSegment: ({ segment, remainingRunMs }) =>
            this.executeAgentSegment({
              runId,
              segment,
              segmentSystem,
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
          onSegmentComplete: async ({
            segment,
            segmentOutcome,
            checkpoint
          }) => {
            this.activeRun.currentSegmentId = "";
            if (this.activeRun.persistentGoalId) {
              conversationManager.heartbeatGoal({
                conversationId,
                goalId: this.activeRun.persistentGoalId,
                runId,
                phase: "evaluating"
              });
              if (checkpoint) {
                conversationManager.recordGoalCheckpoint({
                  conversationId,
                  goalId: this.activeRun.persistentGoalId,
                  checkpoint: {
                    ...checkpoint,
                    segmentId: segment.id
                  }
                });
              }
              if (segmentOutcome.decision === "continue") {
                conversationManager.transitionGoal({
                  conversationId,
                  goalId: this.activeRun.persistentGoalId,
                  phase: "replanning",
                  reason: segmentOutcome.stopReason || "continue-goal-run",
                  runId,
                  force: true
                });
              }
            }
            const title =
              segmentOutcome.decision === "continue"
                ? segmentOutcome.verification?.verified === false
                  ? "完成证据不足，继续验证"
                  : "已整理当前进展，继续执行"
                : segmentOutcome.decision === "checkpoint"
                  ? "当前阶段进展已整理"
                  : "当前阶段已完成";
            this.activeRun.activityStore?.recordProgress({
              title,
              status: [
                "continue",
                "complete",
                "checkpoint"
              ].includes(segmentOutcome.decision)
                ? "completed"
                : "failed",
              stopReason: segmentOutcome.stopReason
            });
            if (this.activeRun.persistentGoalId && segmentOutcome.verification) {
              conversationManager.recordGoalVerification({
                conversationId,
                goalId: this.activeRun.persistentGoalId,
                verification: segmentOutcome.verification
              });
            }
            await toolSession.recordRuntimeEvent?.(
              "SEGMENT_COMMITTED",
              {
                decision: segmentOutcome.decision,
                stopReason: segmentOutcome.stopReason,
                checkpointStored: Boolean(checkpoint),
                goalVerification: segmentOutcome.verification ?? null
              },
              { runId, segmentId: segment.id }
            );
            if (checkpoint) {
              await toolSession.storeRuntimeCheckpoint?.(
                {
                  ...checkpoint,
                  toolRuntime: toolSession.getRuntimeRecovery?.(),
                  ...toolSession.getRuntimeCursor?.()
                },
                { runId, segmentId: segment.id }
              );
            }
          },
          onContinue: ({ checkpoint, segmentOutcome }) => {
            this.activeRun.finalText = "";
            this.activeRun.currentStepText = "";
            this.activeRun.liveStepRole =
              LIVE_STEP_ROLES.NONE;
            this.activeRun.activityStore?.updateCheckpoint(
              checkpoint
            );
            segmentSystem = [
              context.system,
              createCheckpointInstruction(checkpoint),
              createGoalVerificationInstruction(
                segmentOutcome?.verification
              ),
              "[Continued execution] Continue the same task from the saved task state. Advance unfinished work; do not repeat completed tool calls. If required user input is missing, mark the current plan step needs_input and provide a final explanation. Do not mention internal execution slices or counters to the user."
            ].filter(Boolean).join("\n\n");
            this.persistActiveRunCheckpoint({
              status: "running"
            });
          }
        },
        getFinalText: () =>
          this.activeRun?.finalText ?? "",
        setFinalText: (value) => {
          if (this.activeRun) {
            this.activeRun.finalText = value;
          }
        },
        appendFinalText: (value) => {
          appendResponseChunk(value);
        },
        onLoopResult: ({
          loopResult,
          records
        }) => {
          if (!this.isCurrentRun(runId)) {
            return;
          }

          this.activeRun.toolCalls = records;

          if (["run_timeout", "segment_limit"].includes(loopResult.source)) {
            this.activeRun.activityStore?.recordProgress({
              title:
                loopResult.source === "run_timeout"
                  ? "当前进展已整理"
                  : "当前阶段进展已整理",
              status: "completed",
              stopReason: loopResult.stopReason
            });
          }
        },
        runFinalization: ({
          records,
          plan,
          executionStopReason,
          goalVerification
        }) =>
          this.runFinalization({
            runId,
            context,
            runtime,
            modelSettings,
            settings,
            records,
            plan,
            executionStopReason,
            goalVerification,
            abortController
          })
      });

      if (
        abortController.signal.aborted ||
        engineResult.cancelled
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

      if (
        this.activeRun.persistentGoalId &&
        engineResult.outcome === RUN_OUTCOMES.COMPLETED &&
        engineResult.loopResult?.verification?.verified === true
      ) {
        const completion = this.activeRun.platformRunId
          ? platformKernel.authorizeCompletion({
              platformRunId: this.activeRun.platformRunId,
              agentRunId: runId,
              verification: engineResult.loopResult.verification,
              records: engineResult.records
            })
          : {
              ok: false,
              code: this.activeRun.platformError?.code ??
                "platform-completion-authority-unavailable"
            };
        if (completion.ok) {
          const completedGoal = conversationManager.completeGoal({
            conversationId,
            goalId: this.activeRun.persistentGoalId,
            verification: completion.verification ?? engineResult.loopResult.verification,
            completionPermit: completion.permit
          });
          if (completedGoal.ok) {
            platformKernel.setRunStatus(
              this.activeRun.platformRunId,
              "completed",
              "goal-completion-authorized"
            );
          } else {
            platformKernel.setRunStatus(
              this.activeRun.platformRunId,
              "blocked",
              completedGoal.code
            );
          }
        }
      }

      const finalCheckpoint = this.buildActiveCheckpoint();
      if (finalCheckpoint) {
        await toolSession.storeRuntimeCheckpoint?.(
          finalCheckpoint,
          { runId }
        );
      }
      await toolSession.recordRuntimeEvent?.(
        "RUN_COMPLETED",
        {
          outcome: engineResult.outcome,
          stopReason: engineResult.executionStopReason,
          goalVerification:
            engineResult.loopResult?.verification ?? null
        },
        { runId }
      );

      this.finalizeRun({
        runId,
        conversationId,
        executionStopReason:
          engineResult.executionStopReason,
        outcome: engineResult.outcome,
        content:
          engineResult.finalText || "任务已处理完成。"
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

      console.error(
        "Agent 运行失败：",
        error
      );

      if (!this.isCurrentRun(runId)) {
        return;
      }

      const records =
        this.activeRun.toolSession?.getRecords?.() ??
        this.activeRun.toolCalls ?? [];
      const plan =
        this.activeRun.toolSession?.getPlan?.() ??
        this.activeRun.initialPlan ?? [];
      const hasRecoverableState =
        records.some((record) => record?.status === "completed") ||
        plan.length > 0;
      const executionStopReason = hasRecoverableState
        ? RUN_STOP_REASONS.MODEL_RECOVERY
        : RUN_STOP_REASONS.MODEL_ERROR;

      this.activeRun.orchestrator?.terminate(
        executionStopReason
      );

      if (hasRecoverableState) {
        this.activeRun.toolCalls = records;
        this.activeRun.activityStore?.recordProgress({
          title: "当前进展已整理",
          status: "completed",
          stopReason: executionStopReason
        });
        const fallback = createFallbackFinalSummary({
          plan,
          records,
          executionStopReason
        });
        const recoveryCheckpoint = this.buildActiveCheckpoint();
        if (recoveryCheckpoint) {
          await this.activeRun.toolSession
            ?.storeRuntimeCheckpoint?.(
              recoveryCheckpoint,
              { runId }
            );
        }
        await this.activeRun.toolSession
          ?.recordRuntimeEvent?.(
            "RUN_INTERRUPTED",
            {
              outcome: "continuable",
              stopReason: executionStopReason,
              error: friendlyMessage
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

      await this.activeRun.toolSession
        ?.recordRuntimeEvent?.(
          "RUN_FAILED",
          {
            outcome: "failed",
            stopReason: executionStopReason,
            error: friendlyMessage
          },
          { runId }
        );
      const failedCheckpoint = this.buildActiveCheckpoint();
      if (failedCheckpoint) {
        await this.activeRun.toolSession
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
