import crypto from "node:crypto";
import path from "node:path";

import { CompletionAuthority } from "./CompletionAuthority.js";
import { PlatformEventJournal } from "./PlatformEventJournal.js";
import { PlatformSnapshotStore } from "./PlatformSnapshotStore.js";
import { PlatformStateProjector } from "./state/PlatformStateProjector.js";
import { PlatformRunService } from "./runs/PlatformRunService.js";
import { PlatformTaskService } from "./tasks/PlatformTaskService.js";
import { PlatformLeaseService } from "./leases/PlatformLeaseService.js";
import { PlatformLongRunningService } from "./jobs/PlatformLongRunningService.js";
import { PlatformCompletionService } from "./completion/PlatformCompletionService.js";
import { PlatformExecutionBridgeService } from "./bridge/PlatformExecutionBridgeService.js";

export class PlatformKernel {
  constructor({
    getStorageDirectory,
    now = () => Date.now(),
    createId = () => crypto.randomUUID(),
    leaseTtlMs = 90_000,
    durableJournal = true,
    completionAuthority = null,
    onChange = () => {}
  } = {}) {
    if (typeof getStorageDirectory !== "function") {
      throw new TypeError("PlatformKernel requires getStorageDirectory().");
    }
  
    this.getStorageDirectory = getStorageDirectory;
    this.now = now;
    this.createId = createId;
    this.leaseTtlMs = Math.max(5_000, Number(leaseTtlMs) || 90_000);
    this.onChange = typeof onChange === "function" ? onChange : () => {};
    this.state = null;
    this.lastSnapshotError = null;
  
    const file = (name) => path.join(this.getStorageDirectory(), name);
    this.journal = new PlatformEventJournal({
      getFilePath: () => file("platform-journal.jsonl"),
      now,
      createId,
      durable: durableJournal
    });
    this.snapshots = new PlatformSnapshotStore({
      getFilePath: () => file("platform-snapshot.json")
    });
    this.completionAuthority = completionAuthority ?? new CompletionAuthority({
      getKeyPath: () => file("completion-authority.key"),
      now
    });
  }

  ensureLoaded(...args) {
    return PlatformStateProjector.ensureLoaded.apply(this, args);
  }

  applyEvent(...args) {
    return PlatformStateProjector.applyEvent.apply(this, args);
  }

  commit(...args) {
    return PlatformStateProjector.commit.apply(this, args);
  }

  invalidateCompletionState(...args) {
    return PlatformRunService.invalidateCompletionState.apply(this, args);
  }

  recordFailure(...args) {
    return PlatformRunService.recordFailure.apply(this, args);
  }

  recordReplan(...args) {
    return PlatformRunService.recordReplan.apply(this, args);
  }

  bindEvidence(...args) {
    return PlatformRunService.bindEvidence.apply(this, args);
  }

  findReusableRun(...args) {
    return PlatformRunService.findReusableRun.apply(this, args);
  }

  ensureRun(...args) {
    return PlatformRunService.ensureRun.apply(this, args);
  }

  addTaskGraph(...args) {
    return PlatformTaskService.addTaskGraph.apply(this, args);
  }

  addTask(...args) {
    return PlatformTaskService.addTask.apply(this, args);
  }

  setTaskStatus(...args) {
    return PlatformTaskService.setTaskStatus.apply(this, args);
  }

  promoteReadyTasks(...args) {
    return PlatformTaskService.promoteReadyTasks.apply(this, args);
  }

  acquireLease(...args) {
    return PlatformLeaseService.acquireLease.apply(this, args);
  }

  renewLease(...args) {
    return PlatformLeaseService.renewLease.apply(this, args);
  }

  releaseLease(...args) {
    return PlatformLeaseService.releaseLease.apply(this, args);
  }

  expireLeases(...args) {
    return PlatformLeaseService.expireLeases.apply(this, args);
  }

  beginAgentRun(...args) {
    return PlatformTaskService.beginAgentRun.apply(this, args);
  }

  attachAgentWorktree(...args) {
    return PlatformTaskService.attachAgentWorktree.apply(this, args);
  }

  recordTaskCheckpoint(...args) {
    return PlatformTaskService.recordTaskCheckpoint.apply(this, args);
  }

  recordAgentHandoff(...args) {
    return PlatformTaskService.recordAgentHandoff.apply(this, args);
  }

  recordTaskEvaluation(...args) {
    return PlatformTaskService.recordTaskEvaluation.apply(this, args);
  }

  recordArtifact(...args) {
    return PlatformCompletionService.recordArtifact.apply(this, args);
  }

