export class McpRecoveryManager {
  constructor({ manager }) {
    this.manager = manager;
    this.timers = new Map();
    this.attempts = new Map();
  }

  policy(server = {}) {
    return {
      enabled: this.manager.settings.recovery?.enabled !== false && server.recovery?.enabled !== false,
      maxAttempts: Math.max(0, server.recovery?.maxAttempts ?? this.manager.settings.recovery?.maxAttempts ?? 3),
      baseDelayMs: Math.max(250, this.manager.settings.recovery?.baseDelayMs ?? 1000),
      maxDelayMs: Math.max(1000, this.manager.settings.recovery?.maxDelayMs ?? 15000)
    };
  }

  schedule(serverId, reason = "connection-lost") {
    const server = this.manager.getServerConfig(serverId);
    if (!server || server.enabled === false) return false;
    const policy = this.policy(server);
    if (!policy.enabled || this.timers.has(server.id)) return false;
    const attempt = (this.attempts.get(server.id) ?? 0) + 1;
    if (attempt > policy.maxAttempts) {
      this.manager.markRecoveryExhausted(server.id, attempt - 1, reason);
      return false;
    }
    this.attempts.set(server.id, attempt);
    const delayMs = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** (attempt - 1)));
    this.manager.markRecoveryScheduled(server.id, attempt, delayMs, reason);
    const timer = setTimeout(async () => {
      this.timers.delete(server.id);
      try {
        await this.manager.connectServer(server.id, { force: true, recovery: true });
        this.reset(server.id);
      } catch {
        this.schedule(server.id, reason);
      }
    }, delayMs);
    timer.unref?.();
    this.timers.set(server.id, timer);
    return true;
  }

  reset(serverId) {
    const id = String(serverId ?? "");
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.attempts.delete(id);
  }

  close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.attempts.clear();
  }
}
