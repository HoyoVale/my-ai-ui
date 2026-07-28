export class CoalescedStatusBroadcaster {
  constructor({
    intervalMs = 40,
    publish,
    onError = null
  } = {}) {
    if (typeof publish !== "function") {
      throw new TypeError("publish 必须是函数。");
    }

    this.intervalMs = Math.max(
      0,
      Number(intervalMs) || 0
    );
    this.publish = publish;
    this.onError = typeof onError === "function"
      ? onError
      : (error) => {
          console.warn("广播 Agent 状态失败：", error);
        };
    this.timer = null;
    this.pending = false;
    this.closed = false;
    this.inFlight = null;
    this.rerunRequested = false;
    this.publishCount = 0;
    this.errorCount = 0;
  }

  schedule({ immediate = false } = {}) {
    if (this.closed) {
      return false;
    }

    this.pending = true;

    if (immediate || this.intervalMs === 0) {
      this.flush();
      return true;
    }

    if (this.timer) {
      return true;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.intervalMs);

    this.timer.unref?.();
    return true;
  }

  reportError(error) {
    this.errorCount += 1;
    try {
      this.onError(error);
    } catch {
      // Diagnostic callbacks must never destabilize the Runtime.
    }
  }

  flush() {
    if (this.closed || !this.pending) {
      return false;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.pending = false;

    if (this.inFlight) {
      this.rerunRequested = true;
      return true;
    }

    let result;
    try {
      this.publishCount += 1;
      result = this.publish();
    } catch (error) {
      this.reportError(error);
      return true;
    }

    if (!result || typeof result.then !== "function") {
      return true;
    }

    const publishPromise = Promise.resolve(result)
      .catch((error) => {
        this.reportError(error);
      })
      .finally(() => {
        if (this.inFlight === publishPromise) {
          this.inFlight = null;
        }
        if (this.closed) {
          this.pending = false;
          this.rerunRequested = false;
          return;
        }
        if (this.pending || this.rerunRequested) {
          this.rerunRequested = false;
          this.pending = true;
          this.flush();
        }
      });

    this.inFlight = publishPromise;
    return true;
  }

  async waitForIdle() {
    while (true) {
      const current = this.inFlight;
      if (current) {
        await current;
        continue;
      }
      if (!this.closed && (this.pending || this.rerunRequested)) {
        this.pending = true;
        this.rerunRequested = false;
        this.flush();
        continue;
      }
      return;
    }
  }

  snapshot() {
    return {
      closed: this.closed,
      pending: this.pending,
      timerActive: Boolean(this.timer),
      publishInFlight: Boolean(this.inFlight),
      publishCount: this.publishCount,
      errorCount: this.errorCount
    };
  }

  close({ flush = true } = {}) {
    if (this.closed) {
      return;
    }

    if (flush) {
      this.flush();
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.pending = false;
    this.rerunRequested = false;
    this.closed = true;
  }
}
