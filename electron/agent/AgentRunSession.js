import {
  RunStateMachine
} from "./RunStateMachine.js";

import {
  LIVE_STEP_ROLES
} from "./stepText.js";

import {
  RunLifecycleCoordinator
} from "./RunLifecycleCoordinator.js";

export const AGENT_RUN_SESSION_VERSION = 1;

function clone(value) {
  return value == null
    ? value
    : structuredClone(value);
}

export function createSkillRunState(
  skillRuntime,
  startedAt = Date.now()
) {
  if (!skillRuntime?.active) {
    return null;
  }

  return {
    id: skillRuntime.skill.id,
    name: skillRuntime.rootSkills
      .map((skill) => skill.name)
      .join(" + "),
    version: skillRuntime.skill.version,
    status: "running",
    source: skillRuntime.source,
    routingMode: skillRuntime.routingMode,
    skills: clone(skillRuntime.skills),
    rootSkillIds: [...skillRuntime.rootSkillIds],
    dependencySkillIds: skillRuntime.dependencySkills
      .map((skill) => skill.id),
    router: clone(skillRuntime.router),
    requiredCapabilities: [
      ...skillRuntime.capabilityRequest.requiredCapabilities
    ],
    optionalCapabilities: [
      ...skillRuntime.capabilityRequest.optionalCapabilities
    ],
    selectedToolNames: [],
    missingRequired: [],
    startedAt,
    endedAt: null
  };
}

export class AgentRunSession {
  constructor({
    runId,
    taskId,
    conversationId,
    objective = "",
    parentRunId = "",
    resumedFromMessageId = "",
    continuationCount = 0,
    workspaceId = null,
    workspaceSnapshot = null,
    mode = "chat",
    modelSelection = null,
    modelSnapshot = null,
    skillRuntime = null,
    activeWorkspace = null,
    runtimePreferences = {},
    abortController,
    activityStore,
    diffTracker,
    tokenLedger,
    replaceMessageId = null,
    resumeInPlace = false,
    startedAt = Date.now(),
    contextCompactionCount = 0,
    checkpointVersion = 0,
    reportedReceiptIds = [],
    partialResponse = "",
    partialResponseRole = "none"
  } = {}) {
    if (!String(runId ?? "").trim()) {
      throw new Error("AgentRunSession requires runId.");
    }
    if (!String(taskId ?? "").trim()) {
      throw new Error("AgentRunSession requires taskId.");
    }
    if (!String(conversationId ?? "").trim()) {
      throw new Error("AgentRunSession requires conversationId.");
    }
    if (!abortController) {
      throw new Error("AgentRunSession requires abortController.");
    }

    this.kind = "core-lite";
    this.version = AGENT_RUN_SESSION_VERSION;
    this.runId = String(runId);
    this.taskId = String(taskId);
    this.conversationId = String(conversationId);
    this.objective = String(objective ?? "").trim();
    this.parentRunId = String(parentRunId ?? "");
    this.resumedFromMessageId = String(resumedFromMessageId ?? "");
    this.continuationCount = Math.max(
      0,
      Math.round(Number(continuationCount) || 0)
    );
    this.workspaceId = workspaceId || null;
    this.workspaceSnapshot = clone(workspaceSnapshot);
    this.mode = mode === "coding" ? "coding" : "chat";
    this.modelSelection = clone(modelSelection);
    this.modelSnapshot = clone(modelSnapshot);
    this.skillRuntime = skillRuntime;
    this.skillRun = createSkillRunState(
      skillRuntime,
      startedAt
    );
    this.activeWorkspace = activeWorkspace;
    this.runtimePreferences = {
      saveAbortedReplies:
        runtimePreferences.saveAbortedReplies !== false,
      saveToolHistory:
        runtimePreferences.saveToolHistory !== false
    };
    this.abortController = abortController;
    this.lifecycle = new RunLifecycleCoordinator({
      runId: this.runId
    });
    this.activityStore = activityStore;
    this.diffTracker = diffTracker;
    this.tokenLedger = tokenLedger;
    this.replaceMessageId = replaceMessageId;
    this.resumeInPlace = resumeInPlace === true;
    this.startedAt = Math.max(
      0,
      Number(startedAt) || Date.now()
    );

    this.currentRunUnitId = `run:${this.runId}`;
    this.currentStepText = "";
    this.liveStepRole = LIVE_STEP_ROLES.NONE;
    this.finalText = "";
    this.stepNumber = 0;
    this.toolCalls = [];
    this.toolSession = null;
    this.pendingApproval = null;
    this.toolSecurity = null;
    this.approvalController = null;
    this.completionEvidence = null;
    this.terminal = null;
    this.finalizationFailure = null;
    this.finalizationAttemptCount = 0;
    this.providerRetryCount = 0;
    this.cancellation = {
      requested: false,
      requestedAt: null,
      reason: "",
      settledAt: null
    };
    this.cancellationCompletion = null;
    this.contextCompactionCount = Math.max(
      0,
      Math.round(Number(contextCompactionCount) || 0)
    );
    this.checkpointVersion = Math.max(
      0,
      Math.round(Number(checkpointVersion) || 0)
    );
    this.reportedReceiptIds = [
      ...new Set(
        (Array.isArray(reportedReceiptIds) ? reportedReceiptIds : [])
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
      )
    ];
    this.resumedPartialResponse = String(partialResponse ?? "");
    this.resumedPartialResponseRole = [
      "none",
      "commentary",
      "final"
    ].includes(partialResponseRole)
      ? partialResponseRole
      : "none";

    this.stateMachine = new RunStateMachine({
      startedAt: this.startedAt
    });
    this.applyState(this.stateMachine.snapshot());
  }

