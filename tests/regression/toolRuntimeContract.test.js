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
      "uses AI SDK multi-step tool calling with a hard step limit",
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
          /stepCountIs\([\s\S]*settings\.tools[\s\S]*maxSteps/u
        );
        assert.match(
          source,
          /hasToolCall/u
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