  appendRunLog(...args) {
    return PlatformCompletionService.appendRunLog.apply(this, args);
  }

  enqueueJob(...args) {
    return PlatformLongRunningService.enqueueJob.apply(this, args);
  }

  setJobStatus(...args) {
    return PlatformLongRunningService.setJobStatus.apply(this, args);
  }

  recordJobUsage(...args) {
    return PlatformLongRunningService.recordJobUsage.apply(this, args);
  }

  recordJobCheckpoint(...args) {
    return PlatformLongRunningService.recordJobCheckpoint.apply(this, args);
  }

  recordJobReceipt(...args) {
    return PlatformLongRunningService.recordJobReceipt.apply(this, args);
  }

  updateJobWake(...args) {
    return PlatformLongRunningService.updateJobWake.apply(this, args);
  }

  scheduleJob(...args) {
    return PlatformLongRunningService.scheduleJob.apply(this, args);
  }

  waitForJob(...args) {
    return PlatformLongRunningService.waitForJob.apply(this, args);
  }

  requestJobApproval(...args) {
    return PlatformLongRunningService.requestJobApproval.apply(this, args);
  }

  resolveJobApproval(...args) {
    return PlatformLongRunningService.resolveJobApproval.apply(this, args);
  }

  provideJobInput(...args) {
    return PlatformLongRunningService.provideJobInput.apply(this, args);
  }

  signalExternal(...args) {
    return PlatformLongRunningService.signalExternal.apply(this, args);
  }

  promoteDueJobs(...args) {
    return PlatformLongRunningService.promoteDueJobs.apply(this, args);
  }

  createNotification(...args) {
    return PlatformLongRunningService.createNotification.apply(this, args);
  }

  markNotificationRead(...args) {
    return PlatformLongRunningService.markNotificationRead.apply(this, args);
  }

  clearNotification(...args) {
    return PlatformLongRunningService.clearNotification.apply(this, args);
  }

  listApprovals(...args) {
    return PlatformLongRunningService.listApprovals.apply(this, args);
  }

  listNotifications(...args) {
    return PlatformLongRunningService.listNotifications.apply(this, args);
  }

  setLifecycleState(...args) {
    return PlatformLongRunningService.setLifecycleState.apply(this, args);
  }

  getLifecycleState(...args) {
    return PlatformLongRunningService.getLifecycleState.apply(this, args);
  }

  pruneLongRunningState(...args) {
    return PlatformLongRunningService.pruneLongRunningState.apply(this, args);
  }

  getJob(...args) {
    return PlatformLongRunningService.getJob.apply(this, args);
  }

  listJobs(...args) {
    return PlatformLongRunningService.listJobs.apply(this, args);
  }

  recoverInterruptedJobs(...args) {
    return PlatformLongRunningService.recoverInterruptedJobs.apply(this, args);
  }

  recordIntegration(...args) {
    return PlatformCompletionService.recordIntegration.apply(this, args);
  }

  recordReview(...args) {
    return PlatformCompletionService.recordReview.apply(this, args);
  }

  ensureCriterionEvidence(...args) {
    return PlatformCompletionService.ensureCriterionEvidence.apply(this, args);
  }

  completionBinding(...args) {
    return PlatformCompletionService.completionBinding.apply(this, args);
  }

  finishAgentRun(...args) {
    return PlatformTaskService.finishAgentRun.apply(this, args);
  }

  authorizeCompletion(...args) {
    return PlatformCompletionService.authorizeCompletion.apply(this, args);
  }

  verifyCompletionPermit(...args) {
    return PlatformCompletionService.verifyCompletionPermit.apply(this, args);
  }

  setRunStatus(...args) {
    return PlatformRunService.setRunStatus.apply(this, args);
  }

  recoverInterruptedRuns(...args) {
    return PlatformRunService.recoverInterruptedRuns.apply(this, args);
  }

  prepareExecution(...args) {
    return PlatformRunService.prepareExecution.apply(this, args);
  }

  getRun(...args) {
    return PlatformRunService.getRun.apply(this, args);
  }

  getExecutionBridge(...args) {
    return PlatformExecutionBridgeService.getExecutionBridge.apply(this, args);
  }

  getAgentExecutionThread(...args) {
    return PlatformExecutionBridgeService.getAgentExecutionThread.apply(this, args);
  }

  validateExecutionBridge(...args) {
    return PlatformExecutionBridgeService.validateExecutionBridge.apply(this, args);
  }

  getSnapshot(...args) {
    return PlatformStateProjector.getSnapshot.apply(this, args);
  }
}
