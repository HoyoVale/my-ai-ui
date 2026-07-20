import {
  CircuitBreakerRegistry
} from "./CircuitBreaker.js";

export const providerCircuitBreakers = new CircuitBreakerRegistry({
  scope: "provider",
  failureThreshold: 3,
  failureWindowMs: 90_000,
  cooldownMs: 45_000,
  halfOpenMaxCalls: 1
});

export const toolCircuitBreakers = new CircuitBreakerRegistry({
  scope: "tool",
  failureThreshold: 3,
  failureWindowMs: 60_000,
  cooldownMs: 30_000,
  halfOpenMaxCalls: 1
});
