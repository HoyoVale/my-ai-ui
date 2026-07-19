const registeredQueues = new Set();

function delayValue(value, fallback = 150) {
  const normalized = Math.round(Number(value));
  return Number.isFinite(normalized)
    ? Math.max(0, normalized)
    : fallback;
}

export class AsyncPersistenceQueue {
  constructor({
    write,
    delayMs = 150,
    maxWriteRetries = 1,
    onError = null
  } = {}) {
    if (typeof write !== "function") {
      throw new TypeError(
        "AsyncPersistenceQueue requires write()."
      );
    }

    this.write = write;
    this.delayMs = delayValue(delayMs);
    this.maxWriteRetries = Math.max(
      0,
      Math.min(3, Math.round(Number(maxWriteRetries)) || 0)
    );
    this.onError = typeof onError === "function"
      ? onError
      : (error) => {
          console.warn("异步持久化失败：", error);
        };
    this.pending = undefined;
    this.hasPending = false;
    this.timer = null;
    this.drainPromise = null;
    this.closed = false;
    registeredQueues.add(this);
  }

  enqueue(value, { immediate = false } = {}) {
    if (this.closed) {
      return;
    }

    this.pending = value;
    this.hasPending = true;

    if (immediate || this.delayMs === 0) {
      void this.flush();
      return;
    }

    if (this.timer) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
    this.timer.unref?.();
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.drainPromise) {
      await this.drainPromise;
      if (!this.hasPending) {
        return;
      }
    }

    this.drainPromise = this.drain();

    try {
      await this.drainPromise;
    } finally {
      this.drainPromise = null;
    }
  }

  async drain() {
    while (this.hasPending) {
      const value = this.pending;
      this.pending = undefined;
      this.hasPending = false;

      let writeError = null;

      for (
        let attempt = 0;
        attempt <= this.maxWriteRetries;
        attempt += 1
      ) {
        try {
          await this.write(value);
          writeError = null;
          break;
        } catch (error) {
          writeError = error;
        }
      }

      if (writeError) {
        if (!this.hasPending) {
          this.pending = value;
          this.hasPending = true;
        }
        this.onError(writeError);
        return;
      }
    }
  }

  async close() {
    if (this.closed) {
      return;
    }

    await this.flush();
    this.closed = true;
    registeredQueues.delete(this);
  }
}

export async function flushAllPersistenceQueues() {
  await Promise.allSettled(
    [...registeredQueues].map((queue) => queue.flush())
  );
}
