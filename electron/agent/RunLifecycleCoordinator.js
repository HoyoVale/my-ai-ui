export const RUN_LIFECYCLE_STATES = Object.freeze({
  ACTIVE: "active",
  SETTLING: "settling",
  SETTLED: "settled",
  DISPOSING: "disposing",
  DISPOSED: "disposed"
});

function boundedDelay(value, fallback = 5000) {
  const normalized = Math.round(Number(value));
  return Number.isFinite(normalized)
    ? Math.max(0, normalized)
    : fallback;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  /*
   * Settlement failures may occur before the shutdown path attaches its
   * waiter. Attach a private rejection observer so Node never reports a
   * transient unhandled rejection; callers awaiting the original promise
   * still receive the rejection normally.
   */
  promise.catch(() => {});

  return { promise, resolve, reject };
}

function withTimeout(operation, timeoutMs, label) {
  let timer = null;
  const work = Promise.resolve().then(operation);
  if (timeoutMs <= 0) {
    return work;
  }

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        `${label || "Run resource cleanup"} timed out.`
      );
      error.code = "RUN_RESOURCE_CLEANUP_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([work, timeout])
    .finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    });
}

export class RunLifecycleCoordinator {
  constructor({
    runId = "",
    cleanupTimeoutMs = 5000,
    now = () => Date.now()
  } = {}) {
    this.runId = String(runId ?? "");
    this.cleanupTimeoutMs = boundedDelay(cleanupTimeoutMs);
    this.now = now;
    this.state = RUN_LIFECYCLE_STATES.ACTIVE;
    this.settlementSource = "";
    this.settlementStartedAt = null;
    this.settlementEndedAt = null;
    this.settlementToken = null;
    this.settlementResult = null;
    this.settlementError = null;
    this.settlementDeferred = createDeferred();
    this.resources = new Map();
    this.cleanupPromise = null;
    this.cleanupResults = [];
    this.settlementAttemptCount = 0;
    this.duplicateSettlementCount = 0;
    this.lateResourceCount = 0;
  }

  beginSettlement(source = "unknown") {
    this.settlementAttemptCount += 1;
    if (this.settlementToken) {
      this.duplicateSettlementCount += 1;
      return {
        accepted: false,
        token: null,
        source: this.settlementSource,
        promise: this.settlementDeferred.promise
      };
    }

    const token = Symbol(`run-settlement:${this.runId}`);
    this.settlementToken = token;
    this.settlementSource = String(source ?? "unknown");
    this.settlementStartedAt = this.now();
    this.state = RUN_LIFECYCLE_STATES.SETTLING;

    return {
      accepted: true,
      token,
      source: this.settlementSource,
      promise: this.settlementDeferred.promise
    };
  }

  completeSettlement(token, result) {
    if (token !== this.settlementToken) {
      return false;
    }
    if (this.settlementEndedAt !== null) {
      return false;
    }

    this.settlementResult = result;
    this.settlementEndedAt = this.now();
    if (this.state !== RUN_LIFECYCLE_STATES.DISPOSED) {
      this.state = RUN_LIFECYCLE_STATES.SETTLED;
    }
    this.settlementDeferred.resolve(result);
    return true;
  }

  failSettlement(token, error) {
    if (token !== this.settlementToken) {
      return false;
    }
    if (this.settlementEndedAt !== null) {
      return false;
    }

    this.settlementError = error;
    this.settlementEndedAt = this.now();
    if (this.state !== RUN_LIFECYCLE_STATES.DISPOSED) {
      this.state = RUN_LIFECYCLE_STATES.SETTLED;
    }
    this.settlementDeferred.reject(error);
    return true;
  }

  waitForSettlement() {
    if (this.settlementEndedAt !== null) {
      return this.settlementError
        ? Promise.reject(this.settlementError)
        : Promise.resolve(this.settlementResult);
    }
    return this.settlementDeferred.promise;
  }

  registerResource(
    name,
    cleanup,
    { priority = 0, timeoutMs = this.cleanupTimeoutMs } = {}
  ) {
    const key = String(name ?? "").trim();
    if (!key || typeof cleanup !== "function") {
      return false;
    }

    const resource = {
      name: key,
      cleanup,
      priority: Number(priority) || 0,
      timeoutMs: boundedDelay(timeoutMs, this.cleanupTimeoutMs),
      registeredAt: this.now()
    };

    if (
      this.state === RUN_LIFECYCLE_STATES.DISPOSING ||
      this.state === RUN_LIFECYCLE_STATES.DISPOSED
    ) {
      this.lateResourceCount += 1;
      void this.cleanupResource(resource, "late-registration")
        .then((result) => {
          this.cleanupResults.push({
            ...result,
            late: true
          });
        });
      return false;
    }

    this.resources.set(key, resource);
    return true;
  }

  removeResource(name) {
    return this.resources.delete(String(name ?? ""));
  }

  async cleanupResource(resource, reason) {
    try {
      await withTimeout(
        () => resource.cleanup(reason),
        resource.timeoutMs,
        resource.name
      );
      return {
        name: resource.name,
        ok: true
      };
    } catch (error) {
      return {
        name: resource.name,
        ok: false,
        error
      };
    }
  }

  dispose(reason = "run-settled") {
    if (this.cleanupPromise) {
      return this.cleanupPromise;
    }

    this.state = RUN_LIFECYCLE_STATES.DISPOSING;
    const resources = [...this.resources.values()]
      .sort((left, right) => (
        right.priority - left.priority ||
        right.registeredAt - left.registeredAt
      ));
    this.resources.clear();

    this.cleanupPromise = (async () => {
      const results = [];
      for (const resource of resources) {
        results.push(
          await this.cleanupResource(resource, reason)
        );
      }
      this.cleanupResults = results;
      this.state = RUN_LIFECYCLE_STATES.DISPOSED;
      return results;
    })();

    return this.cleanupPromise;
  }

  snapshot() {
    return {
      state: this.state,
      source: this.settlementSource,
      settlementStartedAt: this.settlementStartedAt,
      settlementEndedAt: this.settlementEndedAt,
      resourceCount: this.resources.size,
      cleanupStarted: Boolean(this.cleanupPromise),
      settlementAttemptCount: this.settlementAttemptCount,
      duplicateSettlementCount: this.duplicateSettlementCount,
      lateResourceCount: this.lateResourceCount,
      cleanupResults: this.cleanupResults.map((result) => ({
        name: result.name,
        ok: result.ok,
        late: result.late === true
      }))
    };
  }
}
