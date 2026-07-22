import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "node:test";

const runtime = fs.readFileSync(new URL("../../electron/agent/AgentRuntime.js", import.meta.url), "utf8");
const manager = fs.readFileSync(new URL("../../electron/conversation/ConversationManager.js", import.meta.url), "utf8");

it("routes execution consistency through extracted core boundaries", () => {
  assert.match(runtime, /resolveExecutionThreadContinuation/u);
  assert.match(runtime, /PublicTextStreamSanitizer/u);
  assert.match(runtime, /beginExecutionThread/u);
  assert.match(runtime, /finishExecutionThread/u);
  assert.match(manager, /recordExecutionThreadCheckpoint/u);
});
