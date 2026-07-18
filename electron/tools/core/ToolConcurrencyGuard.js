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
    this.activeKeys = new Set();
    this.queue = [];
  }

  canStart(key) {
    return (
      this.active < this.maxConcurrent &&
      (!key || !this.activeKeys.has(key))
    );
  }

  start(key, resolve) {
    this.active += 1;
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
      if (!this.canStart(entry.key)) {
        index += 1;
        continue;
      }
      this.queue.splice(index, 1);
      entry.cleanup();
      this.start(entry.key, entry.resolve);
    }
  }

  acquire(key = "", signal = null) {
    if (signal?.aborted) {
      return Promise.reject(abortError(signal));
    }

    return new Promise((resolve, reject) => {
      if (this.canStart(key)) {
        this.start(key, resolve);
        return;
      }

      const entry = {
        key,
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
