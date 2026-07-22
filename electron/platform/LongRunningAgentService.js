const DAY_MS = 24 * 60 * 60 * 1000;

export class LongRunningAgentService {
  constructor({
    platformKernel,
    scheduler,
    lifecycleAdapter = null,
    now = () => Date.now(),
    completedRetentionDays = 30,
    notificationRetentionDays = 90
  } = {}) {
    if (!platformKernel || !scheduler) {
      throw new TypeError("LongRunningAgentService requires PlatformKernel and PlatformJobScheduler.");
    }
    this.platformKernel = platformKernel;
    this.scheduler = scheduler;
    this.lifecycleAdapter = lifecycleAdapter;
    this.now = now;
    this.completedRetentionDays = Math.max(1, Math.min(365, Number(completedRetentionDays) || 30));
    this.notificationRetentionDays = Math.max(1, Math.min(365, Number(notificationRetentionDays) || 90));
    this.started = false;
    this.unsubscribe = null;
  }

  start() {
    if (this.started) {
      return { ok: true, changed: false, recovery: { recoveredJobIds: [] } };
    }
    this.started = true;
    const initial = this.lifecycleAdapter?.getState?.() ?? {
      online: this.platformKernel.getLifecycleState().online,
      suspended: false,
      onBattery: false
    };
    this.scheduler.networkOnline = initial.online !== false;
    this.scheduler.suspended = initial.suspended === true;
    this.platformKernel.setLifecycleState(initial);
    this.unsubscribe = this.lifecycleAdapter?.subscribe?.({
      onNetworkChange: (online) => this.scheduler.setNetworkOnline(online),
      onSuspend: () => this.scheduler.suspend(),
      onResume: (state = {}) => this.scheduler.resumeFromSystem(state),
      onPowerChange: (onBattery) => this.platformKernel.setLifecycleState({ onBattery })
    }) ?? null;
    const recovery = this.scheduler.recover();
    const cleanup = this.platformKernel.pruneLongRunningState({
      completedBefore: this.now() - this.completedRetentionDays * DAY_MS,
      notificationsBefore: this.now() - this.notificationRetentionDays * DAY_MS
    });
    return {
      ok: true,
      changed: true,
      lifecycle: this.platformKernel.getLifecycleState(),
      recovery,
      cleanup
    };
  }

  stop() {
    if (!this.started) return { ok: true, changed: false };
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.scheduler.stop();
    return { ok: true, changed: true };
  }

  resolveApproval(approvalId, decision, options = {}) {
    return this.scheduler.resolveApproval(approvalId, decision, options);
  }

  provideInput(jobId, value) {
    return this.scheduler.provideInput(jobId, value);
  }

  signalExternal(jobId, signal = {}) {
    return this.scheduler.signalExternal(jobId, signal);
  }

  getInbox({ platformRunId = "" } = {}) {
    return {
      approvals: this.platformKernel.listApprovals({ platformRunId }),
      notifications: this.platformKernel.listNotifications({ platformRunId }),
      lifecycle: this.platformKernel.getLifecycleState()
    };
  }
}
