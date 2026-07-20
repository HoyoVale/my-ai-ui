function boundedMilliseconds(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(resolved)));
}

export function createAgentStreamTimeout({
  modelTimeoutMs = 120_000,
  remainingRunMs = 1_800_000,
  approvalTimeoutMs = 300_000,
  defaultToolTimeoutMs = 15_000,
  hasApprovalGatedTools = false
} = {}) {
  const runMs = boundedMilliseconds(
    remainingRunMs,
    1_800_000,
    1,
    24 * 60 * 60 * 1000
  );
  const modelMs = boundedMilliseconds(
    modelTimeoutMs,
    120_000,
    1_000,
    runMs
  );
  const toolExecutionMs = boundedMilliseconds(
    defaultToolTimeoutMs,
    15_000,
    1_000,
    runMs
  );
  const approvalMs = boundedMilliseconds(
    approvalTimeoutMs,
    300_000,
    30_000,
    runMs
  );
  const ordinaryChunkMs = Math.min(45_000, modelMs, runMs);
  const interactiveToolMs = Math.min(
    runMs,
    approvalMs + toolExecutionMs + 5_000
  );

  return {
    // The run deadline remains the outer hard boundary. A model timeout must
    // not expire the whole stream while a person is reviewing a Tool call.
    totalMs: hasApprovalGatedTools
      ? runMs
      : modelMs,
    chunkMs: hasApprovalGatedTools
      ? Math.max(ordinaryChunkMs, interactiveToolMs)
      : ordinaryChunkMs,
    toolMs: hasApprovalGatedTools
      ? interactiveToolMs
      : Math.min(runMs, toolExecutionMs + 5_000)
  };
}
