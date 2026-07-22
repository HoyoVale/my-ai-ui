import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKER_RUNTIME_DEFAULTS,
  WORKER_RUNTIME_LIMITS
} from "../../src/shared/runtimeDefaults.js";

test("Worker defaults cover four full Workers, integration and one full Reviewer", () => {
  const fullWorkflowSteps =
    WORKER_RUNTIME_LIMITS.maxConcurrency.max *
      WORKER_RUNTIME_DEFAULTS.maxStepsPerAgent +
    1 +
    WORKER_RUNTIME_DEFAULTS.maxStepsPerAgent;

  assert.ok(
    WORKER_RUNTIME_DEFAULTS.stepBudget >= fullWorkflowSteps
  );
  assert.ok(
    WORKER_RUNTIME_DEFAULTS.stepBudget <=
      WORKER_RUNTIME_LIMITS.stepBudget.max
  );
});
