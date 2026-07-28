import {
  classifyProviderError
} from "./ProviderErrorClassifier.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function providerRetryDelayMs({
  attempt = 1,
  retryAfterMs = 0,
  random = Math.random
} = {}) {
  const retryNumber = Math.max(1, Number(attempt) || 1);
  const exponential = Math.min(
    5000,
    400 * (2 ** Math.max(0, retryNumber - 1))
  );
  const serverDelay = Math.max(0, Number(retryAfterMs) || 0);
  const base = Math.max(exponential, serverDelay);
  const jitter = 0.85 + clamp(Number(random?.()) || 0.5, 0, 1) * 0.3;
  return Math.max(0, Math.round(base * jitter));
}

export function resolveProviderRetry({
  error,
  attempt = 1,
  maxRetries = 0,
  cancellationRequested = false,
  publicOutputStarted = false,
  toolActivityStarted = false,
  allowAfterOutput = false,
  allowAfterToolActivity = false,
  remainingMs = Infinity,
  random = Math.random
} = {}) {
  const classification = classifyProviderError(error, {
    cancellationRequested
  });
  const normalizedAttempt = Math.max(1, Number(attempt) || 1);
  const normalizedRetries = clamp(Number(maxRetries) || 0, 0, 5);
  const maxAttempts = normalizedRetries + 1;

  let reason = "retryable";
  let retry = true;

  if (cancellationRequested || classification.category === "cancelled") {
    retry = false;
    reason = "cancelled";
  } else if (!classification.automaticRetry) {
    retry = false;
    reason = classification.retryable ? "manual-retry-only" : "not-retryable";
  } else if (normalizedAttempt >= maxAttempts) {
    retry = false;
    reason = "attempt-limit";
  } else if (publicOutputStarted && !allowAfterOutput) {
    retry = false;
    reason = "public-output-started";
  } else if (toolActivityStarted && !allowAfterToolActivity) {
    retry = false;
    reason = "tool-activity-started";
  }

  const delayMs = retry
    ? providerRetryDelayMs({
        attempt: normalizedAttempt,
        retryAfterMs: classification.retryAfterMs,
        random
      })
    : 0;
  const remaining = Number(remainingMs);
  if (
    retry &&
    Number.isFinite(remaining) &&
    remaining <= delayMs + 250
  ) {
    retry = false;
    reason = "deadline";
  }

  return {
    retry,
    reason,
    delayMs: retry ? delayMs : 0,
    attempt: normalizedAttempt,
    nextAttempt: normalizedAttempt + 1,
    maxAttempts,
    classification
  };
}

export function waitForProviderRetry(delayMs, abortSignal) {
  const delay = Math.max(0, Number(delayMs) || 0);
  if (delay === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      const reason = abortSignal?.reason;
      if (reason instanceof Error) {
        reject(reason);
        return;
      }
      const error = new Error(String(reason ?? "Provider retry aborted."));
      error.name = "AbortError";
      error.code = "ABORT_ERR";
      reject(error);
    };

    if (abortSignal?.aborted) {
      onAbort();
      return;
    }

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delay);
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}
