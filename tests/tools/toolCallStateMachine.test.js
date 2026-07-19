import assert from "node:assert/strict";
import test from "node:test";

import {
  TOOL_CALL_STATES,
  assertToolCallTransition,
  canTransitionToolCall,
  isTerminalToolCallState
} from "../../electron/tools/runtime-state/ToolCallStateMachine.js";

test("Tool call state machine preserves receipt and terminal invariants", () => {
  assert.equal(
    canTransitionToolCall(
      TOOL_CALL_STATES.PREPARED,
      TOOL_CALL_STATES.DISPATCHED
    ),
    true
  );
  assert.equal(
    canTransitionToolCall(
      TOOL_CALL_STATES.RECEIPT_STORED,
      TOOL_CALL_STATES.DISPATCHED
    ),
    false
  );
  assert.throws(
    () => assertToolCallTransition(
      TOOL_CALL_STATES.REPORTED,
      TOOL_CALL_STATES.DISPATCHED
    ),
    /Invalid Tool call transition/
  );
  assert.equal(isTerminalToolCallState(TOOL_CALL_STATES.REPORTED), true);
  assert.equal(
    isTerminalToolCallState(TOOL_CALL_STATES.NEEDS_RECONCILIATION),
    false
  );
});
