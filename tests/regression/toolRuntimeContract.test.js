import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(
    new URL(
      relativePath,
      import.meta.url
    ),
    "utf8"
  );
}

describe(
  "agent tool runtime contract",
  () => {
    it(
      "uses bounded AI SDK segments with controlled long-task continuation",
      () => {
        const source =
          read(
            "../../electron/agent/AgentRuntime.js"
          );
        const segmentLoop =
          read(
            "../../electron/agent/orchestration/SegmentExecutionLoop.js"
          );

        assert.match(
          source,
          /createAgentToolSession/u
        );
        assert.match(
          source,
          /stepCountIs\([\s\S]*maxSteps/u
        );
        assert.match(
          source,
          /new LongTaskOrchestrator/u
        );
        assert.match(
          segmentLoop,
          /segmentOutcome\.decision !== "continue"/u
        );
        assert.match(
          source,
          /maxNoProgressSegments/u
        );
        assert.doesNotMatch(
          source,
          /toolSession[\s\S]{0,80}getPendingQuestion/u
        );
        assert.match(
          source,
          /tools:\s*toolSession\.tools/u
        );
        assert.match(
          source,
          /toolManifest: toolSession\.registryManifest/u
        );
        assert.match(
          source,
          /renderPromptSections\(activePromptSections\)/u
        );
      }
    );

    it(
      "injects a current runtime section into every assembled context",
      () => {
        const source =
          read(
            "../../electron/context/ContextAssembler.js"
          );

        assert.match(
          source,
          /buildRuntimeContextSection/u
        );
        assert.match(
          source,
          /label: "运行环境"/u
        );
      }
    );
  }
);

describe(
  "agent tool runtime result contract",
  () => {
    it(
      "supports paged tool results and live activity without retired question recovery",
      () => {
        const session = read(
          "../../electron/tools/createAgentToolSession.js"
        );
        const runtime = read(
          "../../electron/agent/AgentRuntime.js"
        );
        const conversation = read(
          "../../src/Conversation/Conversation.jsx"
        );

        assert.match(session, /ToolResultStore/u);
        assert.match(runtime, /createCheckpointContinuationState/u);
        assert.doesNotMatch(runtime, /resumeQuestion|getPendingQuestion|pendingQuestion/u);
        assert.match(conversation, /liveActivity/u);
      }
    );
  }
);
