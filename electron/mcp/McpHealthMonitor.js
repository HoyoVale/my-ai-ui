export class McpHealthMonitor {
  constructor({ manager }) {
    this.manager = manager;
    this.timer = null;
    this.running = false;
    this.settings = null;
  }

  sync(settings = {}) {
    this.settings = settings.health ?? {};
    this.stop();
    if (settings.enabled === false || this.settings.enabled === false) return;
    const intervalMs = Math.max(5000, Number(this.settings.intervalMs) || 30000);
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const servers = this.manager.settings.servers ?? [];
      await Promise.allSettled(servers
        .filter((server) => server.enabled !== false)
        .map((server) => this.manager.checkServerHealth(server.id)));
    } finally {
      this.running = false;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
