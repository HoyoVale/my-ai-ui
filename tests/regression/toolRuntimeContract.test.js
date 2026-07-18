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
          source,
          /segmentOutcome\.decision === "continue"/u
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
  "agent tool runtime 1.2 contract",
  () => {
    it(
      "supports paged tool results and legacy question recovery",
      () => {
        const session =
          read(
            "../../electron/tools/createAgentToolSession.js"
          );
        const runtime =
          read(
            "../../electron/agent/AgentRuntime.js"
          );
        const conversation =
          read(
            "../../src/Conversation/Conversation.jsx"
          );

        assert.match(
          session,
          /ToolResultStore/u
        );
        assert.doesNotMatch(
          session,
          /getPendingQuestion/u
        );
        assert.match(
          runtime,
          /getPendingQuestion/u
        );
        assert.match(
          runtime,
          /waiting_for_user/u
        );
        assert.match(
          conversation,
          /liveActivity/u
        );
      }
    );
  }
);
