import {
  sanitizeGoal
} from "../goal/GoalRuntime.js";

import {
  createLegacyActivity,
  deriveLegacyActivityFields,
  sanitizeActivity,
  sanitizeActivityTool
} from "./activitySchema.js";

import {
  normalizeRunStopReason
} from "../agent/runStopReasons.js";

import {
  compactPlanState
} from "../agent/planState.js";

import {
  sanitizeTokenLedgerSnapshot
} from "../agent/TokenLedger.js";

import {
  sanitizeExecutionThreadCollection
} from "../execution-model/ExecutionPersistence.js";

import {
  createSkillSnapshot,
  createSkillSnapshots
} from "../skills/skillSnapshot.js";

const STORE_VERSION = 23;


function sanitizeDiffSummary(source) {
  if (!source || typeof source !== "object") return null;
  const files = (Array.isArray(source.files) ? source.files : [])
    .slice(0, 200)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const path = String(item.path ?? "").slice(0, 500);
      if (!path) return null;
      return {
        path,
        oldPath: String(item.oldPath ?? "").slice(0, 500),
        status: String(item.status ?? "modified").slice(0, 40),
        binary: item.binary === true,
        beforeSha256: String(item.beforeSha256 ?? "").slice(0, 80),
        afterSha256: String(item.afterSha256 ?? "").slice(0, 80),
        beforeBytes: Math.max(0, Number(item.beforeBytes) || 0),
        afterBytes: Math.max(0, Number(item.afterBytes) || 0),
        added: Math.max(0, Number(item.added) || 0),
        removed: Math.max(0, Number(item.removed) || 0),
        diff: String(item.diff ?? "").slice(0, 180000),
        truncated: item.truncated === true
      };
    })
    .filter(Boolean);
  if (!files.length) return null;
  const totals = source.totals && typeof source.totals === "object" ? source.totals : {};
  return {
    version: 1,
    runId: String(source.runId ?? "").slice(0, 120),
    workspaceId: String(source.workspaceId ?? "").slice(0, 120),
    revision: Math.max(0, Number(source.revision) || 0),
    files,
    totals: {
      files: files.length,
      added: Math.max(0, Number(totals.added) || 0),
      removed: Math.max(0, Number(totals.removed) || 0),
      addedFiles: Math.max(0, Number(totals.addedFiles) || 0),
      deletedFiles: Math.max(0, Number(totals.deletedFiles) || 0),
      renamedFiles: Math.max(0, Number(totals.renamedFiles) || 0),
      binaryFiles: Math.max(0, Number(totals.binaryFiles) || 0)
    },
    empty: false
  };
}

const MESSAGE_ROLES =
  new Set([
    "user",
    "assistant"
  ]);

const MESSAGE_STATUSES =
  new Set([
    "running",
    "complete",
    "aborted",
    "interrupted"
  ]);

const SESSION_MODES = new Set([
  "chat",
  "coding"
]);

function sanitizeModelSelection(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const providerId = nullableStringValue(
    source.providerId,
    120
  );
  const modelConfigId = nullableStringValue(
    source.modelConfigId ?? source.modelId,
    120
  );

  return providerId && modelConfigId
    ? { providerId, modelConfigId }
    : null;
}

function sanitizeModelSnapshot(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const providerId = nullableStringValue(source.providerId, 120);
  const modelConfigId = nullableStringValue(
    source.modelConfigId ?? source.id,
    120
  );

  if (!providerId || !modelConfigId) {
    return null;
  }

  return {
    providerId,
    providerName: stringValue(source.providerName, providerId, 120).trim() || providerId,
    modelConfigId,
    modelName: stringValue(source.modelName, source.modelId ?? modelConfigId, 160).trim() || modelConfigId,
    modelId: stringValue(source.modelId, modelConfigId, 200).trim() || modelConfigId
  };
}

function stringValue(
  value,
  fallback = "",
  maxLength = 200000
) {
  if (
    typeof value !== "string"
  ) {
    return fallback;
  }

  return value.slice(
    0,
    maxLength
  );
}

