import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

function lineCount(source) {
  return source.split(/\r?\n/u).length;
}

describe("AgentRuntime phase 2 architecture", () => {
  it("keeps AgentRuntime as a compact public facade", () => {
    const facade = readAgentRuntimeSource("facade");
    assert.ok(lineCount(facade) < 1600, `AgentRuntime facade is still ${lineCount(facade)} lines`);
    assert.match(facade, /agentRunPreparation\.startMessage\.call\(\s*this,\s*content,\s*options\s*\)/u);
    assert.match(facade, /agentRunExecution\.runMessage\.call\(this, options\)/u);
    assert.match(facade, /agentRunFinalization\.finalizeRun\.call\(this, options\)/u);
    assert.match(facade, /agentRunPersistence\.persistAssistantResponse\.call\(\s*this,\s*options\s*\)/u);
    assert.doesNotMatch(facade, /\.apply\(this, arguments\)/u);
  });

  it("owns each lifecycle responsibility in one module", () => {
    const preparation = readAgentRuntimeSource("preparation");
    const execution = readAgentRuntimeSource("execution");
    const finalization = readAgentRuntimeSource("finalization");
    const persistence = readAgentRuntimeSource("persistence");

    assert.match(preparation, /startMessage\(/u);
    assert.match(preparation, /regenerateMessage\(/u);
    assert.match(execution, /executeAgentSegment\(/u);
    assert.match(execution, /runMessage\(/u);
    assert.match(finalization, /finalizeRun\(/u);
    assert.match(finalization, /runFinalization\(/u);
    assert.match(persistence, /buildActiveCheckpoint\(/u);
    assert.match(persistence, /persistAssistantResponse\(/u);
  });

  it("does not keep duplicate lifecycle implementations in the facade", () => {
    const facade = readAgentRuntimeSource("facade");
    assert.doesNotMatch(facade, /const runArguments = \{/u);
    assert.doesNotMatch(facade, /const publicStream = new PublicTextStreamSanitizer/u);
    assert.doesNotMatch(facade, /activityStore\?\.finalize\(/u);
    assert.doesNotMatch(facade, /createRunCheckpoint\(\{/u);
  });
});
