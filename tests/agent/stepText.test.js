import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  classifyAgentStep
} from "../../electron/agent/stepText.js";

describe("agent step text classification", () => {
  it("turns text followed by concurrent tools into public commentary", () => {
    const result = classifyAgentStep({
      text: "I found the relevant files. Next I will inspect their state flow.",
      finishReason: "tool-calls",
      toolCalls: [
        {
          toolName: "search_files"
        },
        {
          toolName: "read_text_file"
        }
      ]
    });

    assert.equal(result.kind, "commentary");
    assert.equal(
      result.objective,
      "search_files、read_text_file"
    );
  });

  it("keeps a tool-free final step as the final assistant answer", () => {
    const result = classifyAgentStep({
      text: "The task is complete.",
      finishReason: "stop",
      toolCalls: []
    });

    assert.equal(result.kind, "final");
    assert.equal(result.text, "The task is complete.");
  });
});
