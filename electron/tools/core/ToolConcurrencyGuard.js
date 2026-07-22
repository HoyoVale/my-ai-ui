function abortError(signal) {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  const error = new Error("工具调用已取消。");
  error.name = "AbortError";
  error.code = "CANCELLED_BY_USER";
  return error;
}

export class ToolConcurrencyGuard {
  constructor({ maxConcurrent = 4 } = {}) {
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || 4);
    this.active = 0;
    this.exclusiveActive = false;
    this.activeKeys = new Set();
    this.queue = [];
  }

  canStart(key, exclusive = false) {
    if (exclusive) {
      return this.active === 0;
    }
    return (
      this.exclusiveActive !== true &&
      this.active < this.maxConcurrent &&
      (!key || !this.activeKeys.has(key))
    );
  }

  start(key, exclusive, resolve) {
    this.active += 1;
    if (exclusive) {
      this.exclusiveActive = true;
    }
    if (key) {
      this.activeKeys.add(key);
    }

    let released = false;
    resolve(() => {
      if (released) {
        return;
      }
      released = true;
      this.active = Math.max(0, this.active - 1);
      if (exclusive) {
        this.exclusiveActive = false;
      }
      if (key) {
        this.activeKeys.delete(key);
      }
      this.pump();
    });
  }

  pump() {
    for (let index = 0; index < this.queue.length; ) {
      const entry = this.queue[index];
      if (entry.signal?.aborted) {
        this.queue.splice(index, 1);
        entry.cleanup();
        entry.reject(abortError(entry.signal));
        continue;
      }
      if (entry.exclusive) {
        if (this.canStart(entry.key, true)) {
          this.queue.splice(index, 1);
          entry.cleanup();
          this.start(entry.key, true, entry.resolve);
        }
        // An exclusive control-plane operation is a queue barrier.
        // Later file/tool work must not jump ahead and starve it.
        return;
      }
      if (!this.canStart(entry.key, false)) {
        index += 1;
        continue;
      }
      this.queue.splice(index, 1);
      entry.cleanup();
      this.start(entry.key, false, entry.resolve);
    }
  }

  acquire(key = "", signal = null, { exclusive = false } = {}) {
    if (signal?.aborted) {
      return Promise.reject(abortError(signal));
    }

    return new Promise((resolve, reject) => {
      const exclusiveQueued = this.queue.some((entry) => entry.exclusive);
      if (
        this.canStart(key, exclusive) &&
        (exclusive || !exclusiveQueued)
      ) {
        this.start(key, exclusive, resolve);
        return;
      }

      const entry = {
        key,
        exclusive: exclusive === true,
        signal,
        resolve,
        reject,
        cleanup: () => {
          signal?.removeEventListener("abort", onAbort);
        }
      };
      const onAbort = () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) {
          this.queue.splice(index, 1);
        }
        entry.cleanup();
        reject(abortError(signal));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(entry);
    });
  }
}