function nullableStringValue(
  value,
  maxLength = 120
) {
  const normalized = stringValue(
    value,
    "",
    maxLength
  ).trim();

  return normalized || null;
}

function sanitizeWorkspaceSnapshot(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const id = nullableStringValue(source.id, 120);
  const rootPath = stringValue(
    source.rootPath ?? source.canonicalPath,
    "",
    2000
  ).trim();

  if (!id || !rootPath) {
    return null;
  }

  return {
    id,
    name: stringValue(
      source.name,
      "工作区",
      120
    ).trim() || "工作区",
    rootPath,
    canonicalPath: stringValue(
      source.canonicalPath,
      rootPath,
      2000
    ).trim() || rootPath
  };
}


function sanitizeSkillSnapshot(source) {
  return createSkillSnapshot(source);
}

function sanitizeSkillRun(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const id = nullableStringValue(source.id ?? source.skillId, 120);
  const skills = createSkillSnapshots(
    Array.isArray(source.skills) ? source.skills : source.skill ? [source.skill] : [],
    12
  );
  if (!id && !skills.length) {
    return null;
  }

  const primary = skills[0] ?? null;
  const normalizedId = id ?? primary?.id;
  const status = ["running", "completed", "failed", "cancelled", "interrupted"]
    .includes(source.status)
    ? source.status
    : "completed";

  return {
    id: normalizedId,
    name: stringValue(source.name, primary?.name ?? normalizedId, 120).trim() || normalizedId,
    version: stringValue(source.version, primary?.version ?? "", 80).trim(),
    status,
    source: ["manual", "command", "router", "dependency", "none"].includes(source.source)
      ? source.source
      : "manual",
    routingMode: source.routingMode === "auto" ? "auto" : "manual",
    skills,
    rootSkillIds: Array.isArray(source.rootSkillIds)
      ? [...new Set(source.rootSkillIds.map((item) => stringValue(item, "", 120).trim()).filter(Boolean))].slice(0, 4)
      : normalizedId ? [normalizedId] : [],
    dependencySkillIds: Array.isArray(source.dependencySkillIds)
      ? [...new Set(source.dependencySkillIds.map((item) => stringValue(item, "", 120).trim()).filter(Boolean))].slice(0, 12)
      : [],
    router: source.router && typeof source.router === "object"
      ? {
          matched: source.router.matched === true,
          selected: source.router.selected && typeof source.router.selected === "object"
            ? {
                id: stringValue(source.router.selected.id, "", 120).trim(),
                name: stringValue(source.router.selected.name, "", 120).trim(),
                score: Math.max(0, Number(source.router.selected.score) || 0),
                reasons: Array.isArray(source.router.selected.reasons)
                  ? source.router.selected.reasons.map((item) => stringValue(item, "", 160).trim()).filter(Boolean).slice(0, 6)
                  : []
              }
            : null,
          reason: stringValue(source.router.reason, "", 400).trim()
        }
      : null,
    requiredCapabilities: Array.isArray(source.requiredCapabilities)
      ? source.requiredCapabilities.map((item) => stringValue(item, "", 160).trim()).filter(Boolean).slice(0, 64)
      : [],
    optionalCapabilities: Array.isArray(source.optionalCapabilities)
      ? source.optionalCapabilities.map((item) => stringValue(item, "", 160).trim()).filter(Boolean).slice(0, 64)
      : [],
    selectedToolNames: Array.isArray(source.selectedToolNames)
      ? source.selectedToolNames.map((item) => stringValue(item, "", 160).trim()).filter(Boolean).slice(0, 100)
      : [],
    missingRequired: Array.isArray(source.missingRequired)
      ? source.missingRequired.map((item) => stringValue(item, "", 160).trim()).filter(Boolean).slice(0, 64)
      : [],
    startedAt: timestampValue(source.startedAt, 0),
    endedAt: source.endedAt === null ? null : timestampValue(source.endedAt, 0)
  };
}

