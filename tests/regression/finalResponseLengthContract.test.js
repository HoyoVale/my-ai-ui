import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileFinalResponse
} from "../../electron/agent/finalization/CompletionEvidenceGate.js";
import {
  RUN_OUTCOMES
} from "../../electron/agent/RunStateMachine.js";
import {
  RUN_STOP_REASONS
} from "../../electron/agent/runStopReasons.js";

test("evidence validation preserves final text beyond its 12,000-character scan window", () => {
  const longText = [
    "A".repeat(12_500),
    "E2E_LONG_STREAM_END:e2e-long-stream-complete"
  ].join("\n");
  const result = reconcileFinalResponse({
    finalText: longText,
    records: [],
    outcome: RUN_OUTCOMES.COMPLETED,
    stopReason: RUN_STOP_REASONS.COMPLETED
  });

  assert.equal(result.changed, false);
  assert.equal(result.text.length, longText.length);
  assert.match(
    result.text,
    /E2E_LONG_STREAM_END:e2e-long-stream-complete$/u
  );
});
