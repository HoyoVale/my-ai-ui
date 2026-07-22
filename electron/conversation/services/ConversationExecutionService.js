import {
  applyGoalVerification as applyGoalVerificationRuntime, beginGoalRun as beginGoalRuntime,
  completeGoal as completeGoalRuntime, finishGoalRun as finishGoalRuntime, heartbeatGoal as heartbeatGoalRuntime,
  linkGoalPlatformRun as linkGoalPlatformRunRuntime, recordGoalCheckpoint as recordGoalCheckpointRuntime,
  recordGoalWorkingState as recordGoalWorkingStateRuntime, recordGoalTokenUsage as recordGoalTokenUsageRuntime,
  applyGoalPlanState as applyGoalPlanStateRuntime, replanGoal as replanGoalRuntime, transitionGoal as transitionGoalRuntime, upsertGoal
} from "../../goal/GoalRuntime.js";
import {
  beginExecutionThreadRun,
  createExecutionThread,
  finishExecutionThreadRun,
  recordExecutionThreadCheckpoint,
  setExecutionThreadProviderContinuation
} from "../../agent/ExecutionThread.js";
import {
  appendPersistedRoutingDecision,
  applyExecutionThreadCollection,
  findExecutionThread,
  sanitizeExecutionThreadCollection
} from "../../execution-model/ExecutionPersistence.js";
import * as internals from "../ConversationManagerInternals.js";