function timestampValue(
  value,
  fallback
) {
  const numeric =
    Number(value);

  return Number.isFinite(
    numeric
  )
    ? Math.max(
        0,
        Math.round(numeric)
      )
    : fallback;
}

function booleanValue(
  value,
  fallback
) {
  return typeof value ===
    "boolean"
    ? value
    : fallback;
}


function sanitizePlanItem(
  source,
  index
) {
  if (
    !source ||
    typeof source !== "object"
  ) {
    return null;
  }

  const title = stringValue(
    source.title,
    "",
    200
  ).trim();

  if (!title) {
    return null;
  }

  const status = [
    "pending",
    "in_progress",
    "completed",
    "blocked",
    "needs_input",
    "skipped",
    "cancelled",
    "superseded"
  ].includes(source.status)
    ? source.status
    : "pending";

  return {
    id:
      stringValue(
        source.id,
        `step-${index + 1}`,
        80
      ) || `step-${index + 1}`,
    title,
    status,
    reason: stringValue(
      source.reason,
      "",
      300
    ).trim()
  };
}
function sanitizeToolCall(
  source,
  index
) {
  return sanitizeActivityTool(
    source,
    index
  );
}

export function createEmptyConversationData() {
  return {
    version: STORE_VERSION,
    currentConversationId: null,
    conversations: []
  };
}

