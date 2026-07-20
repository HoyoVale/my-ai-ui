function clone(value) {
  return structuredClone(value);
}

function normalizeKey(value) {
  return String(value ?? "").trim();
}

function normalizePositive(value, fallback, minimum = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(minimum, Math.round(numeric))
    : fallback;
}

function errorSummary(error) {
  if (!error) {
    return null;
  }

  if (error instanceof Error) {
    return {
      code: String(error.code ?? ""),
      message: String(error.message ?? "").slice(0, 400)
    };
  }

  if (typeof error === "object") {
    return {
      code: String(error.code ?? error.type ?? ""),
      message: String(error.message ?? "").slice(0, 400)
    };
  }

  return {
    code: "",
    message: String(error).slice(0, 400)
  };
}

export class CircuitOpenError extends Error {
  constructor({ key, retryAfterMs = 0, scope = "runtime" } = {}) {
    super(
      `${scope === "provider" ? "模型服务" : "工具"}暂时不可用，请稍后重试。`
    );
    this.name = "CircuitOpenError";
    this.code = "CIRCUIT_OPEN";
    this.retryable = true;
    this.key = String(key ?? "");
    this.scope = String(scope ?? "runtime");
    this.retryAfterMs = Math.max(0, Number(retryAfterMs) || 0);
  }
}

export class CircuitBreakerRegistry {
  constructor({
    scope = "runtime",
    failureThreshold = 3,
    failureWindowMs = 60_000,
    cooldownMs = 30_000,
    halfOpenMaxCalls = 1,
    now = () => Date.now()
  } = {}) {
    this.scope = String(scope ?? "runtime");
    this.failureThreshold = normalizePositive(failureThreshold, 3);
    this.failureWindowMs = normalizePositive(failureWindowMs, 60_000);
    this.cooldownMs = normalizePositive(cooldownMs, 30_000);
    this.halfOpenMaxCalls = normalizePositive(halfOpenMaxCalls, 1);
    this.now = typeof now === "function" ? now : () => Date.now();
    this.entries = new Map();
  }

  configure({
    failureThreshold,
    failureWindowMs,
    cooldownMs,
    halfOpenMaxCalls
  } = {}) {
    this.failureThreshold = normalizePositive(
      failureThreshold,
      this.failureThreshold
    );
    this.failureWindowMs = normalizePositive(
      failureWindowMs,
      this.failureWindowMs
    );
    this.cooldownMs = normalizePositive(
      cooldownMs,
      this.cooldownMs
    );
    this.halfOpenMaxCalls = normalizePositive(
      halfOpenMaxCalls,
      this.halfOpenMaxCalls
    );

    const now = this.now();
    for (const entry of this.entries.values()) {
      this.prune(entry, now);
      if (entry.state === "open") {
        entry.openUntil = Math.max(
          now,
          entry.openedAt + this.cooldownMs
        );
      }
    }

    return this.snapshot();
  }

  ensure(key, metadata = {}) {
    const id = normalizeKey(key);
    if (!id) {
      return null;
    }

    const existing = this.entries.get(id);
    if (existing) {
      existing.label = String(metadata.label ?? existing.label ?? id);
      return existing;
    }

    const entry = {
      key: id,
      label: String(metadata.label ?? id),
      state: "closed",
      failures: [],
      openedAt: 0,
      openUntil: 0,
      halfOpenCalls: 0,
      lastFailureAt: 0,
      lastSuccessAt: 0,
      lastError: null
    };
    this.entries.set(id, entry);
    return entry;
  }

  prune(entry, now = this.now()) {
    entry.failures = entry.failures.filter(
      (timestamp) => now - timestamp <= this.failureWindowMs
    );
  }

