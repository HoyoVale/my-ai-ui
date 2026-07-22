function abortError(signal) {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  const error = new Error("工具调用已取消。");
  error.name = "AbortError";
  error.code = "CANCELLED_BY_USER";
  return error;
}

function normalizeMode(value) {
  return value === "shared" ? "shared" : "exclusive";
}

function normalizeResource(resource) {
  if (typeof resource === "string") {
    return {
      key: resource,
      mode: "exclusive"
    };
  }
  if (!resource || typeof resource !== "object") return null;
  const key = String(resource.key ?? "").trim();
  if (!key) return null;
  return {
    key,
    mode: normalizeMode(resource.mode)
  };
}

function normalizedResources(resources, fallbackKey = "", exclusive = false) {
  const source = Array.isArray(resources)
    ? resources
    : resources
      ? [resources]
      : fallbackKey
        ? [{ key: fallbackKey, mode: "exclusive" }]
        : [];
  const deduped = new Map();
  for (const item of source) {
    const resource = normalizeResource(item);
    if (!resource) continue;
    const previous = deduped.get(resource.key);
    if (!previous || resource.mode === "exclusive") {
      deduped.set(resource.key, resource);
    }
  }
  if (exclusive) {
    deduped.set("__global__", {
      key: "__global__",
      mode: "exclusive"
    });
  } else if (deduped.size === 0) {
    // Even tools without an explicit path/key participate in the global
    // scheduling domain, so a queued Plan barrier cannot be bypassed.
    deduped.set("__global__", {
      key: "__global__",
      mode: "shared"
    });
  }
  return [...deduped.values()];
}

function parseWorkspaceResource(key) {
  const match = /^workspace:([^:]+):(all|path):(.*)$/u.exec(key);
  if (!match) return null;
  const path = match[2] === "all"
    ? ""
    : String(match[3] ?? "")
      .replace(/\\/gu, "/")
      .replace(/^\.\//u, "")
      .replace(/\/+$/u, "");
  return {
    workspaceId: match[1],
    kind: match[2],
    path
  };
}

function workspaceKeysOverlap(leftKey, rightKey) {
  const left = parseWorkspaceResource(leftKey);
  const right = parseWorkspaceResource(rightKey);
  if (!left || !right || left.workspaceId !== right.workspaceId) {
    return false;
  }
  if (left.kind === "all" || right.kind === "all") {
    return true;
  }
  if (left.path === right.path) return true;
  return left.path.startsWith(`${right.path}/`) || right.path.startsWith(`${left.path}/`);
}

function resourcesConflict(left, right) {
  if (
    left.mode === "shared" &&
    right.mode === "shared"
  ) {
    return false;
  }
  if (left.key === "__global__" || right.key === "__global__") {
    return true;
  }
  return left.key === right.key || workspaceKeysOverlap(left.key, right.key);
}

function entriesConflict(left, right) {
  return left.resources.some((leftResource) =>
    right.resources.some((rightResource) =>
      resourcesConflict(leftResource, rightResource)
    )
  );
}

export class ToolConcurrencyGuard {
  constructor({ maxConcurrent = 4 } = {}) {
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || 4);
    this.active = 0;
    this.exclusiveActive = false;
    this.activeKeys = new Set();
    this.activeEntries = new Set();
    this.queue = [];
  }

  canStartEntry(entry) {
    if (this.active >= this.maxConcurrent) return false;
    return ![...this.activeEntries].some((active) => entriesConflict(entry, active));
  }

  canStart(key, exclusive = false) {
    return this.canStartEntry({
      resources: normalizedResources(null, key, exclusive)
    });
  }

  startEntry(entry) {
    this.active += 1;
    this.activeEntries.add(entry);
    for (const resource of entry.resources) {
      this.activeKeys.add(resource.key);
    }
    if (entry.exclusive) this.exclusiveActive = true;

    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.activeEntries.delete(entry);
      this.activeKeys = new Set(
        [...this.activeEntries].flatMap((active) =>
          active.resources.map((resource) => resource.key)
        )
      );
      this.exclusiveActive = [...this.activeEntries]
        .some((active) => active.exclusive);
      this.pump();
    });
  }

  start(key, exclusive, resolve) {
    this.startEntry({
      key,
      exclusive,
      resources: normalizedResources(null, key, exclusive),
      resolve
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
      if (entry.barrier) {
        if (this.canStartEntry(entry)) {
          this.queue.splice(index, 1);
          entry.cleanup();
          this.startEntry(entry);
        }
        return;
      }
      if (!this.canStartEntry(entry)) {
        index += 1;
        continue;
      }
      this.queue.splice(index, 1);
      entry.cleanup();
      this.startEntry(entry);
    }
  }

  acquire(key = "", signal = null, {
    exclusive = false,
    resources = null,
    barrier = exclusive
  } = {}) {
    if (signal?.aborted) {
      return Promise.reject(abortError(signal));
    }

    return new Promise((resolve, reject) => {
      const entry = {
        key,
        exclusive: exclusive === true,
        barrier: barrier === true,
        resources: normalizedResources(resources, key, exclusive),
        signal,
        resolve,
        reject,
        cleanup: () => {
          signal?.removeEventListener("abort", onAbort);
        }
      };
      const barrierQueued = this.queue.some((queued) => queued.barrier);
      if (
        this.canStartEntry(entry) &&
        (entry.barrier || !barrierQueued)
      ) {
        this.startEntry(entry);
        return;
      }

      const onAbort = () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        entry.cleanup();
        reject(abortError(signal));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(entry);
    });
  }

  snapshot() {
    return {
      active: this.active,
      queued: this.queue.length,
      activeResources: [...this.activeEntries].flatMap((entry) =>
        entry.resources.map((resource) => ({ ...resource }))
      ),
      queuedBarriers: this.queue.filter((entry) => entry.barrier).length
    };
  }
}