export function sanitizeMessage(
  source,
  fallbackTimestamp = 0,
  fallbackId = null
) {
  if (
    !source ||
    typeof source !== "object"
  ) {
    return null;
  }

  const role =
    MESSAGE_ROLES.has(
      source.role
    )
      ? source.role
      : null;

  const legacyQuestion =
    role === "assistant" &&
    source.pendingQuestion &&
    typeof source.pendingQuestion === "object"
      ? stringValue(
          source.pendingQuestion.question,
          "",
          1000
        ).trim()
      : "";
  const legacyAnswer =
    legacyQuestion
      ? stringValue(
          source.pendingQuestion?.answer,
          "",
          2000
        ).trim()
      : "";
  const sourceContent =
    stringValue(
      source.content
    ).trim();
  const content =
    sourceContent ||
    (legacyQuestion
      ? legacyAnswer
        ? `已记录的信息：${legacyQuestion}\n\n回答：${legacyAnswer}`
        : `需要补充信息：${legacyQuestion}`
      : "");

  const canStoreEmptyAssistant =
    role === "assistant" &&
    Boolean(source.activity);

  if (
    !role ||
    (
      !content &&
      !canStoreEmptyAssistant
    )
  ) {
    return null;
  }

  const status =
    source.status === "waiting"
      ? "complete"
      : MESSAGE_STATUSES.has(
          source.status
        )
        ? source.status
        : "complete";

  const includeInContext =
    booleanValue(
      source.includeInContext,
      true
    );

  const message = {
    id:
      stringValue(
        source.id,
        "",
        100
      ) || fallbackId,

    role,
    content,
    status,

    includeInContext,

    pinnedToContext:
      includeInContext &&
      booleanValue(
        source.pinnedToContext,
        false
      ),

    createdAt:
      timestampValue(
        source.createdAt,
        fallbackTimestamp
      )
  };

  if (role === "assistant") {
    const durationMs =
      timestampValue(
        source.durationMs,
        0
      );

    const sourceToolCalls =
      Array.isArray(
        source.toolCalls
      )
        ? source.toolCalls
            .map(
              sanitizeToolCall
            )
            .filter(Boolean)
            .slice(0, 100)
        : [];

    const normalizedPlanState = compactPlanState(
      source.planState && typeof source.planState === "object"
        ? source.planState
        : Array.isArray(source.plan)
          ? source.plan
          : [],
      {
        maxRootItems: 20,
        maxSubplans: 12,
        maxSubplanItems: 20
      }
    );
    const sourcePlan = normalizedPlanState.rootItems
      .map(sanitizePlanItem)
      .filter(Boolean)
      .slice(0, 20);

    const migratedPlan =
      legacyQuestion && !legacyAnswer
        ? sourcePlan.map((item) =>
            item.status === "in_progress"
              ? {
                  ...item,
                  status: "needs_input",
                  reason: item.reason || legacyQuestion
                }
              : item
          )
        : sourcePlan;

    const sourceTaskId =
      stringValue(
        source.taskId,
        "",
        120
      );

    const legacyStopReason =
      legacyQuestion && !legacyAnswer
        ? "needs_input"
        : normalizeRunStopReason(
            source.stopReason,
            status === "aborted"
              ? "cancelled_by_user"
              : "completed"
          );

    const hasLegacyActivity =
      durationMs > 0 ||
      sourceToolCalls.length > 0 ||
      migratedPlan.length > 0 ||
      Boolean(source.stopReason) ||
      Boolean(legacyQuestion);

    const activity =
      sanitizeActivity(
        source.activity
      ) ??
      (hasLegacyActivity
        ? createLegacyActivity({
            messageId:
              message.id ?? fallbackId,
            createdAt:
              message.createdAt,
            durationMs,
            toolCalls:
              sourceToolCalls,
            plan: migratedPlan,
            stopReason:
              legacyStopReason,
            taskId:
              sourceTaskId
          })
        : null);

    const derived =
      deriveLegacyActivityFields(
        activity
      );

    const toolCalls =
      sourceToolCalls.length > 0
        ? sourceToolCalls
        : derived.toolCalls;
    const plan =
      migratedPlan.length > 0
        ? migratedPlan
        : derived.plan;

    if (durationMs > 0) {
      message.durationMs =
        durationMs;
    } else if (
      activity?.durationMs > 0
    ) {
      message.durationMs =
        activity.durationMs;
    }

    if (toolCalls.length > 0) {
      message.toolCalls =
        toolCalls;
    }

    if (plan.length > 0) {
      message.plan = plan;
    }

    if (
      plan.length > 0 ||
      normalizedPlanState.subplans.length > 0
    ) {
      message.planState = {
        ...normalizedPlanState,
        rootItems: migratedPlan.length > 0 ? migratedPlan : plan
      };
    }

    if (activity) {
      message.activity =
        activity;
      message.taskId =
        activity.taskId ||
        sourceTaskId ||
        message.id;
      message.stopReason =
        activity.stopReason;
    } else {
      message.stopReason =
        legacyStopReason;
    }

    const skillRun = sanitizeSkillRun(source.skillRun);
    if (skillRun) {
      message.skillRun = skillRun;
    }

    const tokenLedger = sanitizeTokenLedgerSnapshot(source.tokenLedger);
    if (tokenLedger) {
      message.tokenLedger = tokenLedger;
    }

    const diffSummary = sanitizeDiffSummary(source.diffSummary);
    if (diffSummary) {
      message.diffSummary = diffSummary;
    }

    const resumedFromMessageId =
      stringValue(
        source.resumedFromMessageId,
        "",
        100
      );

    if (resumedFromMessageId) {
      message.resumedFromMessageId =
        resumedFromMessageId;
    }

    const executionThreadId = stringValue(
      source.executionThreadId,
      "",
      120
    );
    if (executionThreadId) {
      message.executionThreadId = executionThreadId;
    }
  }

  return message;
}

