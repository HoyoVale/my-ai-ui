import {
  createThreadRoutingDecision
} from "./ThreadRoutingDecision.js";

import {
  summarizeRoutingRollout
} from "./RoutingRolloutPolicy.js";

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = text(selector(item), 80) || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

export class ThreadRoutingDecisionStore {
  constructor({ maxDecisions = 300 } = {}) {
    this.maxDecisions = Math.max(20, Math.min(2000, Number(maxDecisions) || 300));
    this.decisions = [];
  }

  record(decision) {
    const normalized = createThreadRoutingDecision({
      ...(decision ?? {}),
      shadowMode: decision?.shadow?.enabled === true || decision?.shadowMode === true,
      legacyAction: decision?.shadow?.legacyAction ?? decision?.legacyAction ?? "",
      now: decision?.createdAt ?? decision?.now ?? Date.now()
    });
    if (!normalized) return null;
    const existingIndex = this.decisions.findIndex((item) => item.id === normalized.id);
    if (existingIndex >= 0) {
      this.decisions.splice(existingIndex, 1, normalized);
    } else {
      this.decisions.push(normalized);
    }
    if (this.decisions.length > this.maxDecisions) {
      this.decisions.splice(0, this.decisions.length - this.maxDecisions);
    }
    return clone(normalized);
  }

  update(id, patch = {}) {
    const normalizedId = text(id);
    const current = this.decisions.find((item) => item.id === normalizedId);
    if (!current) return null;
    return this.record({
      ...current,
      ...patch,
      id: current.id,
      command: patch.command ?? current.command,
      action: patch.action ?? current.action,
      state: patch.state ?? current.state,
      source: patch.source ?? current.source,
      shadowMode: patch.shadowMode ?? current.shadow.enabled,
      legacyAction: patch.legacyAction ?? current.shadow.legacyAction,
      now: current.createdAt
    });
  }

  list({ conversationId = "", runId = "", limit = 50 } = {}) {
    const normalizedConversationId = text(conversationId);
    const normalizedRunId = text(runId);
    const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    return this.decisions
      .filter((decision) => (
        (!normalizedConversationId || decision.conversationId === normalizedConversationId) &&
        (!normalizedRunId || decision.targetRunId === normalizedRunId || decision.activeRunId === normalizedRunId)
      ))
      .slice(-boundedLimit)
      .map(clone);
  }

  snapshot(filters = {}) {
    const decisions = this.list(filters);
    const rollout = summarizeRoutingRollout(decisions);
    return {
      version: 2,
      total: decisions.length,
      mismatchCount: rollout.mismatchCount,
      mismatchRate: rollout.mismatchRate,
      highRiskMismatchCount: rollout.highRiskMismatchCount,
      authorityCount: rollout.authorityCount,
      fallbackCount: rollout.fallbackCount,
      autoRollbackCount: rollout.autoRollbackCount,
      byAction: countBy(decisions, (decision) => decision.action),
      byLegacyAction: countBy(decisions, (decision) => decision.shadow.legacyAction),
      byEffectiveAction: countBy(decisions, (decision) => decision.rollout?.effectiveAction),
      byRolloutMode: countBy(decisions, (decision) => decision.rollout?.mode),
      decisions
    };
  }

  clear() {
    this.decisions = [];
  }
}

export const threadRoutingDecisionStore = new ThreadRoutingDecisionStore();
