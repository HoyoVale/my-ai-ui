export const WORKER_RUNTIME_DEFAULTS = Object.freeze({
  maxConcurrency: 2,
  tokenBudget: 400_000,
  stepBudget: 48,
  timeBudgetMinutes: 30,
  maxStepsPerAgent: 8
});

export const WORKER_RUNTIME_LIMITS = Object.freeze({
  maxConcurrency: Object.freeze({ min: 1, max: 4 }),
  tokenBudget: Object.freeze({ min: 10_000, max: 2_000_000, step: 10_000 }),
  stepBudget: Object.freeze({ min: 4, max: 200, step: 4 }),
  timeBudgetMinutes: Object.freeze({ min: 1, max: 240, step: 1 }),
  maxStepsPerAgent: Object.freeze({ min: 1, max: 24 })
});
