import {
  ROUTING_DECISION_STATES,
  createThreadRoutingDecision
} from "./ThreadRoutingDecision.js";

import {
  evaluateRoutingRollout
} from "./RoutingRolloutPolicy.js";

import {
  threadRoutingDecisionStore
} from "./ThreadRoutingDecisionStore.js";

export class RoutingRolloutController {
  constructor({
    decisionStore = threadRoutingDecisionStore
  } = {}) {
    this.decisionStore = decisionStore;
  }

  evaluate({
    decision,
    conversation = null,
    activeRun = null,
    settings = {}
  } = {}) {
    if (!decision) return null;
    const history = this.decisionStore.list({
      limit: Number(settings?.windowSize) || 100
    });
    const rollout = evaluateRoutingRollout({
      decision,
      conversation,
      activeRun,
      settings,
      history
    });
    return createThreadRoutingDecision({
      ...decision,
      rollout,
      shadowMode: decision.shadow?.enabled === true,
      legacyAction: decision.shadow?.legacyAction,
      now: decision.createdAt
    });
  }

  markApplied(decision, patch = {}) {
    if (!decision) return null;
    return createThreadRoutingDecision({
      ...decision,
      ...patch,
      state: ROUTING_DECISION_STATES.APPLIED,
      rollout: {
        ...decision.rollout,
        ...(patch.rollout ?? {})
      },
      shadowMode: decision.shadow?.enabled === true,
      legacyAction: decision.shadow?.legacyAction,
      now: decision.createdAt
    });
  }

  markRejected(decision, reason = "routing-application-rejected") {
    if (!decision) return null;
    return createThreadRoutingDecision({
      ...decision,
      state: ROUTING_DECISION_STATES.REJECTED,
      reason,
      rollout: {
        ...decision.rollout,
        authority: false,
        reason
      },
      shadowMode: decision.shadow?.enabled === true,
      legacyAction: decision.shadow?.legacyAction,
      now: decision.createdAt
    });
  }
}

export const routingRolloutController = new RoutingRolloutController();
