import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "node:test";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

const facade = readAgentRuntimeSource("facade");
const preparation = readAgentRuntimeSource("preparation");
const finalization = readAgentRuntimeSource("finalization");
const persistence = readAgentRuntimeSource("persistence");
const manager = fs.readFileSync(new URL("../../electron/conversation/services/ConversationExecutionService.js", import.meta.url), "utf8");

it("routes execution consistency through extracted core boundaries", () => {
  assert.match(facade, /agentRunPreparation/u);
  assert.match(facade, /agentRunFinalization/u);
  assert.match(facade, /agentRunPersistence/u);
  assert.match(preparation, /resolveExecutionThreadContinuation/u);
  assert.match(preparation, /beginExecutionThread/u);
  assert.match(finalization, /PublicTextStreamSanitizer/u);
  assert.match(finalization, /finishExecutionThread/u);
  assert.match(persistence, /recordExecutionThreadCheckpoint/u);
  assert.match(manager, /recordExecutionThreadCheckpoint/u);
});