  attachApprovalController(controller) {
    this.approvalController = controller ?? null;
    if (!controller) {
      this.lifecycle.removeResource("approval-controller");
      return false;
    }
    return this.lifecycle.registerResource(
      "approval-controller",
      () => controller.close?.(),
      { priority: 100, timeoutMs: 1000 }
    );
  }

  attachToolSession(toolSession) {
    this.toolSession = toolSession ?? null;
    if (!toolSession) {
      this.lifecycle.removeResource("tool-session");
      return false;
    }
    return this.lifecycle.registerResource(
      "tool-session",
      () => toolSession.closePersistence?.(),
      { priority: 50, timeoutMs: 8000 }
    );
  }

  beginSettlement(source) {
    return this.lifecycle.beginSettlement(source);
  }

  waitForSettlement() {
    return this.lifecycle.waitForSettlement();
  }

  disposeResources(reason) {
    return this.lifecycle.dispose(reason);
  }

  requestCancellation(
    reason = "user-stop",
    requestedAt = Date.now()
  ) {
    if (this.cancellation.requested) {
      return false;
    }

    this.cancellation = {
      ...this.cancellation,
      requested: true,
      requestedAt: Math.max(0, Number(requestedAt) || Date.now()),
      reason: String(reason ?? "user-stop")
    };
    return true;
  }

  markCancellationSettled(settledAt = Date.now()) {
    this.cancellation = {
      ...this.cancellation,
      settledAt: Math.max(0, Number(settledAt) || Date.now())
    };
  }

  applyState(state) {
    if (!state) {
      return state;
    }

    this.phase = state.phase;
    this.outcome = state.outcome;
    this.executionStopReason =
      state.executionStopReason || null;
    this.stopReason =
      state.executionStopReason || null;
    this.resumable = state.resumable === true;
    this.publicStatus = state.messageStatus;
    return state;
  }

  snapshot() {
    return {
      kind: this.kind,
      version: this.version,
      runId: this.runId,
      taskId: this.taskId,
      conversationId: this.conversationId,
      parentRunId: this.parentRunId,
      resumedFromMessageId: this.resumedFromMessageId,
      continuationCount: this.continuationCount,
      startedAt: this.startedAt,
      mode: this.mode,
      workspaceId: this.workspaceId,
      currentRunUnitId: this.currentRunUnitId,
      stepNumber: this.stepNumber,
      providerRetryCount: this.providerRetryCount,
      finalizationAttemptCount: this.finalizationAttemptCount,
      checkpointVersion: this.checkpointVersion,
      reportedReceiptCount: this.reportedReceiptIds.length,
      resumedPartialResponseRole: this.resumedPartialResponseRole,
      phase: this.phase,
      outcome: this.outcome,
      stopReason: this.stopReason,
      resumable: this.resumable,
      publicStatus: this.publicStatus,
      terminal: clone(this.terminal),
      lifecycle: this.lifecycle.snapshot(),
      cancellation: {
        requested: this.cancellation.requested,
        requestedAt: this.cancellation.requestedAt,
        reason: this.cancellation.reason,
        settledAt: this.cancellation.settledAt
      }
    };
  }
}
