const EFFECTS = new Set([
  "read",
  "local_write",
  "remote_write",
  "destructive"
]);

const MAX_RUNTIME_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_LEASE_TTL_MS = 24 * 60 * 60 * 1000;

const RETRY_MODES = new Set([
  "safe",
  "idempotency_key",
  "reconcile_before_retry",
  "manual_only"
]);

function effectFromSideEffect(sideEffect) {
  if (["none", "read"].includes(sideEffect)) {
    return "read";
  }

  if (sideEffect === "write") {
    return "local_write";
  }

  return "remote_write";
}

function retryModeFor({ effect, idempotency }) {
  if (effect === "read") {
    return "safe";
  }

  if (["natural", "required"].includes(idempotency)) {
    return "idempotency_key";
  }

  if (effect === "destructive") {
    return "manual_only";
  }

  return "reconcile_before_retry";
}

export function normalizeToolRuntimeContract(
  value,
  {
    sideEffect = "none",
    idempotency = "natural",
    timeoutMs = 0
  } = {}
) {
  const source = value && typeof value === "object"
    ? value
    : {};
  const inferredEffect = effectFromSideEffect(sideEffect);
  const effect = EFFECTS.has(source.effect)
    ? source.effect
    : inferredEffect;
  const retryMode = RETRY_MODES.has(source.retryMode)
    ? source.retryMode
    : retryModeFor({ effect, idempotency });
  const supportsAbort = source.supportsAbort === undefined
    ? effect === "read"
    : source.supportsAbort === true;
  const supportsResume = source.supportsResume === undefined
    ? ["read", "local_write"].includes(effect)
    : source.supportsResume === true;

  const normalizedTimeoutMs = Math.min(
    MAX_RUNTIME_TIMEOUT_MS,
    Math.max(
      0,
      Number(source.timeoutMs ?? timeoutMs) || 0
    )
  );
  const leaseTtlMs = Math.min(
    MAX_LEASE_TTL_MS,
    Math.max(
      5_000,
      Number(source.leaseTtlMs) || 60_000
    )
  );
  const heartbeatMs = Math.min(
    Math.max(1_000, Math.floor(leaseTtlMs / 2)),
    Math.max(
      1_000,
      Number(source.heartbeatMs) || 10_000
    )
  );

  return {
    effect,
    retryMode,
    supportsAbort,
    supportsResume,
    timeoutMs: normalizedTimeoutMs,
    leaseTtlMs,
    heartbeatMs,
    canReconcile: typeof source.reconcile === "function",
    canVerify: typeof source.verify === "function",
    canCompensate: typeof source.compensate === "function",
    reconcile: typeof source.reconcile === "function"
      ? source.reconcile
      : null,
    verify: typeof source.verify === "function"
      ? source.verify
      : null,
    compensate: typeof source.compensate === "function"
      ? source.compensate
      : null
  };
}

export function publicToolRuntimeContract(contract = {}) {
  return {
    effect: contract.effect ?? "read",
    retryMode: contract.retryMode ?? "safe",
    supportsAbort: contract.supportsAbort === true,
    supportsResume: contract.supportsResume === true,
    canReconcile: contract.canReconcile === true,
    canVerify: contract.canVerify === true,
    canCompensate: contract.canCompensate === true
  };
}

export function isUnsafeToolEffect(contract = {}) {
  return [
    "local_write",
    "remote_write",
    "destructive"
  ].includes(contract.effect);
}

export function requiresReconciliation(contract = {}) {
  return contract.retryMode === "reconcile_before_retry";
}

export function requiresManualConfirmation(contract = {}) {
  return contract.retryMode === "manual_only";
}