  beforeRequest(key, metadata = {}) {
    const entry = this.ensure(key, metadata);
    if (!entry) {
      return { ok: true, state: "closed", key: "" };
    }

    const now = this.now();
    this.prune(entry, now);

    if (entry.state === "open") {
      if (now < entry.openUntil) {
        return {
          ok: false,
          state: "open",
          key: entry.key,
          retryAfterMs: entry.openUntil - now
        };
      }

      entry.state = "half_open";
      entry.halfOpenCalls = 0;
    }

    if (entry.state === "half_open") {
      if (entry.halfOpenCalls >= this.halfOpenMaxCalls) {
        return {
          ok: false,
          state: "half_open",
          key: entry.key,
          retryAfterMs: Math.max(0, entry.openUntil - now)
        };
      }
      entry.halfOpenCalls += 1;
    }

    return {
      ok: true,
      state: entry.state,
      key: entry.key,
      retryAfterMs: 0
    };
  }

  assertCanRequest(key, metadata = {}) {
    const decision = this.beforeRequest(key, metadata);
    if (!decision.ok) {
      throw new CircuitOpenError({
        key: decision.key,
        retryAfterMs: decision.retryAfterMs,
        scope: this.scope
      });
    }
    return decision;
  }

  recordSuccess(key, metadata = {}) {
    const entry = this.ensure(key, metadata);
    if (!entry) {
      return null;
    }

    entry.state = "closed";
    entry.failures = [];
    entry.openedAt = 0;
    entry.openUntil = 0;
    entry.halfOpenCalls = 0;
    entry.lastSuccessAt = this.now();
    entry.lastError = null;
    return this.snapshotEntry(entry);
  }

  recordFailure(key, error, { counted = true, label = "" } = {}) {
    const entry = this.ensure(key, { label });
    if (!entry) {
      return null;
    }

    const now = this.now();
    entry.lastFailureAt = now;
    entry.lastError = errorSummary(error);

    if (!counted) {
      if (entry.state === "half_open") {
        entry.halfOpenCalls = Math.max(0, entry.halfOpenCalls - 1);
      }
      return this.snapshotEntry(entry);
    }

    this.prune(entry, now);
    entry.failures.push(now);

    if (
      entry.state === "half_open" ||
      entry.failures.length >= this.failureThreshold
    ) {
      entry.state = "open";
      entry.openedAt = now;
      entry.openUntil = now + this.cooldownMs;
      entry.halfOpenCalls = 0;
    }

    return this.snapshotEntry(entry);
  }

  reset(key) {
    const id = normalizeKey(key);
    if (!id) {
      return false;
    }
    return this.entries.delete(id);
  }

  resetAll() {
    const count = this.entries.size;
    this.entries.clear();
    return count;
  }

  snapshotEntry(entry) {
    const now = this.now();
    this.prune(entry, now);
    return {
      key: entry.key,
      label: entry.label,
      state: entry.state,
      failureCount: entry.failures.length,
      openedAt: entry.openedAt,
      openUntil: entry.openUntil,
      retryAfterMs:
        entry.state === "open"
          ? Math.max(0, entry.openUntil - now)
          : 0,
      halfOpenCalls: entry.halfOpenCalls,
      lastFailureAt: entry.lastFailureAt,
      lastSuccessAt: entry.lastSuccessAt,
      lastError: clone(entry.lastError)
    };
  }

  snapshot() {
    return {
      version: 1,
      scope: this.scope,
      failureThreshold: this.failureThreshold,
      failureWindowMs: this.failureWindowMs,
      cooldownMs: this.cooldownMs,
      halfOpenMaxCalls: this.halfOpenMaxCalls,
      openCount: [...this.entries.values()].filter(
        (entry) => entry.state === "open"
      ).length,
      entries: [...this.entries.values()].map((entry) =>
        this.snapshotEntry(entry)
      )
    };
  }

  publicSnapshot() {
    const snapshot = this.snapshot();
    return {
      version: snapshot.version,
      scope: snapshot.scope,
      openCount: snapshot.openCount,
      entries: snapshot.entries
        .filter((entry) => entry.state !== "closed")
        .map((entry) => ({
          label: entry.label,
          state: entry.state,
          retryAfterMs: entry.retryAfterMs
        }))
    };
  }
}
