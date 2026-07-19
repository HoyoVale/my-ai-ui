function positiveInteger(value, fallback) {
  const normalized = Math.round(Number(value));
  return Number.isFinite(normalized)
    ? Math.max(1, normalized)
    : fallback;
}

export function createFinalizationBudget({
  timeoutMs = 30000,
  now = () => Date.now()
} = {}) {
  const totalMs = positiveInteger(timeoutMs, 30000);
  const startedAt = now();
  const deadline = startedAt + totalMs;

  return {
    totalMs,
    startedAt,
    deadline,
    remainingMs() {
      return Math.max(0, deadline - now());
    },
    timeoutFor(modelTimeoutMs) {
      const remaining = Math.max(1, deadline - now());
      const modelTimeout = positiveInteger(
        modelTimeoutMs,
        remaining
      );

      return {
        totalMs: Math.max(
          1,
          Math.min(modelTimeout, remaining)
        ),
        chunkMs: Math.max(
          1,
          Math.min(15000, modelTimeout, remaining)
        )
      };
    }
  };
}
