export const EXECUTION_MODEL_VERSION = 2;

export const EXECUTION_MODEL_ENTITIES = Object.freeze({
  CONVERSATION: "conversation",
  THREAD: "execution_thread",
  RUN: "run",
  ITEM: "execution_item",
  GOAL: "goal",
  PLAN: "plan",
  PLATFORM_RUN: "platform_run",
  AGENT_RUN: "agent_run",
  JOB: "long_running_job"
});

export const EXECUTION_MODEL_ROLES = Object.freeze({
  [EXECUTION_MODEL_ENTITIES.CONVERSATION]: Object.freeze({
    purpose: "ui_message_container",
    authority: "ConversationManager"
  }),
  [EXECUTION_MODEL_ENTITIES.THREAD]: Object.freeze({
    purpose: "durable_task_identity",
    authority: "ExecutionThreadService"
  }),
  [EXECUTION_MODEL_ENTITIES.RUN]: Object.freeze({
    purpose: "accepted_user_input_execution",
    authority: "RunStateMachine"
  }),
  [EXECUTION_MODEL_ENTITIES.ITEM]: Object.freeze({
    purpose: "ordered_execution_projection",
    authority: "ExecutionItemProjector"
  }),
  [EXECUTION_MODEL_ENTITIES.GOAL]: Object.freeze({
    purpose: "cross_run_objective",
    authority: "GoalRuntime"
  }),
  [EXECUTION_MODEL_ENTITIES.PLAN]: Object.freeze({
    purpose: "execution_plan",
    authority: "PlanAuthority"
  }),
  [EXECUTION_MODEL_ENTITIES.PLATFORM_RUN]: Object.freeze({
    purpose: "multi_agent_orchestration",
    authority: "PlatformRunService"
  }),
  [EXECUTION_MODEL_ENTITIES.AGENT_RUN]: Object.freeze({
    purpose: "worker_or_reviewer_execution",
    authority: "PlatformTaskService"
  }),
  [EXECUTION_MODEL_ENTITIES.JOB]: Object.freeze({
    purpose: "durable_background_work",
    authority: "PlatformLongRunningService"
  })
});

export const EXECUTION_STATE_AUTHORITIES = Object.freeze({
  threadContinuity: "ExecutionThreadService",
  runLifecycle: "RunStateMachine",
  runOutcome: "RunOutcomeResolver",
  plan: "PlanAuthority",
  toolLifecycle: "ToolRuntime",
  toolFailure: "ToolErrorClassifier",
  diff: "RunDiffTracker",
  tokenUsage: "TokenLedger",
  goal: "GoalRuntime",
  platformTask: "PlatformTaskService",
  platformCompletion: "CompletionAuthority",
  publicText: "PublicTextSanitizer",
  itemProjection: "ExecutionItemProjector",
  routing: "ExecutionThreadRouter"
});

export const EXECUTION_MODEL_INVARIANTS = Object.freeze([
  "run_has_one_thread",
  "item_has_one_run_or_thread_scope",
  "terminal_run_is_immutable",
  "continuation_creates_new_run",
  "thread_has_one_workspace_snapshot",
  "ordinary_task_has_no_synthetic_goal",
  "plan_has_one_authority",
  "goal_has_one_authority",
  "platform_task_has_one_authority",
  "ui_consumes_projection",
  "item_does_not_copy_large_results",
  "provider_continuation_is_not_authority",
  "routing_is_auditable"
]);

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function validateExecutionOwnership({
  threadId,
  run = null,
  item = null
} = {}) {
  const expectedThreadId = text(threadId);
  const errors = [];

  if (!expectedThreadId) {
    errors.push("thread-id-required");
  }

  if (run && text(run.threadId) !== expectedThreadId) {
    errors.push("run-thread-mismatch");
  }

  if (item && text(item.threadId) !== expectedThreadId) {
    errors.push("item-thread-mismatch");
  }

  if (
    run &&
    item &&
    item.scope !== "thread" &&
    text(item.runId) !== text(run.id)
  ) {
    errors.push("item-run-mismatch");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function authorityForExecutionState(stateName) {
  return EXECUTION_STATE_AUTHORITIES[text(stateName, 80)] ?? "";
}
