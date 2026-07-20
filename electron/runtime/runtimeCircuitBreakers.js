import {
  CircuitBreakerRegistry
} from "./CircuitBreaker.js";

const PROVIDER_DEFAULTS = Object.freeze({
  failureThreshold: 3,
  failureWindowMs: 90_000,
  cooldownMs: 45_000,
  halfOpenMaxCalls: 1
});

const TOOL_DEFAULTS = Object.freeze({
  failureThreshold: 3,
  failureWindowMs: 60_000,
  cooldownMs: 30_000,
  halfOpenMaxCalls: 1
});

export const providerCircuitBreakers = new CircuitBreakerRegistry({
  scope: "provider",
  ...PROVIDER_DEFAULTS
});

export const toolCircuitBreakers = new CircuitBreakerRegistry({
  scope: "tool",
  ...TOOL_DEFAULTS
});

function runtimeSettings(source = {}) {
  return source?.tools?.runtime?.circuitBreakers ??
    source?.runtime?.circuitBreakers ??
    source?.circuitBreakers ??
    {};
}

export function configureRuntimeCircuitBreakers(settings = {}) {
  const circuitBreakers = runtimeSettings(settings);
  providerCircuitBreakers.configure({
    ...PROVIDER_DEFAULTS,
    ...(circuitBreakers.provider ?? {})
  });
  toolCircuitBreakers.configure({
    ...TOOL_DEFAULTS,
    ...(circuitBreakers.tool ?? {})
  });

  return getRuntimeCircuitBreakerSnapshot();
}

export function getRuntimeCircuitBreakerSnapshot() {
  return {
    version: 1,
    provider: providerCircuitBreakers.snapshot(),
    tool: toolCircuitBreakers.snapshot()
  };
}

export function getPublicRuntimeCircuitBreakerSnapshot() {
  return {
    version: 1,
    provider: providerCircuitBreakers.publicSnapshot(),
    tool: toolCircuitBreakers.publicSnapshot()
  };
}

export function resetRuntimeCircuitBreaker({
  scope = "all",
  key = ""
} = {}) {
  const normalizedScope = String(scope ?? "all");
  const normalizedKey = String(key ?? "").trim();
  if (!["provider", "tool", "all"].includes(normalizedScope)) {
    return {
      ok: false,
      code: "invalid-circuit-breaker-scope",
      message: "未知的熔断器范围。",
      snapshot: getRuntimeCircuitBreakerSnapshot()
    };
  }
  const resetRegistry = (registry) => normalizedKey
    ? registry.reset(normalizedKey)
    : registry.resetAll();

  let resetCount = 0;
  if (["provider", "all"].includes(normalizedScope)) {
    const result = resetRegistry(providerCircuitBreakers);
    resetCount += typeof result === "number" ? result : Number(result);
  }
  if (["tool", "all"].includes(normalizedScope)) {
    const result = resetRegistry(toolCircuitBreakers);
    resetCount += typeof result === "number" ? result : Number(result);
  }

  return {
    ok: true,
    resetCount,
    snapshot: getRuntimeCircuitBreakerSnapshot()
  };
}