export const ConversationExecutionService = {
  beginExecutionThread({
    conversationId,
    threadId,
    taskId,
    goalId = "",
    platformRunId = "",
    objective = "",
    mode = "chat",
    workspaceId = "",
    planState = [],
    workingState = null,
    runId = "",
    relation = "",
    previousRunId = "",
    retryOfRunId = "",
    regeneratedFromRunId = "",
    userMessageId = "",
    forkedFromThreadId = "",
    forkedFromRunId = ""
  } = {}) {
    const conversation = this.findMutableConversation(
      conversationId || this.ensureLoaded().currentConversationId
    );
    if (!conversation) return { ok: false, code: "conversation-not-found" };
    const timestamp = this.now();
    const requestedThreadId = String(threadId ?? "").trim();
    const existing = findExecutionThread(conversation, requestedThreadId);
    const base = existing?.id === requestedThreadId
      ? existing
      : createExecutionThread({
          id: requestedThreadId || this.createId(),
          taskId: taskId || this.createId(),
          goalId,
          platformRunId,
          objective,
          mode,
          workspaceId,
          planState,
          workingState,
          runId,
          userMessageId,
          forkedFromThreadId,
          forkedFromRunId,
          now: timestamp
        });
    const thread = beginExecutionThreadRun(base, {
      runId,
      goalId,
      platformRunId,
      objective,
      planState,
      workingState,
      relation,
      previousRunId,
      retryOfRunId,
      regeneratedFromRunId,
      userMessageId,
      now: timestamp
    });
    if (!thread) return { ok: false, code: "execution-thread-invalid" };
    applyExecutionThreadCollection(conversation, {
      thread,
      activeThreadId: thread.id
    });
    conversation.updatedAt = timestamp;
    this.commit();
    return { ok: true, thread: internals.clone(thread) };
  },

  recordExecutionThreadCheckpoint({
    conversationId,
    threadId,
    checkpoint,
    planState = null,
    workingState = null,
    runId = ""
  } = {}) {
    const conversation = this.findMutableConversation(conversationId);
    const current = findExecutionThread(conversation, threadId);
    if (!conversation || !current) return { ok: false, code: "execution-thread-not-found" };
    if (threadId && current.id !== threadId) return { ok: false, code: "execution-thread-changed" };
    const thread = recordExecutionThreadCheckpoint(current, {
      checkpoint,
      planState,
      workingState,
      runId,
      now: this.now()
    });
    applyExecutionThreadCollection(conversation, {
      thread,
      activeThreadId: conversation.activeExecutionThreadId || thread.id
    });
    conversation.updatedAt = thread.updatedAt;
    this.commit();
    return { ok: true, thread: internals.clone(thread) };
  },

  finishExecutionThread({
    conversationId,
    threadId,
    outcome = "",
    stopReason = "",
    checkpoint = null,
    planState = null,
    workingState = null,
    lastAssistantMessageId = "",
    resumable = false
  } = {}) {
    const conversation = this.findMutableConversation(conversationId);
    const current = findExecutionThread(conversation, threadId);
    if (!conversation || !current) return { ok: false, code: "execution-thread-not-found" };
    if (threadId && current.id !== threadId) return { ok: false, code: "execution-thread-changed" };
    const thread = finishExecutionThreadRun(current, {
      outcome,
      stopReason,
      checkpoint,
      planState,
      workingState,
      lastAssistantMessageId,
      resumable,
      now: this.now()
    });
    applyExecutionThreadCollection(conversation, {
      thread,
      activeThreadId: conversation.activeExecutionThreadId || thread.id
    });
    conversation.updatedAt = thread.updatedAt;
    this.commit();
    return { ok: true, thread: internals.clone(thread) };
  },

  listExecutionThreads({ conversationId } = {}) {
    const conversation = this.getConversation(
      conversationId || this.ensureLoaded().currentConversationId
    );
    if (!conversation) return [];
    return sanitizeExecutionThreadCollection(conversation)
      .executionThreads
      .map((thread) => internals.clone(thread));
  },

  selectExecutionThread({ conversationId, threadId } = {}) {
    const conversation = this.findMutableConversation(conversationId);
    const thread = findExecutionThread(conversation, threadId);
    if (!conversation || !thread) {
      return { ok: false, code: "execution-thread-not-found" };
    }
    applyExecutionThreadCollection(conversation, {
      activeThreadId: thread.id
    });
    conversation.updatedAt = this.now();
    this.commit();
    return { ok: true, thread: internals.clone(thread) };
  },

  recordProviderContinuation({
    conversationId,
    threadId,
    continuation = null
  } = {}) {
    const conversation = this.findMutableConversation(conversationId);
    const current = findExecutionThread(conversation, threadId);
    if (!conversation || !current) {
      return { ok: false, code: "execution-thread-not-found" };
    }
    const thread = setExecutionThreadProviderContinuation(
      current,
      continuation,
      { now: this.now() }
    );
    if (!thread) {
      return { ok: false, code: "provider-continuation-invalid" };
    }
    applyExecutionThreadCollection(conversation, {
      thread,
      activeThreadId: conversation.activeExecutionThreadId || thread.id
    });
    conversation.updatedAt = thread.updatedAt;
    this.commit();
    return { ok: true, thread: internals.clone(thread) };
  },

  recordThreadRoutingDecision({
    conversationId,
    decision
  } = {}) {
    const conversation = this.findMutableConversation(conversationId);
    if (!conversation) return { ok: false, code: "conversation-not-found" };
    const recorded = appendPersistedRoutingDecision(conversation, decision);
    if (!recorded) return { ok: false, code: "routing-decision-invalid" };
    conversation.updatedAt = Math.max(conversation.updatedAt, recorded.createdAt, this.now());
    this.commit();
    return { ok: true, decision: recorded };
  },

  setGoal({
    conversationId,
    objective = "",
    status = "active",
    criteria = [],
    autoContinue = true
  } = {}) {
    const conversation = this.findMutableConversation(
      conversationId || this.ensureLoaded().currentConversationId
    );
  
    if (!conversation) {
      return {
        ok: false,
        code: "conversation-not-found",
        message: "会话不存在。"
      };
    }
  
    const result = upsertGoal(
      conversation.goal,
      {
        objective,
        status,
        criteria,
        autoContinue
      },
      {
        now: this.now(),
        createId: this.createId
      }
    );
    if (!result.ok) return result;
  
    conversation.goal = result.goal;
    conversation.updatedAt = conversation.goal?.updatedAt ?? this.now();
    this.commit();
  
    return {
      ok: true,
      conversation: internals.clone(conversation),
      goal: internals.clone(conversation.goal)
    };
  },

  completeGoal({
    conversationId,
    goalId,
    verification = null,
    completionPermit = null
  } = {}) {
    const conversation = this.findMutableConversation(conversationId);
    const goal = conversation?.goal;
  
    if (!conversation || !goal || goal.status !== "active") {
      return { ok: false, code: "goal-not-active" };
    }
  
    if (goalId && goal.id !== goalId) {
      return { ok: false, code: "goal-changed" };
    }
  
    if (verification?.verified !== true || verification?.status !== "verified") {
      return { ok: false, code: "goal-verification-required" };
    }
  
    if (!goal.platformRunId || !this.completionAuthority) {
      return { ok: false, code: "goal-completion-authority-unavailable" };
    }
  
    const authorization = this.completionAuthority.verify(
      completionPermit,
      {
        goalId: goal.id,
        goalRevision: goal.revision,
        platformRunId: goal.platformRunId
      }
    );
    if (!authorization.ok) return authorization;
  
    const completed = completeGoalRuntime(
      goal,
      {
        verification,
        completionFingerprint: authorization.fingerprint,
        now: this.now()
      }
    );
    if (!completed.ok) return completed;
  
    conversation.goal = completed.goal;
    conversation.updatedAt = completed.goal.updatedAt;
    this.commit();
  
    return {
      ok: true,
      goal: internals.clone(completed.goal)
    };
  },

  linkGoalPlatformRun({ conversationId, goalId, platformRunId } = {}) {
    const conversation = this.findMutableConversation(conversationId);
    const goal = conversation?.goal;
    if (!conversation || !goal) return { ok: false, code: "goal-not-found" };
    if (goalId && goal.id !== goalId) return { ok: false, code: "goal-changed" };
  
    const result = linkGoalPlatformRunRuntime(
      goal,
      { platformRunId, now: this.now() }
    );
    if (!result.ok) return result;
    if (!result.changed) return { ...result, goal: internals.clone(result.goal) };
  
    conversation.goal = result.goal;
    conversation.updatedAt = result.goal.updatedAt;
    this.commit();
    return { ...result, goal: internals.clone(result.goal) };
  },

  beginGoalRun({
    conversationId,
    goalId,
    runId,
    taskId = null,
    platformRunId = undefined
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => beginGoalRuntime(goal, {
        runId,
        taskId,
        platformRunId,
        now: this.now()
      })
    });
  },

  transitionGoal({
    conversationId,
    goalId,
    phase,
    reason = "",
    runId = null,
    taskId = null,
    waiting = undefined,
    resumable = undefined,
    force = false
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => transitionGoalRuntime(goal, {
        phase,
        reason,
        runId,
        taskId,
        waiting,
        resumable,
        force,
        now: this.now()
      })
    });
  },

  heartbeatGoal({
    conversationId,
    goalId,
    runId = null,
    phase = undefined
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => heartbeatGoalRuntime(goal, {
        runId,
        phase,
        now: this.now()
      })
    });
  },

  recordGoalCheckpoint({
    conversationId,
    goalId,
    checkpoint
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => recordGoalCheckpointRuntime(
        goal,
        checkpoint,
        { now: this.now() }
      )
    });
  },

  recordGoalWorkingState({
    conversationId,
    goalId,
    patch = {}
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => recordGoalWorkingStateRuntime(
        goal,
        patch,
        { now: this.now() }
      )
    });
  },

  recordGoalTokenUsage({
    conversationId,
    goalId,
    ledger
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => recordGoalTokenUsageRuntime(
        goal,
        ledger,
        { now: this.now() }
      )
    });
  },

  recordGoalPlan({
    conversationId,
    goalId,
    planState,
    runId = null,
    authorityAction = "progress"
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => applyGoalPlanStateRuntime(
        goal,
        planState,
        {
          runId,
          authorityAction,
          now: this.now()
        }
      )
    });
  },

  replanGoal({
    conversationId,
    goalId,
    planState,
    reason = "",
    failedAssumption = "",
    runId = null
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => replanGoalRuntime(
        goal,
        {
          planState,
          reason,
          failedAssumption,
          runId
        },
        { now: this.now() }
      )
    });
  },

  finishGoalRun({
    conversationId,
    goalId,
    runId = null,
    outcome = "",
    stopReason = "",
    error = "",
    recoverable = undefined
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => finishGoalRuntime(goal, {
        runId,
        outcome,
        stopReason,
        error,
        recoverable,
        now: this.now()
      })
    });
  },

  mutateGoalRuntime({ conversationId, goalId, mutate } = {}) {
    const conversation = this.findMutableConversation(conversationId);
    const goal = conversation?.goal;
    if (!conversation || !goal) return { ok: false, code: "goal-not-found" };
    if (goalId && goal.id !== goalId) return { ok: false, code: "goal-changed" };
    if (typeof mutate !== "function") {
      return { ok: false, code: "goal-mutation-required" };
    }
  
    const result = mutate(goal);
    if (!result?.ok) return result;
    if (result.changed === false) {
      return { ...result, goal: internals.clone(result.goal) };
    }
  
    conversation.goal = result.goal;
    conversation.updatedAt = result.goal.updatedAt;
    this.commit();
    return { ...result, goal: internals.clone(result.goal) };
  },

  recordGoalVerification({ conversationId, goalId, verification } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => applyGoalVerificationRuntime(
        goal,
        verification,
        { now: this.now() }
      )
    });
  }
};
