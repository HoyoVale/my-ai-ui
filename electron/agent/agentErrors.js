import {
  classifyProviderError,
  providerErrorMessage
} from "./ProviderErrorClassifier.js";

export function createAbortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) {
    reason.name = "AbortError";
    if (!reason.code) reason.code = "ABORT_ERR";
    return reason;
  }

  const error = new Error(
    String(reason ?? "Agent run aborted.")
  );
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
}

export function isCancellationRequested(run, signal) {
  return (
    signal?.aborted === true ||
    run?.cancellation?.requested === true
  );
}

export function isAbortError(
  error
) {
  return (
    error?.name ===
      "AbortError" ||
    error?.code ===
      "ABORT_ERR"
  );
}

export function formatAgentError(error) {
  return providerErrorMessage(
    classifyProviderError(error)
  );
}