export function sanitizeConversation(
  source,
  fallbackTimestamp = 0
) {
  if (
    !source ||
    typeof source !== "object"
  ) {
    return null;
  }

  const id =
    stringValue(
      source.id,
      "",
      100
    );

  if (!id) {
    return null;
  }

  const createdAt =
    timestampValue(
      source.createdAt,
      fallbackTimestamp
    );

  const messages =
    Array.isArray(
      source.messages
    )
      ? source.messages
          .map((message, index) =>
            sanitizeMessage(
              message,
              createdAt,
              `${id}-message-${index + 1}`
            )
          )
          .filter(Boolean)
      : [];

  const messageIds =
    new Set(
      messages.map(
        (message) =>
          message.id
      )
    );

  const requestedBoundary =
    stringValue(
      source.contextStartAfterMessageId,
      "",
      100
    );

  const updatedAt =
    Math.max(
      createdAt,
      timestampValue(
        source.updatedAt,
        createdAt
      ),
      ...messages.map(
        (message) =>
          message.createdAt
      )
    );

  const workspaceId = nullableStringValue(
    source.workspaceId,
    120
  );
  const workspaceSnapshot =
    sanitizeWorkspaceSnapshot(
      source.workspaceSnapshot
    );
  const mode = SESSION_MODES.has(source.mode)
    ? source.mode
    : workspaceId
      ? "coding"
      : "chat";
  const legacySkillId = nullableStringValue(
    source.skillId ?? source.activeSkillId,
    120
  );
  const legacySkillSnapshot = sanitizeSkillSnapshot(
    source.skillSnapshot ?? source.activeSkill
  );
  const skillIds = [
    ...new Set(
      (Array.isArray(source.skillIds)
        ? source.skillIds
        : legacySkillId
          ? [legacySkillId]
          : [])
        .map((item) => nullableStringValue(item, 120))
        .filter(Boolean)
    )
  ].slice(0, 4);
  const skillSnapshots = createSkillSnapshots(
    Array.isArray(source.skillSnapshots)
      ? source.skillSnapshots
      : legacySkillSnapshot
        ? [legacySkillSnapshot]
        : [],
    12
  );
  const skillId = skillIds[0] ?? null;
  const skillSnapshot = skillSnapshots.find((snapshot) => snapshot.id === skillId) ?? null;
  const modelSelection = sanitizeModelSelection(
    source.modelSelection
  );
  const modelSnapshot = sanitizeModelSnapshot(
    source.modelSnapshot
  );
  const goal = sanitizeGoal(source.goal);
  const executionPersistence = sanitizeExecutionThreadCollection(source);

  return {
    id,
    mode,

    workspaceId,
    workspaceSnapshot:
      workspaceId && workspaceSnapshot?.id === workspaceId
        ? workspaceSnapshot
        : null,

    skillId,
    skillSnapshot,
    skillIds,
    skillSnapshots,
    skillRoutingMode: source.skillRoutingMode === "auto" ? "auto" : "manual",

    modelSelection,
    modelSnapshot:
      modelSelection &&
      modelSnapshot?.providerId === modelSelection.providerId &&
      modelSnapshot?.modelConfigId === modelSelection.modelConfigId
        ? modelSnapshot
        : null,

    goal,
    activeExecutionThreadId: executionPersistence.activeExecutionThreadId,
    executionThreads: executionPersistence.executionThreads,
    executionThread: executionPersistence.executionThread,
    routingDecisions: executionPersistence.routingDecisions,

    title:
      stringValue(
        source.title,
        "新会话",
        80
      ).trim() || "新会话",

    contextStartAfterMessageId:
      messageIds.has(
        requestedBoundary
      )
        ? requestedBoundary
        : null,

    createdAt,
    updatedAt,
    messages
  };
}

export function sanitizeConversationData(
  source
) {
  const fallback =
    createEmptyConversationData();

  if (
    !source ||
    typeof source !== "object"
  ) {
    return fallback;
  }

  const conversations =
    Array.isArray(
      source.conversations
    )
      ? source.conversations
          .map((conversation) =>
            sanitizeConversation(
              conversation
            )
          )
          .filter(Boolean)
      : [];

  const unique = [];
  const seenIds =
    new Set();

  for (
    const conversation
    of conversations
  ) {
    if (
      seenIds.has(
        conversation.id
      )
    ) {
      continue;
    }

    seenIds.add(
      conversation.id
    );

    unique.push(
      conversation
    );
  }

  unique.sort(
    (left, right) =>
      right.updatedAt -
      left.updatedAt
  );

  const requestedCurrentId =
    stringValue(
      source.currentConversationId,
      "",
      100
    );

  const currentConversationId =
    unique.some(
      (conversation) =>
        conversation.id ===
        requestedCurrentId
    )
      ? requestedCurrentId
      : unique[0]?.id ??
        null;

  return {
    version: STORE_VERSION,
    currentConversationId,
    conversations: unique
  };
}
