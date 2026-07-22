import crypto from "node:crypto";

import { ConversationStateService } from "./services/ConversationStateService.js";
import { ConversationExecutionService } from "./services/ConversationExecutionService.js";
import { ConversationMessageService } from "./services/ConversationMessageService.js";
import { ConversationToolRecoveryService } from "./services/ConversationToolRecoveryService.js";

export class ConversationManager {
  constructor({
    store,
    getSettings,
    now = () => Date.now(),
    createId = () =>
      crypto.randomUUID(),
    getWorkspaceById = () => null,
    createWorkspaceSnapshot = (workspace) =>
      workspace
        ? {
            id: String(workspace.id ?? ""),
            name: String(workspace.name ?? "工作区"),
            rootPath: String(workspace.rootPath ?? ""),
            canonicalPath: String(
              workspace.canonicalPath ?? workspace.rootPath ?? ""
            )
          }
        : null,
    onChange = () => {},
    completionAuthority = null
  }) {
    if (!store) {
      throw new TypeError(
        "ConversationManager requires a store."
      );
    }
  
    this.store = store;
  
    this.getSettings =
      typeof getSettings ===
        "function"
        ? getSettings
        : () => ({
            conversation: {
              contextTurns: 8,
              maxConversations: 100,
              autoTitle: true,
              saveAbortedReplies: true
            }
          });
  
    this.now = now;
    this.createId =
      createId;
    this.getWorkspaceById =
      typeof getWorkspaceById === "function"
        ? getWorkspaceById
        : () => null;
    this.createWorkspaceSnapshot =
      typeof createWorkspaceSnapshot === "function"
        ? createWorkspaceSnapshot
        : () => null;
    this.onChange =
      onChange;
    this.completionAuthority = completionAuthority;
  
    this.data = null;
  }

  ensureLoaded(...args) {
    return ConversationStateService.ensureLoaded.apply(this, args);
  }

  resolveWorkspaceBinding(...args) {
    return ConversationStateService.resolveWorkspaceBinding.apply(this, args);
  }

  currentWorkspaceId(...args) {
    return ConversationStateService.currentWorkspaceId.apply(this, args);
  }

  currentMode(...args) {
    return ConversationStateService.currentMode.apply(this, args);
  }

  getState(...args) {
    return ConversationStateService.getState.apply(this, args);
  }

  list(...args) {
    return ConversationStateService.list.apply(this, args);
  }

  getConversation(...args) {
    return ConversationStateService.getConversation.apply(this, args);
  }

  getCurrentConversation(...args) {
    return ConversationStateService.getCurrentConversation.apply(this, args);
  }

  create(...args) {
    return ConversationStateService.create.apply(this, args);
  }

  findRecentConversation(...args) {
    return ConversationStateService.findRecentConversation.apply(this, args);
  }

  navigateContext(...args) {
    return ConversationStateService.navigateContext.apply(this, args);
  }

  setModelSelection(...args) {
    return ConversationStateService.setModelSelection.apply(this, args);
  }

  setSkillSelection(...args) {
    return ConversationStateService.setSkillSelection.apply(this, args);
  }

  switchWorkspace(...args) {
    return ConversationStateService.switchWorkspace.apply(this, args);
  }

  switchMode(...args) {
    return ConversationStateService.switchMode.apply(this, args);
  }

  rename(...args) {
    return ConversationStateService.rename.apply(this, args);
  }

  beginExecutionThread(...args) {
    return ConversationExecutionService.beginExecutionThread.apply(this, args);
  }

  recordExecutionThreadCheckpoint(...args) {
    return ConversationExecutionService.recordExecutionThreadCheckpoint.apply(this, args);
  }

  finishExecutionThread(...args) {
    return ConversationExecutionService.finishExecutionThread.apply(this, args);
  }

  setGoal(...args) {
    return ConversationExecutionService.setGoal.apply(this, args);
  }

  completeGoal(...args) {
    return ConversationExecutionService.completeGoal.apply(this, args);
  }

  linkGoalPlatformRun(...args) {
    return ConversationExecutionService.linkGoalPlatformRun.apply(this, args);
  }

  beginGoalRun(...args) {
    return ConversationExecutionService.beginGoalRun.apply(this, args);
  }

  transitionGoal(...args) {
    return ConversationExecutionService.transitionGoal.apply(this, args);
  }

  heartbeatGoal(...args) {
    return ConversationExecutionService.heartbeatGoal.apply(this, args);
  }

  recordGoalCheckpoint(...args) {
    return ConversationExecutionService.recordGoalCheckpoint.apply(this, args);
  }

  recordGoalWorkingState(...args) {
    return ConversationExecutionService.recordGoalWorkingState.apply(this, args);
  }

  recordGoalTokenUsage(...args) {
    return ConversationExecutionService.recordGoalTokenUsage.apply(this, args);
  }

  recordGoalPlan(...args) {
    return ConversationExecutionService.recordGoalPlan.apply(this, args);
  }

  replanGoal(...args) {
    return ConversationExecutionService.replanGoal.apply(this, args);
  }

  finishGoalRun(...args) {
    return ConversationExecutionService.finishGoalRun.apply(this, args);
  }

  mutateGoalRuntime(...args) {
    return ConversationExecutionService.mutateGoalRuntime.apply(this, args);
  }

  recordGoalVerification(...args) {
    return ConversationExecutionService.recordGoalVerification.apply(this, args);
  }

  select(...args) {
    return ConversationStateService.select.apply(this, args);
  }

  delete(...args) {
    return ConversationStateService.delete.apply(this, args);
  }

  clearAll(...args) {
    return ConversationStateService.clearAll.apply(this, args);
  }

  appendMessage(...args) {
    return ConversationMessageService.appendMessage.apply(this, args);
  }

  prepareRegeneration(...args) {
    return ConversationMessageService.prepareRegeneration.apply(this, args);
  }

  replaceAssistantMessage(...args) {
    return ConversationMessageService.replaceAssistantMessage.apply(this, args);
  }

  applyAssistantMetadata(...args) {
    return ConversationMessageService.applyAssistantMetadata.apply(this, args);
  }

  recoverInterruptedRuns(...args) {
    return ConversationMessageService.recoverInterruptedRuns.apply(this, args);
  }

  buildContext(...args) {
    return ConversationMessageService.buildContext.apply(this, args);
  }

  resetContext(...args) {
    return ConversationMessageService.resetContext.apply(this, args);
  }

  updateMessageContext(...args) {
    return ConversationMessageService.updateMessageContext.apply(this, args);
  }

  findMutableConversation(...args) {
    return ConversationStateService.findMutableConversation.apply(this, args);
  }

  getConversationSettings(...args) {
    return ConversationStateService.getConversationSettings.apply(this, args);
  }

  prune(...args) {
    return ConversationStateService.prune.apply(this, args);
  }

  getTaskRuntimeRecord(...args) {
    return ConversationToolRecoveryService.getTaskRuntimeRecord.apply(this, args);
  }

  listToolRuntimeRecoveryHistory(...args) {
    return ConversationToolRecoveryService.listToolRuntimeRecoveryHistory.apply(this, args);
  }

  updateToolRuntimeRecovery(...args) {
    return ConversationToolRecoveryService.updateToolRuntimeRecovery.apply(this, args);
  }

  reconcileSettings(...args) {
    return ConversationStateService.reconcileSettings.apply(this, args);
  }

  commit(...args) {
    return ConversationStateService.commit.apply(this, args);
  }

  toSummary(...args) {
    return ConversationStateService.toSummary.apply(this, args);
  }
}
