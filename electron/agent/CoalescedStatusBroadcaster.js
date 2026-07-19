export class CoalescedStatusBroadcaster {
  constructor({
    intervalMs = 40,
    publish
  } = {}) {
    if (typeof publish !== "function") {
      throw new TypeError("publish 必须是函数。");
    }

    this.intervalMs = Math.max(
      0,
      Number(intervalMs) || 0
    );
    this.publish = publish;
    this.timer = null;
    this.pending = false;
    this.closed = false;
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

  flush() {
    if (this.closed || !this.pending) {
      return false;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.pending = false;
    this.publish();
    return true;
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
    this.closed = true;
  }
}
