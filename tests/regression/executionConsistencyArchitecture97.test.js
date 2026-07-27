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

it("routes Core Lite execution through one lightweight Run lifecycle", () => {
  assert.match(facade, /agentRunPreparation/u);
  assert.match(facade, /agentRunExecution/u);
  assert.match(facade, /agentRunFinalization/u);
  assert.match(facade, /agentRunPersistence/u);
  assert.match(preparation, /new AgentRunSession/u);
  assert.match(preparation, /resolveCoreLiteCheckpointContinuation/u);
  assert.match(execution, /new CoreLiteRunLoop/u);
  assert.match(execution, /executeModelLoop/u);
  assert.match(finalization, /PublicTextStreamSanitizer/u);
  assert.match(persistence, /createCoreLiteRunCheckpoint/u);

  for (const source of [facade, preparation, execution, finalization, persistence]) {
    assert.doesNotMatch(
      source,
      /ExecutionThread|RunEngine|LongTaskOrchestrator|SegmentExecutionLoop|resolveExecutionThreadContinuation|beginExecutionThread|finishExecutionThread|recordExecutionThreadCheckpoint|executeAgentSegment/u
    );
  }

  assert.equal(
    fs.existsSync(new URL(
      "../../electron/conversation/services/ConversationExecutionService.js",
      import.meta.url
    )),
    false
  );
});
