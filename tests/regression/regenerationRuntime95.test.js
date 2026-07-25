import { it } from "node:test";
import assert from "node:assert/strict";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

it("95 initializes regeneration through the shared Core Lite run session", () => {
  const preparation = readAgentRuntimeSource("preparation");
  const methodStart = preparation.indexOf("  regenerateMessage({");
  const methodEnd = preparation.indexOf("\n};", methodStart);

  assert.notEqual(methodStart, -1);
  assert.notEqual(methodEnd, -1);

  const regenerationMethod = preparation.slice(methodStart, methodEnd);

  assert.match(
    preparation,
    /function createSession\([\s\S]*diffTracker:\s*new RunDiffTracker\(\{[\s\S]*workspaceId:\s*conversation\.workspaceId\s*\?\?\s*""/u
  );
  assert.match(
    regenerationMethod,
    /conversation:\s*regeneration\.conversation/u
  );
  assert.match(
    regenerationMethod,
    /replaceMessageId:\s*regeneration\.targetMessage\.id/u
  );
  assert.doesNotMatch(
    regenerationMethod,
    /executionConversation|executionThread|initialPlan/u
  );
});
