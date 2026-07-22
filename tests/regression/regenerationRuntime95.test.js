import { it } from "node:test";
import assert from "node:assert/strict";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

it("95 initializes regeneration diff tracking from the prepared conversation", () => {
  const preparation = readAgentRuntimeSource("preparation");
  const methodStart = preparation.indexOf("  regenerateMessage({");
  const methodEnd = preparation.indexOf("\n};", methodStart);

  assert.notEqual(methodStart, -1);
  assert.notEqual(methodEnd, -1);

  const regeneration = preparation.slice(methodStart, methodEnd);

  assert.match(
    regeneration,
    /diffTracker:\s*new RunDiffTracker\(\{[\s\S]*workspaceId:\s*plan\.conversation\.workspaceId\s*\?\?\s*""/u
  );
  assert.doesNotMatch(regeneration, /executionConversation/u);
});
