import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function source(path) {
  return fs.readFileSync(path, "utf8");
}

it("95 initializes regeneration diff tracking from the prepared conversation", () => {
  const runtime = source("electron/agent/AgentRuntime.js");
  const methodStart = runtime.indexOf("  regenerateMessage({");
  const methodEnd = runtime.indexOf("\n  upsertToolRecord(", methodStart);

  assert.notEqual(methodStart, -1);
  assert.notEqual(methodEnd, -1);

  const regeneration = runtime.slice(methodStart, methodEnd);

  assert.match(
    regeneration,
    /diffTracker:\s*new RunDiffTracker\(\{[\s\S]*workspaceId:\s*plan\.conversation\.workspaceId\s*\?\?\s*""/u
  );
  assert.doesNotMatch(regeneration, /executionConversation/u);
});
