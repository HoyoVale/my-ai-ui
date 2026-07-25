import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "node:test";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

const facade = readAgentRuntimeSource("facade");
const preparation = readAgentRuntimeSource("preparation");
const execution = readAgentRuntimeSource("execution");
const finalization = readAgentRuntimeSource("finalization");
const persistence = readAgentRuntimeSource("persistence");
const manager = fs.readFileSync(
  new URL(
    "../../electron/conversation/services/ConversationExecutionService.js",
    import.meta.url
  ),
  "utf8"
);

it("routes Core Lite execution through extracted lifecycle boundaries", () => {
  assert.match(facade, /agentRunPreparation/u);
  assert.match(facade, /agentRunExecution/u);
  assert.match(facade, /agentRunFinalization/u);
  assert.match(facade, /agentRunPersistence/u);
  assert.match(preparation, /new AgentRunSession/u);
  assert.match(preparation, /resolveCoreLiteCheckpointContinuation/u);
  assert.match(execution, /new CoreLiteRunLoop/u);
  assert.match(finalization, /PublicTextStreamSanitizer/u);
  assert.match(persistence, /createCoreLiteRunCheckpoint/u);

  for (const source of [preparation, execution, finalization, persistence]) {
    assert.doesNotMatch(
      source,
      /resolveExecutionThreadContinuation|beginExecutionThread|finishExecutionThread|recordExecutionThreadCheckpoint/u
    );
  }

  assert.match(
    manager,
    /recordExecutionThreadCheckpoint/u,
    "Dormant advanced conversation compatibility remains until Core Lite 3."
  );
});
